using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class DayStatusEndpointTests(ApiFactory factory)
{
    [Fact]
    public async Task Future_and_pre_setup_dates_are_rejected_for_day_status()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 20, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("status-window"));
        await Setup(client, "2026-10-20");
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);

        var future = await client.PutAsync("/api/day-status/2026-10-25", Json(Complete(true)));
        Assert.Equal(HttpStatusCode.BadRequest, future.StatusCode);
        Assert.Equal("That date is in the future.", (await future.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());

        var early = await client.PutAsync("/api/day-status/2026-10-19", Json(Complete(true)));
        Assert.Equal(HttpStatusCode.BadRequest, early.StatusCode);
        Assert.Equal("That date is before you set up Gym Bro.", (await early.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());

        var futureRead = await client.GetAsync("/api/day-status?date=2026-10-25&timeZone=UTC");
        Assert.Equal(HttpStatusCode.BadRequest, futureRead.StatusCode);
        var earlyRead = await client.GetAsync("/api/day-status?date=2026-10-19&timeZone=UTC");
        Assert.Equal(HttpStatusCode.BadRequest, earlyRead.StatusCode);

        var today = await client.PutAsync("/api/day-status/2026-10-24", Json(Complete(true, true)));
        Assert.Equal(HttpStatusCode.OK, today.StatusCode);
        var setup = await client.PutAsync("/api/day-status/2026-10-20", Json(Complete(true, true)));
        Assert.Equal(HttpStatusCode.OK, setup.StatusCode);
    }

    [Fact]
    public async Task Empty_day_fasting_question_is_the_only_way_to_set_fasting()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("fast-empty"));
        await Setup(client, "2026-10-24");

        var unmarked = await client.GetFromJsonAsync<JsonElement>("/api/day-status?date=2026-10-24&timeZone=UTC");
        Assert.False(unmarked.GetProperty("complete").GetBoolean());
        Assert.False(unmarked.GetProperty("fasting").GetBoolean());

        var saved = await client.PutAsync("/api/day-status/2026-10-24", Json(Complete(true, true)));
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var body = await saved.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(body.GetProperty("complete").GetBoolean());
        Assert.True(body.GetProperty("fasting").GetBoolean());

        var separate = await client.PutAsync("/api/fasting/2026-10-24", Json(Complete(true, true)));
        Assert.Equal(HttpStatusCode.NotFound, separate.StatusCode);
        Assert.DoesNotContain("true", await separate.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_day_with_entries_saves_complete_and_leaves_fasting_false()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("fast-eaten"));
        await Setup(client, "2026-10-24");
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsync("/api/log-entries", Json(Quick("eaten-1", "2026-10-24", "10", "\"time\":\"08:00\"")))).StatusCode);

        var saved = await client.PutAsync("/api/day-status/2026-10-24", Json(Complete(true, true)));
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var body = await saved.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(body.GetProperty("complete").GetBoolean());
        Assert.True(body.GetProperty("fasting").GetBoolean());
    }

    [Fact]
    public async Task Clearing_fasting_keeps_the_row_and_leaves_complete_unused()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("untick");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-10-24");
        var marked = await client.PutAsync("/api/day-status/2026-10-24", Json(Complete(false, true)));
        Assert.Equal(HttpStatusCode.OK, marked.StatusCode);
        var markedBody = await marked.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(markedBody.GetProperty("complete").GetBoolean());
        Assert.True(markedBody.GetProperty("fasting").GetBoolean());

        var cleared = await client.PutAsync("/api/day-status/2026-10-24", Json(Complete(false, false)));
        Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);
        var body = await cleared.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(body.GetProperty("complete").GetBoolean());
        Assert.False(body.GetProperty("fasting").GetBoolean());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var kept = await db.DayStatuses.SingleAsync(row => row.UserId == user);
        Assert.False(kept.Complete);
        Assert.False(kept.Fasting);
    }

    [Fact]
    public async Task Adding_and_deleting_food_leaves_a_complete_day_complete()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("stay-complete"));
        await Setup(client, "2026-10-24");
        var first = await client.PostAsync("/api/log-entries", Json(Quick("stay-1", "2026-10-24", "100", "\"time\":\"08:00\"")));
        var firstId = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsync("/api/day-status/2026-10-24", Json(Complete(true, true)))).StatusCode);

        var second = await client.PostAsync("/api/log-entries", Json(Quick("stay-2", "2026-10-24", "50", "\"time\":\"13:00\"")));
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/log-entries/{firstId}")).StatusCode);

        var status = await client.GetFromJsonAsync<JsonElement>("/api/day-status?date=2026-10-24&timeZone=UTC");
        Assert.False(status.GetProperty("complete").GetBoolean());
        Assert.True(status.GetProperty("fasting").GetBoolean());
        var list = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(1, list.GetProperty("entries").GetArrayLength());
        Assert.Equal(50, list.GetProperty("totals").GetProperty("kcal").GetDecimal());
    }

    [Fact]
    public async Task Food_added_to_a_fasting_day_is_kept_and_the_flags_stay()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("fast-then-food"));
        await Setup(client, "2026-10-24");
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsync("/api/day-status/2026-10-24", Json(Complete(true, true)))).StatusCode);

        var created = await client.PostAsync("/api/log-entries", Json(Quick("later-1", "2026-10-24", "40", "\"time\":\"19:00\"")));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        var status = await client.GetFromJsonAsync<JsonElement>("/api/day-status?date=2026-10-24&timeZone=UTC");
        Assert.False(status.GetProperty("complete").GetBoolean());
        Assert.True(status.GetProperty("fasting").GetBoolean());
        var list = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(40, list.GetProperty("totals").GetProperty("kcal").GetDecimal());
    }

    [Fact]
    public async Task Another_users_day_status_and_logged_days_stay_hidden()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        var owner = TestData.NewUser("status-owner");
        var other = TestData.NewUser("status-other");
        using var client = factory.AsUser(owner);
        using var stranger = factory.AsUser(other);
        await Setup(client, "2026-10-24");
        await Setup(stranger, "2026-10-24");
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsync("/api/log-entries", Json(Quick("own-day", "2026-10-24", "80", "\"time\":\"09:00\"")))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsync("/api/day-status/2026-10-24", Json(Complete(true, true)))).StatusCode);

        var hidden = await stranger.GetFromJsonAsync<JsonElement>("/api/day-status?date=2026-10-24&timeZone=UTC");
        Assert.False(hidden.GetProperty("complete").GetBoolean());
        Assert.False(hidden.GetProperty("fasting").GetBoolean());

        Assert.Equal(HttpStatusCode.OK, (await stranger.PutAsync("/api/day-status/2026-10-24", Json(Complete(false)))).StatusCode);
        var still = await client.GetFromJsonAsync<JsonElement>("/api/day-status?date=2026-10-24&timeZone=UTC");
        Assert.True(still.GetProperty("fasting").GetBoolean());

        var days = await stranger.GetFromJsonAsync<JsonElement>("/api/log-days?from=2026-10-20&to=2026-10-24&timeZone=UTC");
        Assert.Equal(0, days.GetProperty("loggedDates").GetArrayLength());
        var ownDays = await client.GetFromJsonAsync<JsonElement>("/api/log-days?from=2026-10-20&to=2026-10-26&timeZone=UTC");
        Assert.Equal("2026-10-24", ownDays.GetProperty("today").GetString());
        Assert.Equal("2026-10-24", ownDays.GetProperty("loggedDates")[0].GetString());
        Assert.Equal(1, ownDays.GetProperty("loggedDates").GetArrayLength());
    }

    [Fact]
    public async Task Timeline_is_time_order_and_soft_deleted_rows_are_absent()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("order"));
        await Setup(client, "2026-10-24");
        var evening = await client.PostAsync("/api/log-entries", Json(Quick("ord-3", "2026-10-24", "30", "\"time\":\"18:00\"")));
        var morning = await client.PostAsync("/api/log-entries", Json(Quick("ord-1", "2026-10-24", "10", "\"time\":\"07:30\"")));
        var noon = await client.PostAsync("/api/log-entries", Json(Quick("ord-2", "2026-10-24", "20", "\"time\":\"12:00\"")));
        var dropped = await client.PostAsync("/api/log-entries", Json(Quick("ord-x", "2026-10-24", "99", "\"time\":\"09:00\"")));
        var droppedId = (await dropped.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/log-entries/{droppedId}")).StatusCode);

        var list = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        var entries = list.GetProperty("entries");
        Assert.Equal(3, entries.GetArrayLength());
        Assert.Equal("07:30", entries[0].GetProperty("time").GetString());
        Assert.Equal("12:00", entries[1].GetProperty("time").GetString());
        Assert.Equal("18:00", entries[2].GetProperty("time").GetString());
        Assert.Equal((await morning.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid(), entries[0].GetProperty("id").GetGuid());
        Assert.Equal((await noon.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid(), entries[1].GetProperty("id").GetGuid());
        Assert.Equal((await evening.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid(), entries[2].GetProperty("id").GetGuid());
        Assert.Equal(60, list.GetProperty("totals").GetProperty("kcal").GetDecimal());

        var days = await client.GetFromJsonAsync<JsonElement>("/api/log-days?from=2026-10-24&to=2026-10-24&timeZone=UTC");
        Assert.Equal(1, days.GetProperty("loggedDates").GetArrayLength());
    }

    [Fact]
    public async Task A_day_before_the_first_target_is_not_given_one()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 20, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("no-target");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-10-20");
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsync("/api/log-entries", Json(Quick("early", "2026-10-20", "15", "\"time\":\"08:00\"")))).StatusCode);

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = await db.TargetHistories.SingleAsync(item => item.UserId == user);
            row.EffectiveDate = new DateOnly(2026, 10, 22);
            await db.SaveChangesAsync();
        }

        var before = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-10-20");
        Assert.Equal("2026-10-22", before.GetProperty("firstTargetDate").GetString());
        Assert.Equal(JsonValueKind.Null, before.GetProperty("targets").ValueKind);
        var onTarget = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-10-22");
        Assert.Equal(JsonValueKind.Object, onTarget.GetProperty("targets").ValueKind);
        Assert.Equal("2026-10-22", onTarget.GetProperty("targets").GetProperty("effectiveDate").GetString());

        var list = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-20");
        Assert.Equal(15, list.GetProperty("totals").GetProperty("kcal").GetDecimal());
        Assert.Equal(1, list.GetProperty("entries").GetArrayLength());
    }

    private static async Task Setup(HttpClient client, string date)
    {
        await TestData.PutWeighIn(client, date, """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());
    }

    private static string Complete(bool complete, bool fasting = false) =>
        $$"""{"complete":{{(complete ? "true" : "false")}},"fasting":{{(fasting ? "true" : "false")}},"timeZone":"UTC"}""";

    private static string Quick(string key, string date, string kcal = "10", string? extra = null)
    {
        var tail = string.IsNullOrEmpty(extra) ? "" : "," + extra;
        return $$"""
            {"idempotencyKey":"{{key}}","localDate":"{{date}}","timeZone":"UTC","name":"Fictional bar","kcal":{{kcal}},"protein":1,"fat":1,"carbs":1{{tail}}}
            """;
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");
}
