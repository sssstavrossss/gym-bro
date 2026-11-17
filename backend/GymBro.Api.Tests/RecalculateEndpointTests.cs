using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Nutrition;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class RecalculateEndpointTests(ApiFactory factory)
{
    [Fact]
    public async Task Without_enough_data_the_burn_is_kept_and_the_period_keeps_running()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 8, 0, 0, TimeSpan.Zero);
        var owner = TestData.NewUser("recalc-owner");
        var other = TestData.NewUser("recalc-other");
        using var client = factory.AsUser(owner);
        using var stranger = factory.AsUser(other);
        await TestData.PutWeighIn(client, "2026-11-10", """{"kg":83.6,"timeZone":"Europe/Oslo"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "Europe/Oslo"));

        var review = await client.GetFromJsonAsync<JsonElement>("/api/recalculate");
        Assert.True(review.GetProperty("includedDays").GetInt32() < 7);
        Assert.False(review.GetProperty("measured").GetBoolean());
        Assert.Equal(AdaptiveTarget.NeedMoreDays, review.GetProperty("blocked").GetString());
        Assert.Equal(2218, review.GetProperty("proposed").GetProperty("kcal").GetInt32());
        Assert.Equal(JsonValueKind.Null, review.GetProperty("step").ValueKind);
        var from = review.GetProperty("from").GetString();

        var denied = await stranger.GetAsync("/api/recalculate");
        Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);
        var noMode = await client.PostAsJsonAsync("/api/recalculate", new { exclude = Array.Empty<string>() });
        Assert.Equal(HttpStatusCode.BadRequest, noMode.StatusCode);

        // Same numbers still write a row: it marks the recalculation.
        var kept = await client.PostAsJsonAsync("/api/recalculate", new { mode = "adaptive" });
        Assert.Equal(HttpStatusCode.OK, kept.StatusCode);
        var today = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-11-10");
        Assert.Contains(RecalculationReasons.Kept, today.GetProperty("targets").GetProperty("reasons").EnumerateArray().Select(item => item.GetString()));
        Assert.Equal(2218, today.GetProperty("targets").GetProperty("kcal").GetInt32());
        var again = await client.GetFromJsonAsync<JsonElement>("/api/recalculate");
        Assert.Equal(from, again.GetProperty("from").GetString());

        var formula = await client.PostAsJsonAsync("/api/recalculate", new { mode = "formula" });
        Assert.Equal(HttpStatusCode.OK, formula.StatusCode);
        var after = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-11-10");
        Assert.Equal(RecalculationReasons.Formula, after.GetProperty("targets").GetProperty("reason").GetString());
        var restarted = await client.GetFromJsonAsync<JsonElement>("/api/recalculate");
        Assert.Equal("2026-11-11", restarted.GetProperty("from").GetString());
        Assert.Equal(0, restarted.GetProperty("periodDays").GetInt32());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Empty(await db.TargetHistories.Where(row => row.UserId == other).ToListAsync());
    }

    [Fact]
    public async Task A_measured_burn_is_saved_with_its_details_and_a_profile_edit_keeps_it()
    {
        var setup = new DateOnly(2026, 10, 1);
        var today = setup.AddDays(28);
        var owner = TestData.NewUser("recalc-measured");
        using var client = factory.AsUser(owner);
        await Seed(client, owner, setup, today, kcal: 2000m, startKg: 84m, lossPerDay: 0.5m / 7m);

        var review = await client.GetFromJsonAsync<JsonElement>("/api/recalculate");
        Assert.True(review.GetProperty("measured").GetBoolean());
        Assert.Equal(JsonValueKind.Null, review.GetProperty("blocked").ValueKind);
        Assert.Equal("2026-10-01", review.GetProperty("from").GetString());
        Assert.Equal(28, review.GetProperty("periodDays").GetInt32());
        Assert.Equal("2026-10-08", review.GetProperty("settledFrom").GetString());
        Assert.False(review.GetProperty("capped").GetBoolean());
        Assert.Equal(22, review.GetProperty("fit").GetProperty("weighIns").GetInt32());
        Assert.Equal(-0.5m, review.GetProperty("fit").GetProperty("rateKgPerWeek").GetDecimal());
        Assert.Equal(2000, review.GetProperty("averageKcal").GetInt32());
        Assert.InRange(review.GetProperty("step").GetProperty("measured").GetInt32(), 2540, 2560);
        var burn = review.GetProperty("burn").GetInt32();
        Assert.InRange(burn, 2540, 2600);
        Assert.Equal(burn - 550, review.GetProperty("proposed").GetProperty("kcal").GetInt32());

        var saved = await client.PostAsJsonAsync("/api/recalculate", new { mode = "adaptive" });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var answer = await saved.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(RecalculationReasons.Adaptive, answer.GetProperty("reason").GetString());
        Assert.Equal(burn, answer.GetProperty("burn").GetInt32());
        var row = (await Rows(owner)).Single(item => item.EffectiveDate == today);
        Assert.Equal(row.Kcal, answer.GetProperty("targets").GetProperty("kcal").GetInt32());
        Assert.Contains(RecalculationReasons.Adaptive, row.Reasons);
        Assert.Equal(burn, row.Tdee);
        Assert.Equal(review.GetProperty("formula").GetProperty("tdee").GetInt32(), row.FormulaTdee);
        Assert.True(row.BurnSdKcal < 100);
        Assert.Contains("\"measuredBurn\":", row.Details);
        var distance = row.Tdee - row.FormulaTdee;
        Assert.True(distance < -100);

        // Less activity lowers the formula; the measured distance from it stays.
        var edited = await TestData.PutProfile(client, TestData.Profile(activity: "light"));
        var after = (await Rows(owner)).Single(item => item.EffectiveDate == today);
        Assert.True(after.FormulaTdee < row.FormulaTdee);
        Assert.Equal(distance, after.Tdee - after.FormulaTdee);
        Assert.Equal(after.Kcal, edited.GetProperty("targets").GetProperty("kcal").GetInt32());
        Assert.Contains("\"changes\":", after.Details);
        Assert.Contains("\"measuredBurn\":", after.Details);

        var next = await client.GetFromJsonAsync<JsonElement>("/api/recalculate");
        Assert.Equal(0, next.GetProperty("periodDays").GetInt32());
    }

    [Fact]
    public async Task A_long_gap_reads_only_the_last_eight_weeks()
    {
        var setup = new DateOnly(2026, 6, 1);
        var today = new DateOnly(2026, 11, 10);
        var owner = TestData.NewUser("recalc-long");
        using var client = factory.AsUser(owner);
        await Seed(client, owner, setup, today, kcal: 2200m, startKg: 84m, lossPerDay: 0m, every: 5);

        var review = await client.GetFromJsonAsync<JsonElement>("/api/recalculate");
        Assert.True(review.GetProperty("capped").GetBoolean());
        Assert.Equal(56, review.GetProperty("periodDays").GetInt32());
        Assert.Equal("2026-09-15", review.GetProperty("from").GetString());
        Assert.Equal(56, review.GetProperty("calendar").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, review.GetProperty("lastUpdate").ValueKind);
        Assert.True(review.GetProperty("measured").GetBoolean());
    }

    [Fact]
    public async Task History_pages_newest_first_with_changes_and_local_decline_dates()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 8, 0, 0, TimeSpan.Zero);
        var owner = TestData.NewUser("history");
        using var client = factory.AsUser(owner);
        await TestData.PutWeighIn(client, "2026-11-10", """{"kg":83.6,"timeZone":"Europe/Oslo"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "Europe/Oslo"));
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 11, 8, 0, 0, TimeSpan.Zero);
        await TestData.PutProfile(client, TestData.Profile(timeZone: "Europe/Oslo", goalWeightKg: 78));
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 11, 23, 30, 0, TimeSpan.Zero);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/recalculate/decline", new { })).StatusCode);

        var first = await client.GetFromJsonAsync<JsonElement>("/api/profile/history?limit=2");
        Assert.Equal(3, first.GetProperty("total").GetInt32());
        Assert.True(first.GetProperty("more").GetBoolean());
        var rows = first.GetProperty("rows");
        Assert.Equal(2, rows.GetArrayLength());
        Assert.Equal("declined", rows[0].GetProperty("kind").GetString());
        Assert.Equal("2026-11-12", rows[0].GetProperty("date").GetString());
        var edit = rows[1];
        Assert.Equal("target", edit.GetProperty("kind").GetString());
        Assert.Equal("2026-11-11", edit.GetProperty("date").GetString());
        Assert.Equal(edit.GetProperty("kcal").GetInt32(), edit.GetProperty("previousKcal").GetInt32());
        Assert.Equal(2768, edit.GetProperty("burn").GetInt32());
        var change = Assert.Single(edit.GetProperty("changes").EnumerateArray());
        Assert.Equal("goalWeightKg", change.GetProperty("field").GetString());
        Assert.Equal("80", change.GetProperty("from").GetString());
        Assert.Equal("78", change.GetProperty("to").GetString());

        var rest = await client.GetFromJsonAsync<JsonElement>("/api/profile/history?offset=2&limit=2");
        Assert.False(rest.GetProperty("more").GetBoolean());
        var setupRow = Assert.Single(rest.GetProperty("rows").EnumerateArray());
        Assert.Equal(JsonValueKind.Null, setupRow.GetProperty("previousKcal").ValueKind);
        Assert.Equal(JsonValueKind.Null, setupRow.GetProperty("changes").ValueKind);
    }

    /// <summary>Sets up on <paramref name="setup"/>, then fills weigh-ins and one log a day straight into the database, and moves the clock to <paramref name="today"/>.</summary>
    private async Task Seed(HttpClient client, string userId, DateOnly setup, DateOnly today, decimal kcal, decimal startKg, decimal lossPerDay, int every = 1)
    {
        factory.Clock.UtcNow = new DateTimeOffset(setup.ToDateTime(new TimeOnly(8, 0)), TimeSpan.Zero);
        var kg = startKg.ToString(System.Globalization.CultureInfo.InvariantCulture);
        await TestData.PutWeighIn(client, setup.ToString("yyyy-MM-dd"), $$"""{"kg":{{kg}},"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            for (var day = setup.AddDays(every); day <= today; day = day.AddDays(every))
            {
                var offset = day.DayNumber - setup.DayNumber;
                db.WeighIns.Add(new WeighIn { Id = Guid.NewGuid(), UserId = userId, LocalDate = day, Kg = decimal.Round(startKg - lossPerDay * offset, 2), UpdatedAt = DateTimeOffset.UtcNow });
            }

            for (var day = setup; day < today; day = day.AddDays(1))
            {
                db.LogEntries.Add(new LogEntry
                {
                    Id = Guid.NewGuid(),
                    UserId = userId,
                    LocalDate = day,
                    LoggedAt = day.ToDateTime(new TimeOnly(12, 0)),
                    TimeZone = "UTC",
                    Name = "Day",
                    Amount = 1,
                    Unit = "serving",
                    Kcal = kcal,
                    IdempotencyKey = "seed-" + Guid.NewGuid().ToString("N"),
                });
            }

            await db.SaveChangesAsync();
        }

        factory.Clock.UtcNow = new DateTimeOffset(today.ToDateTime(new TimeOnly(8, 0)), TimeSpan.Zero);
    }

    private async Task<List<TargetHistory>> Rows(string userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.TargetHistories.AsNoTracking().Where(row => row.UserId == userId).ToListAsync();
    }

    [Fact]
    public async Task Decline_keeps_the_target_and_the_period_and_writes_one_row_each_time()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 8, 0, 0, TimeSpan.Zero);
        var owner = TestData.NewUser("recalc-decline");
        using var client = factory.AsUser(owner);
        await TestData.PutWeighIn(client, "2026-11-10", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());

        var before = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-11-10");
        var kept = before.GetProperty("targets").GetProperty("kcal").GetInt32();
        var review = await client.GetFromJsonAsync<JsonElement>("/api/recalculate");
        var from = review.GetProperty("from").GetString();
        Assert.Equal(JsonValueKind.Array, review.GetProperty("calendar").ValueKind);

        var body = new { exclude = Array.Empty<string>(), includeZero = Array.Empty<string>() };
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/recalculate/decline", body)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/recalculate/decline", body)).StatusCode);

        var after = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-11-10");
        Assert.Equal(kept, after.GetProperty("targets").GetProperty("kcal").GetInt32());
        Assert.DoesNotContain("recalculation_declined", after.GetProperty("targets").GetProperty("reasons").EnumerateArray().Select(item => item.GetString()));
        var again = await client.GetFromJsonAsync<JsonElement>("/api/recalculate");
        Assert.Equal(from, again.GetProperty("from").GetString());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var declines = await db.RecalculationDeclines.Where(row => row.UserId == owner).ToListAsync();
        Assert.Equal(2, declines.Count);
        Assert.All(declines, row => Assert.Equal(kept, row.KeptKcal));
        Assert.Contains(declines, row => row.SuggestedKcal > 0);
    }

    [Fact]
    public async Task Notifications_stay_off_without_keys_and_subscriptions_are_private()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 8, 0, 0, TimeSpan.Zero);
        var owner = TestData.NewUser("push-owner");
        var other = TestData.NewUser("push-other");
        using var client = factory.AsUser(owner);
        using var stranger = factory.AsUser(other);
        await TestData.PutWeighIn(client, "2026-11-10", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());

        var settings = await client.GetFromJsonAsync<JsonElement>("/api/notifications");
        Assert.False(settings.GetProperty("configured").GetBoolean());
        var turned = await client.PutAsJsonAsync("/api/notifications", new { enabled = true });
        Assert.Equal(HttpStatusCode.BadRequest, turned.StatusCode);
        var typed = await client.PutAsJsonAsync("/api/notifications", new { type = "recalculate", enabled = false });
        Assert.Equal(HttpStatusCode.OK, typed.StatusCode);
        var again = await client.GetFromJsonAsync<JsonElement>("/api/notifications");
        Assert.False(again.GetProperty("types")[0].GetProperty("enabled").GetBoolean());
        Assert.False(again.GetProperty("configured").GetBoolean());
        Assert.Equal("", again.GetProperty("publicKey").GetString());

        var endpoint = "https://push.example.test/owner";
        var body = new { endpoint, keys = new { p256dh = "abc", auth = "def" } };
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/notifications/subscription", body)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await stranger.DeleteAsync("/api/notifications/subscription")).StatusCode);
    }

    [Fact]
    public async Task The_weekly_reminder_is_private_and_reading_it_hides_the_banner()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 8, 0, 0, TimeSpan.Zero);
        var owner = TestData.NewUser("inbox-owner");
        var other = TestData.NewUser("inbox-other");
        using var client = factory.AsUser(owner);
        using var stranger = factory.AsUser(other);
        await TestData.PutWeighIn(client, "2026-11-10", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());
        await TestData.PutWeighIn(stranger, "2026-11-10", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(stranger, TestData.Profile());

        var banner = await client.GetFromJsonAsync<JsonElement>("/api/recalculate/banner");
        Assert.True(banner.GetProperty("show").GetBoolean());
        Assert.Equal("2026-11-09", banner.GetProperty("weekStart").GetString());

        var inbox = await client.GetFromJsonAsync<JsonElement>("/api/notifications/inbox");
        Assert.Equal(1, inbox.GetProperty("unread").GetInt32());
        var item = inbox.GetProperty("items")[0];
        Assert.Equal("recalculate", item.GetProperty("type").GetString());
        Assert.Equal("Time to recalculate your target", item.GetProperty("title").GetString());
        Assert.StartsWith("A new week has started.", item.GetProperty("body").GetString());
        // The reminder shows on Home, so it doesn't light the Profile tab.
        Assert.Equal(0, inbox.GetProperty("badge").GetInt32());
        var counted = await client.GetFromJsonAsync<JsonElement>("/api/notifications/inbox/unread");
        Assert.Equal(1, counted.GetProperty("count").GetInt32());
        Assert.Equal(0, counted.GetProperty("badge").GetInt32());
        var id = item.GetProperty("id").GetInt64();

        var theirs = await stranger.GetFromJsonAsync<JsonElement>("/api/notifications/inbox");
        Assert.DoesNotContain(theirs.GetProperty("items").EnumerateArray(), row => row.GetProperty("id").GetInt64() == id);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsync($"/api/notifications/inbox/{id}/read", null)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/recalculate/banner/dismiss", null)).StatusCode);
        var hidden = await client.GetFromJsonAsync<JsonElement>("/api/recalculate/banner");
        Assert.False(hidden.GetProperty("show").GetBoolean());
        var unread = await client.GetFromJsonAsync<JsonElement>("/api/notifications/inbox/unread");
        Assert.Equal(0, unread.GetProperty("count").GetInt32());
        var still = await stranger.GetFromJsonAsync<JsonElement>("/api/notifications/inbox/unread");
        Assert.Equal(1, still.GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task A_new_weeks_reminder_closes_the_one_left_open_last_week()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 3, 8, 0, 0, TimeSpan.Zero);
        var owner = TestData.NewUser("inbox-weeks");
        using var client = factory.AsUser(owner);
        await TestData.PutWeighIn(client, "2026-11-03", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());
        var first = await client.GetFromJsonAsync<JsonElement>("/api/notifications/inbox");
        Assert.Equal(1, first.GetProperty("unread").GetInt32());

        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 8, 0, 0, TimeSpan.Zero);
        var next = await client.GetFromJsonAsync<JsonElement>("/api/notifications/inbox");
        var items = next.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(2, items.Count);
        Assert.Equal(1, next.GetProperty("unread").GetInt32());
        Assert.Equal(JsonValueKind.Null, items[0].GetProperty("readAt").ValueKind);
        Assert.NotEqual(JsonValueKind.Null, items[1].GetProperty("readAt").ValueKind);
        var banner = await client.GetFromJsonAsync<JsonElement>("/api/recalculate/banner");
        Assert.True(banner.GetProperty("show").GetBoolean());
        Assert.Equal("2026-11-09", banner.GetProperty("weekStart").GetString());
    }
}
