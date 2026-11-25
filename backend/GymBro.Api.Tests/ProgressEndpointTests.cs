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
        Assert.Equal("Use 7d, 30d, 90d, 6m, or all.", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
    }

    [Fact]
    public async Task Empty_days_stay_empty_and_averages_use_only_logged_days()
    {
        var user = TestData.NewUser("progress-days");
        using var client = factory.AsUser(user);
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 8, 9, 0, 0, TimeSpan.Zero);
        await Setup(client, "2026-11-08", "84.0");
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 9, 0, 0, TimeSpan.Zero);
        var secondWeighIn = await client.PutAsync("/api/weigh-ins/2026-11-10", Json("""{"kg":83.6,"timeZone":"UTC"}"""));
        Assert.True(secondWeighIn.IsSuccessStatusCode, await secondWeighIn.Content.ReadAsStringAsync());
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
        // Two weigh-ins 2 days apart: the smoothed line sits between them, drawn solid, with a band.
        Assert.InRange(logged.GetProperty("trendKg").GetDecimal(), 83.61m, 83.99m);
        Assert.True(gap.GetProperty("trendMeasured").GetBoolean());
        Assert.True(gap.GetProperty("trendBandKg").GetDecimal() > 0m);
        Assert.False(Day(days, "2026-11-07").GetProperty("trendMeasured").GetBoolean());
        Assert.Equal(JsonValueKind.Null, Day(days, "2026-11-07").GetProperty("trendBandKg").ValueKind);
        var weight = body.GetProperty("weight");
        Assert.Equal(Day(days, "2026-11-10").GetProperty("trendKg").GetDecimal(), weight.GetProperty("trendKg").GetDecimal());
        Assert.True(weight.GetProperty("bandKg").GetDecimal() > 0m);
        Assert.Equal(JsonValueKind.Null, weight.GetProperty("rateKgPerWeek").ValueKind);
        Assert.Equal(1m, logged.GetProperty("fat").GetDecimal());
        Assert.Equal(1m, logged.GetProperty("carbs").GetDecimal());
        Assert.True(logged.GetProperty("targetFat").GetInt32() > 0);
        Assert.True(logged.GetProperty("targetCarbs").GetInt32() > 0);
        Assert.InRange(body.GetProperty("weight").GetProperty("trendChangeKg").GetDecimal(), -0.39m, 0m);
        Assert.Equal(JsonValueKind.Null, gap.GetProperty("fat").ValueKind);
        Assert.Equal(JsonValueKind.Null, gap.GetProperty("carbs").ValueKind);
        // A quick add has no fibre figure, so a logged day counts it as 0. A day with nothing logged stays null.
        Assert.Equal(0m, logged.GetProperty("fiber").GetDecimal());
        Assert.Equal(JsonValueKind.Null, gap.GetProperty("fiber").ValueKind);

        var food = await client.PostAsync("/api/foods", Json("""{"name":"Fictional bran","kcalPer100":200,"proteinPer100":10,"fatPer100":4,"carbsPer100":30,"fiberPer100":12}"""));
        Assert.True(food.IsSuccessStatusCode, await food.Content.ReadAsStringAsync());
        var foodId = (await food.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var bran = await client.PostAsync("/api/log-entries", Json($$"""{"idempotencyKey":"p-bran","localDate":"2026-11-10","timeZone":"UTC","time":"09:00","foodId":"{{foodId}}","amount":50,"unit":"g"}"""));
        Assert.True(bran.IsSuccessStatusCode, await bran.Content.ReadAsStringAsync());
        var again = await client.GetFromJsonAsync<JsonElement>("/api/progress?range=7d");
        Assert.Equal(6m, Day(again.GetProperty("days"), "2026-11-10").GetProperty("fiber").GetDecimal());
    }

    [Fact]
    public async Task Days_carry_saturated_fat_and_sodium_with_salt_as_the_fallback()
    {
        using var client = factory.AsUser(TestData.NewUser("progress-satfat"));
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 7, 9, 0, 0, TimeSpan.Zero);
        await Setup(client, "2026-11-07");
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 9, 0, 0, TimeSpan.Zero);
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsync("/api/log-entries", Json(Quick("s-quick", "2026-11-09", "300", "10")))).StatusCode);

        // Salt only: 2 g salt per 100 g is 800 mg sodium. Sodium given: 500 mg per 100 g, and its salt is ignored.
        var salted = await Food(client, """{"name":"Fictional crisps","kcalPer100":500,"proteinPer100":6,"fatPer100":30,"carbsPer100":50,"saturatedFatPer100":8,"saltPer100":2}""");
        var soup = await Food(client, """{"name":"Fictional soup","kcalPer100":50,"proteinPer100":2,"fatPer100":1,"carbsPer100":8,"saltPer100":9,"nutrients":{"sodium":500}}""");
        await Log(client, "s-crisps", salted, 50);
        await Log(client, "s-soup", soup, 200);

        var body = await client.GetFromJsonAsync<JsonElement>("/api/progress?range=7d");
        var day = Day(body.GetProperty("days"), "2026-11-10");
        Assert.Equal(4m, day.GetProperty("saturatedFat").GetDecimal());
        Assert.Equal(400m + 1000m, day.GetProperty("sodiumMg").GetDecimal());

        // A quick add has neither, so a logged day counts 0. A day with nothing logged stays null.
        var quick = Day(body.GetProperty("days"), "2026-11-09");
        Assert.Equal(0m, quick.GetProperty("saturatedFat").GetDecimal());
        Assert.Equal(0m, quick.GetProperty("sodiumMg").GetDecimal());
        var empty = Day(body.GetProperty("days"), "2026-11-08");
        Assert.Equal(JsonValueKind.Null, empty.GetProperty("saturatedFat").ValueKind);
        Assert.Equal(JsonValueKind.Null, empty.GetProperty("sodiumMg").ValueKind);

        static async Task<Guid> Food(HttpClient client, string json)
        {
            var response = await client.PostAsync("/api/foods", Json(json));
            Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
            return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        }

        static async Task Log(HttpClient client, string key, Guid foodId, int grams)
        {
            var response = await client.PostAsync("/api/log-entries", Json($$"""{"idempotencyKey":"{{key}}","localDate":"2026-11-10","timeZone":"UTC","time":"09:00","foodId":"{{foodId}}","amount":{{grams}},"unit":"g"}"""));
            Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        }
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
        Assert.Equal(JsonValueKind.Null, body.GetProperty("weight").GetProperty("trendChangeKg").ValueKind);
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
        Assert.Equal(JsonValueKind.Null, before.GetProperty("targetFat").ValueKind);
        Assert.Equal(JsonValueKind.Null, before.GetProperty("targetCarbs").ValueKind);
        var on = Day(body.GetProperty("days"), "2026-11-10");
        Assert.False(on.GetProperty("logged").GetBoolean());
        Assert.Equal(JsonValueKind.Null, on.GetProperty("kcal").ValueKind);
        Assert.True(on.GetProperty("targetKcal").GetInt32() > 0);
    }

    [Fact]
    public async Task Days_and_today_carry_the_burn_and_BMR_in_effect()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("progress-burn");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-11-10", "83.6");

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = await db.TargetHistories.SingleAsync(item => item.UserId == user);
            row.EffectiveDate = new DateOnly(2026, 11, 8);
            row.Tdee = row.FormulaTdee + 300;
            row.BurnSdKcal = 244;
            row.Reasons = ["recalculation_adaptive"];
            await db.SaveChangesAsync();
        }

        var body = await client.GetFromJsonAsync<JsonElement>("/api/progress?range=7d");
        var before = Day(body.GetProperty("days"), "2026-11-07");
        Assert.Equal(JsonValueKind.Null, before.GetProperty("burnKcal").ValueKind);
        Assert.Equal(JsonValueKind.Null, before.GetProperty("bmrKcal").ValueKind);
        Assert.False(before.GetProperty("burnMeasured").GetBoolean());
        var on = Day(body.GetProperty("days"), "2026-11-08");
        Assert.True(on.GetProperty("burnKcal").GetInt32() > on.GetProperty("bmrKcal").GetInt32());
        Assert.Equal(244, on.GetProperty("burnSdKcal").GetInt32());
        Assert.True(on.GetProperty("burnMeasured").GetBoolean());

        var burn = body.GetProperty("burn");
        Assert.Equal(on.GetProperty("burnKcal").GetInt32(), burn.GetProperty("kcal").GetInt32());
        Assert.True(burn.GetProperty("bmrKcal").GetInt32() > 1000);
        // Two days on, the spread has grown a little: √(244² + 60²·2/7) ≈ 246.
        Assert.Equal(246, burn.GetProperty("sdKcal").GetInt32());
        Assert.True(burn.GetProperty("measured").GetBoolean());
        Assert.Equal("2026-11-08", burn.GetProperty("setOn").GetString());
    }

    [Fact]
    public async Task Without_a_target_there_is_no_burn()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("progress-noburn"));
        await TestData.PutWeighIn(client, "2026-11-10", """{"kg":83.6,"timeZone":"UTC"}""");

        var body = await client.GetFromJsonAsync<JsonElement>("/api/progress?range=7d");
        Assert.Equal(JsonValueKind.Null, body.GetProperty("burn").ValueKind);
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
