using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

/// <summary>
/// The full nutrient panel is snapshotted onto every kind of new log, not only a direct food log.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class NutrientPanelSnapshotTests(ApiFactory factory)
{
    [Fact]
    public async Task Readding_a_group_keeps_the_panel_of_a_food_with_no_calories()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 14, 8, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("panel-group"));
        await Setup(client);
        var broth = await PanelFood(client, "Fictional clear broth", kcalPer100: 0, sodiumPer100: 400, vitaminCPer100: 2);
        var oats = await PanelFood(client, "Fictional panel oats", kcalPer100: 380, sodiumPer100: 5, vitaminCPer100: 0);

        var first = await LogFood(client, "panel-g-1", broth, 250);
        var second = await LogFood(client, "panel-g-2", oats, 60);
        Assert.Equal(1000m, first.GetProperty("nutrients").GetProperty("sodium").GetDecimal());

        var saved = await client.PostAsync("/api/groups", Json(
            $$"""{"name":"Fictional broth breakfast","entryIds":["{{first.GetProperty("id").GetGuid()}}","{{second.GetProperty("id").GetGuid()}}"]}"""));
        Assert.Equal(HttpStatusCode.Created, saved.StatusCode);
        var groupId = (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var readd = await client.PostAsync("/api/groups/" + groupId + "/log", Json(
            """{"localDate":"2026-11-14","timeZone":"UTC","idempotencyKey":"panel-g-readd","time":"12:00"}"""));
        Assert.Equal(HttpStatusCode.Created, readd.StatusCode);

        var day = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-11-14");
        var readded = day.GetProperty("entries").EnumerateArray()
            .Where(row => row.GetProperty("idempotencyKey").GetString()!.StartsWith("panel-g-readd", StringComparison.Ordinal))
            .ToList();
        Assert.Equal(2, readded.Count);
        var brothAgain = readded.Single(row => row.GetProperty("name").GetString() == "Fictional clear broth");
        Assert.Equal(1000m, brothAgain.GetProperty("nutrients").GetProperty("sodium").GetDecimal());
        Assert.Equal(5m, brothAgain.GetProperty("nutrients").GetProperty("vitaminC").GetDecimal());
        var oatsAgain = readded.Single(row => row.GetProperty("name").GetString() == "Fictional panel oats");
        Assert.Equal(3m, oatsAgain.GetProperty("nutrients").GetProperty("sodium").GetDecimal());
    }

    [Fact]
    public async Task Logging_a_recipe_carries_its_share_of_the_panel()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 14, 8, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("panel-recipe"));
        await Setup(client);
        var stock = await PanelFood(client, "Fictional soup stock", kcalPer100: 20, sodiumPer100: 300, vitaminCPer100: 4);

        var created = await client.PostAsync("/api/recipes", Json(
            $$"""{"name":"Fictional soup","portions":4,"finishedGrams":800,"ingredients":[{"foodId":"{{stock}}","amount":800,"unit":"g"}]}"""));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var recipeId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var portion = await client.PostAsync("/api/recipes/" + recipeId + "/log", Json(
            """{"localDate":"2026-11-14","timeZone":"UTC","idempotencyKey":"panel-r-portion","amount":1,"unit":"portion","time":"12:00"}"""));
        Assert.Equal(HttpStatusCode.Created, portion.StatusCode);
        var grams = await client.PostAsync("/api/recipes/" + recipeId + "/log", Json(
            """{"localDate":"2026-11-14","timeZone":"UTC","idempotencyKey":"panel-r-grams","amount":100,"unit":"g","time":"13:00"}"""));
        Assert.Equal(HttpStatusCode.Created, grams.StatusCode);

        var day = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-11-14");
        var byKey = day.GetProperty("entries").EnumerateArray()
            .ToDictionary(row => row.GetProperty("idempotencyKey").GetString()!);
        Assert.Equal(600m, byKey["panel-r-portion"].GetProperty("nutrients").GetProperty("sodium").GetDecimal());
        Assert.Equal(8m, byKey["panel-r-portion"].GetProperty("nutrients").GetProperty("vitaminC").GetDecimal());
        Assert.Equal(300m, byKey["panel-r-grams"].GetProperty("nutrients").GetProperty("sodium").GetDecimal());
        Assert.Equal(4m, byKey["panel-r-grams"].GetProperty("nutrients").GetProperty("vitaminC").GetDecimal());
        Assert.Equal(JsonValueKind.Null, byKey["panel-r-portion"].GetProperty("nutrients").GetProperty("iron").ValueKind);
    }

    [Fact]
    public async Task A_recipe_adds_the_ingredients_that_know_a_value()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 14, 8, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("panel-known"));
        await Setup(client);
        var stock = await PanelFood(client, "Fictional known stock", kcalPer100: 20, sodiumPer100: 300, vitaminCPer100: 4);
        var plain = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional plain noodles",
            kcalPer100 = 140,
            proteinPer100 = 5,
            fatPer100 = 1,
            carbsPer100 = 28,
            basis = "g",
            nutrientBasis = "per_100",
        });
        Assert.Equal(HttpStatusCode.Created, plain.StatusCode);
        var noodles = (await plain.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var created = await client.PostAsync("/api/recipes", Json(
            $$"""{"name":"Fictional noodle soup","portions":2,"finishedGrams":600,"ingredients":[{"foodId":"{{stock}}","amount":400,"unit":"g"},{"foodId":"{{noodles}}","amount":200,"unit":"g"}]}"""));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var recipeId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var logged = await client.PostAsync("/api/recipes/" + recipeId + "/log", Json(
            """{"localDate":"2026-11-14","timeZone":"UTC","idempotencyKey":"panel-k-portion","amount":1,"unit":"portion","time":"12:00"}"""));
        Assert.Equal(HttpStatusCode.Created, logged.StatusCode);

        var day = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-11-14");
        var entry = day.GetProperty("entries").EnumerateArray()
            .Single(row => row.GetProperty("idempotencyKey").GetString() == "panel-k-portion");
        Assert.Equal(600m, entry.GetProperty("nutrients").GetProperty("sodium").GetDecimal());
        Assert.Equal(8m, entry.GetProperty("nutrients").GetProperty("vitaminC").GetDecimal());
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("nutrients").GetProperty("iron").ValueKind);
        Assert.Equal(0, day.GetProperty("totals").GetProperty("nutrients").GetProperty("iron").GetDecimal());
    }

    private static async Task Setup(HttpClient client)
    {
        await TestData.PutWeighIn(client, "2026-11-14", """{"kg":80,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "UTC"));
    }

    private async Task<Guid> PanelFood(HttpClient client, string name, decimal kcalPer100, decimal sodiumPer100, decimal vitaminCPer100)
    {
        var created = await client.PostAsJsonAsync("/api/foods", new
        {
            name,
            kcalPer100,
            proteinPer100 = 0,
            fatPer100 = 0,
            carbsPer100 = 0,
            basis = "g",
            nutrientBasis = "per_100",
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = await db.Foods.SingleAsync(food => food.Id == id);
        row.SodiumPer100 = sodiumPer100;
        row.VitaminCPer100 = vitaminCPer100;
        await db.SaveChangesAsync();
        return id;
    }

    private static async Task<JsonElement> LogFood(HttpClient client, string key, Guid foodId, decimal grams)
    {
        var amount = grams.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var response = await client.PostAsync("/api/log-entries", Json(
            $$"""{"idempotencyKey":"{{key}}","localDate":"2026-11-14","timeZone":"UTC","time":"08:00","foodId":"{{foodId}}","amount":{{amount}},"unit":"g"}"""));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");
}
