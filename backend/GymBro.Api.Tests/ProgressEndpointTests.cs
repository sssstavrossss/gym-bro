using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class ProgressEndpointTests(ApiFactory factory)
{
    [Fact]
    public async Task Progress_is_401_without_a_caller()
    {
        var response = await factory.CreateClient().GetAsync("/api/progress");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task An_unknown_range_is_rejected()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("progress-range"));
        await Setup(client, "2026-11-10");
        var response = await client.GetAsync("/api/progress?range=week");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Use 7d, 30d, 90d, or all.", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
    }

    [Fact]
    public async Task Empty_days_stay_empty_and_averages_use_only_logged_days()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("progress-days");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-11-08", "84.0");
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsync("/api/weigh-ins/2026-11-10", Json("""{"kg":83.6,"timeZone":"UTC"}"""))).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsync("/api/log-entries", Json(Quick("p-a", "2026-11-08", "400", "40")))).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsync("/api/log-entries", Json(Quick("p-b", "2026-11-10", "600", "20")))).StatusCode);
        var removed = await client.PostAsync("/api/log-entries", Json(Quick("p-gone", "2026-11-09", "9999", "999")));
        Assert.Equal(HttpStatusCode.Created, removed.StatusCode);
        var removedId = (await removed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/log-entries/{removedId}")).StatusCode);

        var body = await client.GetFromJsonAsync<JsonElement>("/api/progress?range=7d");
        Assert.Equal("7d", body.GetProperty("range").GetString());
        Assert.Equal("2026-11-04", body.GetProperty("from").GetString());
        Assert.Equal("2026-11-10", body.GetProperty("to").GetString());
        Assert.Equal(83.6m, body.GetProperty("weight").GetProperty("currentKg").GetDecimal());
        Assert.Equal("2026-11-10", body.GetProperty("weight").GetProperty("currentDate").GetString());
        Assert.Equal(-0.4m, body.GetProperty("weight").GetProperty("changeKg").GetDecimal());
        Assert.Equal(2, body.GetProperty("weight").GetProperty("weighIns").GetArrayLength());

        var intake = body.GetProperty("intake");
        Assert.Equal(2, intake.GetProperty("loggedDays").GetInt32());
        Assert.Equal(500m, intake.GetProperty("averageKcal").GetDecimal());
        Assert.Equal(30m, intake.GetProperty("averageProtein").GetDecimal());

        var days = body.GetProperty("days");
        Assert.Equal(7, days.GetArrayLength());
        var gap = Day(days, "2026-11-09");
        Assert.False(gap.GetProperty("logged").GetBoolean());
        Assert.Equal(JsonValueKind.Null, gap.GetProperty("kcal").ValueKind);
        Assert.Equal(JsonValueKind.Null, gap.GetProperty("protein").ValueKind);
        var logged = Day(days, "2026-11-08");
        Assert.True(logged.GetProperty("logged").GetBoolean());
        Assert.Equal(400m, logged.GetProperty("kcal").GetDecimal());
        Assert.Equal(40m, logged.GetProperty("protein").GetDecimal());
        Assert.True(logged.GetProperty("targetKcal").GetInt32() > 0);
    }

    [Fact]
    public async Task Another_persons_logs_and_weigh_ins_are_not_included()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 9, 0, 0, TimeSpan.Zero);
        using var owner = factory.AsUser(TestData.NewUser("progress-owner"));
        using var other = factory.AsUser(TestData.NewUser("progress-other"));
        await Setup(owner, "2026-11-10", "83.6");
        await Setup(other, "2026-11-10", "70.0");
        Assert.Equal(HttpStatusCode.Created, (await other.PostAsync("/api/log-entries", Json(Quick("other", "2026-11-10", "50", "5")))).StatusCode);

        var body = await owner.GetFromJsonAsync<JsonElement>("/api/progress?range=7d");
        Assert.Equal(83.6m, body.GetProperty("weight").GetProperty("currentKg").GetDecimal());
        Assert.Equal(0, body.GetProperty("intake").GetProperty("loggedDays").GetInt32());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("intake").GetProperty("averageKcal").ValueKind);
    }

    [Fact]
    public async Task All_starts_at_the_first_stored_day_and_one_weigh_in_has_no_change()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("progress-all"));
        await Setup(client, "2026-11-10", "83.6");
        var body = await client.GetFromJsonAsync<JsonElement>("/api/progress?range=all");
        Assert.Equal("2026-11-10", body.GetProperty("from").GetString());
        Assert.Equal(1, body.GetProperty("days").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("weight").GetProperty("changeKg").ValueKind);
        Assert.Equal(1, body.GetProperty("weight").GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task A_target_is_not_applied_before_its_effective_date()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 8, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("progress-target");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-11-08", "83.6");
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsync("/api/log-entries", Json(Quick("early", "2026-11-08", "100", "10")))).StatusCode);
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 9, 0, 0, TimeSpan.Zero);

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = await db.TargetHistories.SingleAsync(item => item.UserId == user);
            row.EffectiveDate = new DateOnly(2026, 11, 10);
            await db.SaveChangesAsync();
        }

        var body = await client.GetFromJsonAsync<JsonElement>("/api/progress?range=7d");
        var before = Day(body.GetProperty("days"), "2026-11-08");
        Assert.True(before.GetProperty("logged").GetBoolean());
        Assert.Equal(100m, before.GetProperty("kcal").GetDecimal());
        Assert.Equal(JsonValueKind.Null, before.GetProperty("targetKcal").ValueKind);
        var on = Day(body.GetProperty("days"), "2026-11-10");
        Assert.False(on.GetProperty("logged").GetBoolean());
        Assert.Equal(JsonValueKind.Null, on.GetProperty("kcal").ValueKind);
        Assert.True(on.GetProperty("targetKcal").GetInt32() > 0);
    }

    private static JsonElement Day(JsonElement days, string date)
    {
        foreach (var day in days.EnumerateArray())
        {
            if (day.GetProperty("date").GetString() == date) return day;
        }

        throw new InvalidOperationException($"Missing {date}.");
    }

    private static async Task Setup(HttpClient client, string date, string kg = "83.6")
    {
        await TestData.PutWeighIn(client, date, $$"""{"kg":{{kg}},"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());
    }

    private static string Quick(string key, string date, string kcal, string protein) =>
        $$"""{"idempotencyKey":"{{key}}","localDate":"{{date}}","timeZone":"UTC","name":"Fictional bar","kcal":{{kcal}},"protein":{{protein}},"fat":1,"carbs":1,"time":"08:00"}""";

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");
}
