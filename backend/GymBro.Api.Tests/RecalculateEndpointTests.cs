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
    public async Task Formula_confirmation_writes_today_and_stays_on_the_caller()
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
        Assert.Equal(JsonValueKind.Null, review.GetProperty("proposed").ValueKind);
        Assert.Equal(AdaptiveTarget.NeedMoreDays, review.GetProperty("blocked").GetString());

        var denied = await stranger.GetAsync("/api/recalculate");
        Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);

        var adaptive = await client.PostAsJsonAsync("/api/recalculate", new { exclude = Array.Empty<string>(), mode = "adaptive" });
        Assert.Equal(HttpStatusCode.BadRequest, adaptive.StatusCode);

        var unchanged = await client.PostAsJsonAsync("/api/recalculate", new { exclude = Array.Empty<string>(), mode = "formula" });
        Assert.Equal(HttpStatusCode.OK, unchanged.StatusCode);
        var before = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-11-10");
        Assert.DoesNotContain(RecalculationReasons.Formula, before.GetProperty("targets").GetProperty("reasons").EnumerateArray().Select(item => item.GetString()));

        Assert.Equal(HttpStatusCode.OK, (await client.PutAsync("/api/weigh-ins/2026-11-10", JsonContent.Create(new { kg = 90, timeZone = "Europe/Oslo", confirm = true }))).StatusCode);
        var saved = await client.PostAsJsonAsync("/api/recalculate", new { exclude = Array.Empty<string>(), mode = "formula" });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var today = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-11-10");
        Assert.Equal(RecalculationReasons.Formula, today.GetProperty("targets").GetProperty("reason").GetString());
        Assert.Equal("2026-11-10", today.GetProperty("targets").GetProperty("effectiveDate").GetString());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.DoesNotContain(await db.TargetHistories.Where(row => row.UserId == other).ToListAsync(), row => row.Reasons.Contains(RecalculationReasons.Formula));
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
