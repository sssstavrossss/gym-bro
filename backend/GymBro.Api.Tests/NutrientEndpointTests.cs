using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class NutrientEndpointTests(ApiFactory factory)
{
    [Fact]
    public async Task Week_averages_the_panel_over_logged_days_in_the_seven_ending_on_the_date()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("nutrient-week");
        var other = TestData.NewUser("nutrient-week-other");
        using var client = factory.AsUser(user);
        using var otherClient = factory.AsUser(other);
        await Setup(client, "2026-11-16");
        await Setup(otherClient, "2026-11-16");
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 20, 8, 0, 0, TimeSpan.Zero);

        var bar = await CustomFood(client, "Fictional week bar", """{"vitaminC":50,"iron":2}""");
        await LogFood(client, "week-1", "2026-11-16", bar, 100);
        await LogFood(client, "week-2", "2026-11-18", bar, 200);
        await QuickAdd(client, "week-quick", "2026-11-18");

        var week = await client.GetFromJsonAsync<JsonElement>("/api/nutrients/week?date=2026-11-20");
        Assert.Equal("2026-11-14", week.GetProperty("from").GetString());
        Assert.Equal("2026-11-20", week.GetProperty("to").GetString());
        // Two logged days: 50 mg and 100 mg of vitamin C. Days without a log are left out.
        Assert.Equal(2, week.GetProperty("loggedDays").GetInt32());
        Assert.Equal(75m, week.GetProperty("average").GetProperty("vitaminC").GetDecimal());
        Assert.Equal(3m, week.GetProperty("average").GetProperty("iron").GetDecimal());
        Assert.Equal(0m, week.GetProperty("average").GetProperty("zinc").GetDecimal());

        var early = await client.GetFromJsonAsync<JsonElement>("/api/nutrients/week?date=2026-11-17");
        Assert.Equal(1, early.GetProperty("loggedDays").GetInt32());
        Assert.Equal(50m, early.GetProperty("average").GetProperty("vitaminC").GetDecimal());

        var others = await otherClient.GetFromJsonAsync<JsonElement>("/api/nutrients/week?date=2026-11-20");
        Assert.Equal(0, others.GetProperty("loggedDays").GetInt32());
        Assert.Empty(others.GetProperty("average").EnumerateObject());

        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/nutrients/week?date=soon")).StatusCode);
    }

    [Fact]
    public async Task Sources_rank_the_callers_logged_foods_by_the_nutrient_per_100()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("nutrient-sources");
        var other = TestData.NewUser("nutrient-sources-other");
        using var client = factory.AsUser(user);
        using var otherClient = factory.AsUser(other);
        await Setup(client, "2026-11-16");
        await Setup(otherClient, "2026-11-16");

        var kiwi = await CustomFood(client, "Fictional sources kiwi", """{"vitaminC":90}""");
        var apple = await CustomFood(client, "Fictional sources apple", """{"vitaminC":10}""");
        var bread = await CustomFood(client, "Fictional sources bread", """{"vitaminC":0}""");
        var unlogged = await CustomFood(client, "Fictional sources pepper", """{"vitaminC":150}""");
        await LogFood(client, "src-apple", "2026-11-16", apple, 100);
        await LogFood(client, "src-kiwi", "2026-11-16", kiwi, 75);
        await LogFood(client, "src-kiwi-again", "2026-11-16", kiwi, 75);
        await LogFood(client, "src-bread", "2026-11-16", bread, 50);
        Assert.NotEqual(Guid.Empty, unlogged);

        var sources = await client.GetFromJsonAsync<JsonElement>("/api/nutrients/vitaminC/sources");
        Assert.Equal("vitaminC", sources.GetProperty("nutrient").GetString());
        var foods = sources.GetProperty("foods").EnumerateArray().ToList();
        Assert.Equal([kiwi, apple], foods.Select(food => food.GetProperty("id").GetGuid()));
        Assert.Equal(90m, foods[0].GetProperty("per100").GetDecimal());
        Assert.Equal("g", foods[0].GetProperty("basis").GetString());

        var othersView = await otherClient.GetFromJsonAsync<JsonElement>("/api/nutrients/vitaminC/sources");
        Assert.Empty(othersView.GetProperty("foods").EnumerateArray());

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/nutrients/kcal/sources")).StatusCode);
    }

    [Fact]
    public async Task Fat_limits_are_a_setting_without_a_target_change()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("fat-limits");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-11-16", """{"kg":83.6,"timeZone":"UTC"}""");
        var saved = await TestData.PutProfile(client, TestData.Profile());
        Assert.Equal("normal", saved.GetProperty("profile").GetProperty("fatLimits").GetString());

        var lower = await client.PutAsJsonAsync("/api/profile/settings", new { fatLimits = "lower" });
        Assert.Equal(HttpStatusCode.OK, lower.StatusCode);
        Assert.Equal("lower", (await lower.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("fatLimits").GetString());
        var state = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal("lower", state.GetProperty("profile").GetProperty("fatLimits").GetString());

        Assert.Equal(1, await HistoryCount(user));

        var bad = await client.PutAsJsonAsync("/api/profile/settings", new { fatLimits = "strict" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        state = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal("lower", state.GetProperty("profile").GetProperty("fatLimits").GetString());
    }

    private async Task<int> HistoryCount(string userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.TargetHistories.CountAsync(row => row.UserId == userId);
    }

    private static async Task Setup(HttpClient client, string date)
    {
        await TestData.PutWeighIn(client, date, """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "UTC"));
    }

    private static async Task<Guid> CustomFood(HttpClient client, string name, string nutrients)
    {
        var json = $$"""
            {"name":"{{name}}","brand":null,"barcode":null,"basis":"g","nutrientBasis":"per_100","kcalPer100":60,"proteinPer100":1,"fatPer100":0.5,"carbsPer100":12,"nutrients":{{nutrients}}}
            """;
        var response = await client.PostAsync("/api/foods", Json(json));
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, body);
        return JsonDocument.Parse(body).RootElement.GetProperty("id").GetGuid();
    }

    private static async Task LogFood(HttpClient client, string key, string date, Guid foodId, decimal amount)
    {
        var amountText = amount.ToString(CultureInfo.InvariantCulture);
        var json = $$"""
            {"idempotencyKey":"{{key}}","localDate":"{{date}}","timeZone":"UTC","time":"08:00","name":"client name","kcal":1,"protein":1,"fat":1,"carbs":1,"foodId":"{{foodId}}","amount":{{amountText}},"unit":"g"}
            """;
        var response = await client.PostAsync("/api/log-entries", Json(json));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
    }

    private static async Task QuickAdd(HttpClient client, string key, string date)
    {
        var json = $$"""
            {"idempotencyKey":"{{key}}","localDate":"{{date}}","timeZone":"UTC","time":"12:00","name":"Fictional loose bar","kcal":400,"protein":10,"fat":10,"carbs":60}
            """;
        var response = await client.PostAsync("/api/log-entries", Json(json));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");
}
