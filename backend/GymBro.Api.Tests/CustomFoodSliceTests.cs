using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class CustomFoodSliceTests(ApiFactory factory)
{
    [Fact]
    public async Task A_saved_custom_food_is_private_and_edits_do_not_rewrite_logs()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 4, 1, 8, 0, 0, TimeSpan.Zero);
        var owner = TestData.NewUser("custom-owner");
        var other = TestData.NewUser("custom-other");
        using var client = factory.AsUser(owner);
        using var stranger = factory.AsUser(other);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/me")).StatusCode);
        await TestData.PutWeighIn(client, "2026-04-01", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());

        var created = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional desk shake",
            brand = "Northbar",
            nutrientBasis = "per_serving",
            kcalPer100 = 220,
            proteinPer100 = 30,
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var food = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = food.GetProperty("id").GetGuid();
        Assert.Equal("Northbar", food.GetProperty("brand").GetString());
        Assert.Equal(0, food.GetProperty("fatPer100").GetDecimal());
        Assert.Equal(0, food.GetProperty("carbsPer100").GetDecimal());
        Assert.Equal("per_serving", food.GetProperty("nutrientBasis").GetString());
        Assert.Equal(JsonValueKind.Null, food.GetProperty("servingQuantity").ValueKind);
        Assert.True(food.GetProperty("owned").GetBoolean());

        var twin = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional desk shake",
            brand = "Fitbake",
            nutrientBasis = "per_serving",
            kcalPer100 = 180,
            proteinPer100 = 20,
            fatPer100 = 4,
            carbsPer100 = 8,
        });
        Assert.Equal(HttpStatusCode.Created, twin.StatusCode);

        var byName = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=desk%20shake");
        var rows = byName.GetProperty("foods").EnumerateArray().ToList();
        Assert.Equal(2, rows.Count);
        Assert.Contains(rows, row => row.GetProperty("brand").GetString() == "Northbar" && row.GetProperty("owned").GetBoolean());
        Assert.Contains(rows, row => row.GetProperty("brand").GetString() == "Fitbake");

        var byBrand = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=Northbar");
        Assert.Equal(id, Assert.Single(byBrand.GetProperty("foods").EnumerateArray()).GetProperty("id").GetGuid());

        var mine = await client.GetFromJsonAsync<JsonElement>("/api/foods/mine");
        Assert.Equal(2, mine.GetProperty("foods").GetArrayLength());

        Assert.Equal(0, (await stranger.GetFromJsonAsync<JsonElement>("/api/foods/search?q=desk%20shake")).GetProperty("foods").GetArrayLength());
        Assert.Equal(0, (await stranger.GetFromJsonAsync<JsonElement>("/api/foods/search?q=Northbar")).GetProperty("foods").GetArrayLength());
        Assert.Equal(0, (await stranger.GetFromJsonAsync<JsonElement>("/api/foods/mine")).GetProperty("foods").GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync("/api/foods/" + id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PutAsJsonAsync("/api/foods/" + id, new
        {
            name = "Stolen",
            kcalPer100 = 1,
            nutrientBasis = "per_serving",
        })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.DeleteAsync("/api/foods/" + id)).StatusCode);

        var logged = await client.PostAsJsonAsync("/api/log-entries", Entry("snap-" + id.ToString("N"), id, 1, "serving"));
        Assert.Equal(HttpStatusCode.Created, logged.StatusCode);
        var entry = await logged.Content.ReadFromJsonAsync<JsonElement>();
        var entryId = entry.GetProperty("id").GetGuid();
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("grams").ValueKind);
        Assert.Equal(220, entry.GetProperty("kcal").GetDecimal());
        Assert.Equal("custom", entry.GetProperty("source").GetString());

        var edited = await client.PutAsJsonAsync("/api/foods/" + id, new
        {
            name = "Fictional desk shake",
            brand = "Northbar",
            nutrientBasis = "per_serving",
            kcalPer100 = 250,
            proteinPer100 = 32,
            fatPer100 = 5,
            carbsPer100 = 6,
        });
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
        var kept = await EntryOnDay(client, entryId);
        Assert.Equal(220, kept.GetProperty("kcal").GetDecimal());
        Assert.Equal(JsonValueKind.Null, kept.GetProperty("grams").ValueKind);

        var weighed = await client.PutAsJsonAsync("/api/foods/" + id, new
        {
            name = "Fictional desk shake",
            brand = "Northbar",
            nutrientBasis = "per_serving",
            kcalPer100 = 250,
            proteinPer100 = 32,
            fatPer100 = 5,
            carbsPer100 = 6,
            servingQuantity = 50,
            servingLabel = "shake",
        });
        Assert.Equal(HttpStatusCode.OK, weighed.StatusCode);
        var scaled = await weighed.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("per_100", scaled.GetProperty("nutrientBasis").GetString());
        Assert.Equal(500, scaled.GetProperty("kcalPer100").GetDecimal());
        Assert.Equal(50, scaled.GetProperty("servingQuantity").GetDecimal());
        Assert.Equal("Northbar", scaled.GetProperty("brand").GetString());

        var untouched = await EntryOnDay(client, entryId);
        Assert.Equal(220, untouched.GetProperty("kcal").GetDecimal());
        Assert.Equal(JsonValueKind.Null, untouched.GetProperty("grams").ValueKind);

        var future = await client.PostAsJsonAsync("/api/log-entries", Entry("next-" + id.ToString("N"), id, 1, "serving"));
        Assert.Equal(HttpStatusCode.Created, future.StatusCode);
        var futureBody = await future.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(50, futureBody.GetProperty("grams").GetDecimal());
        Assert.Equal(250, futureBody.GetProperty("kcal").GetDecimal());

        var odd = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional odd bar",
            kcalPer100 = 100,
            proteinPer100 = 1,
            fatPer100 = 1,
            carbsPer100 = 1,
            basis = "g",
        });
        Assert.Equal(HttpStatusCode.Created, odd.StatusCode);
        Assert.Equal(100, (await odd.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("kcalPer100").GetDecimal());

        var tooLong = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional long brand",
            brand = new string('b', 81),
            kcalPer100 = 10,
            proteinPer100 = 1,
            fatPer100 = 0,
            carbsPer100 = 1,
        });
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/foods/" + id)).StatusCode);
        Assert.Equal(0, (await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=Northbar")).GetProperty("foods").GetArrayLength());
        var mineAfter = await client.GetFromJsonAsync<JsonElement>("/api/foods/mine");
        Assert.DoesNotContain(mineAfter.GetProperty("foods").EnumerateArray(), row => row.GetProperty("id").GetGuid() == id);
        var history = await EntryOnDay(client, entryId);
        Assert.Equal(220, history.GetProperty("kcal").GetDecimal());
        Assert.Equal("Fictional desk shake", history.GetProperty("name").GetString());

        var weighted = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional weighed bar",
            brand = "Northbar",
            nutrientBasis = "per_100",
            kcalPer100 = 400,
            proteinPer100 = 30,
            fatPer100 = 12,
            carbsPer100 = 40,
            servingQuantity = 60,
            servingLabel = "bar",
            basis = "g",
        });
        Assert.Equal(HttpStatusCode.Created, weighted.StatusCode);
        var weightedId = (await weighted.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var gramsLog = await client.PostAsJsonAsync("/api/log-entries", Entry("grams-" + weightedId.ToString("N"), weightedId, 100, "g"));
        Assert.Equal(HttpStatusCode.Created, gramsLog.StatusCode);
        Assert.Equal(100, (await gramsLog.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("grams").GetDecimal());
    }

    private static object Entry(string key, Guid foodId, decimal amount, string unit) => new
    {
        idempotencyKey = key,
        localDate = "2026-04-01",
        timeZone = "UTC",
        foodId,
        amount,
        unit,
        kcal = 1,
        protein = 0,
        fat = 0,
        carbs = 0,
    };

    private static async Task<JsonElement> EntryOnDay(HttpClient client, Guid id)
    {
        var list = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-04-01");
        return list.GetProperty("entries").EnumerateArray().Single(row => row.GetProperty("id").GetGuid() == id);
    }
}
