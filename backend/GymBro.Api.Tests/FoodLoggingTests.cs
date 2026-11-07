using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class FoodLoggingTests(ApiFactory factory)
{
    [Fact]
    public void English_catalog_url_is_the_en_sibling_of_the_nb_file()
    {
        Assert.Equal(
            "https://www.matvaretabellen.no/api/en/foods.json",
            MatvaretabellenImporter.EnglishUrl("https://www.matvaretabellen.no/api/nb/foods.json"));
        Assert.Null(MatvaretabellenImporter.EnglishUrl("https://example.test/foods.json"));
    }

    [Fact]
    public async Task Chicken_and_kylling_find_the_same_food_and_a_second_import_does_not_duplicate_it()
    {
        var first = await Import(Norwegian("\"foodNameEn\": \"kept if no english file\","), English("Fictional chicken fillet"));
        Assert.Equal(1, first.Upserted);

        var user = TestData.NewUser("mvt-search");
        using var client = factory.AsUser(user);
        var byNorwegian = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=kylling");
        var byEnglish = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=chicken");
        var norwegian = Assert.Single(byNorwegian.GetProperty("foods").EnumerateArray(), row => row.GetProperty("sourceId").GetString() == "test.kylling");
        var english = Assert.Single(byEnglish.GetProperty("foods").EnumerateArray(), row => row.GetProperty("sourceId").GetString() == "test.kylling");
        Assert.Equal(norwegian.GetProperty("id").GetGuid(), english.GetProperty("id").GetGuid());
        Assert.Equal("Fictional kylling fillet", norwegian.GetProperty("name").GetString());
        Assert.Equal("Fictional chicken fillet", norwegian.GetProperty("nameEn").GetString());
        Assert.Equal("mvt", norwegian.GetProperty("source").GetString());
        Assert.False(norwegian.GetProperty("owned").GetBoolean());
        Assert.Equal(60, norwegian.GetProperty("pieceQuantity").GetDecimal());

        var other = TestData.NewUser("mvt-search-b");
        using var otherClient = factory.AsUser(other);
        var shared = await otherClient.GetFromJsonAsync<JsonElement>("/api/foods/search?q=chicken");
        Assert.Contains(shared.GetProperty("foods").EnumerateArray(), row => row.GetProperty("id").GetGuid() == norwegian.GetProperty("id").GetGuid());

        var second = await Import(Norwegian(""), English("Fictional chicken fillet revised"));
        Assert.Equal(1, second.Upserted);
        var again = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=chicken");
        var revised = Assert.Single(again.GetProperty("foods").EnumerateArray(), row => row.GetProperty("sourceId").GetString() == "test.kylling");
        Assert.Equal(norwegian.GetProperty("id").GetGuid(), revised.GetProperty("id").GetGuid());
        Assert.Equal("Fictional chicken fillet revised", revised.GetProperty("nameEn").GetString());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var copies = await db.Foods.CountAsync(food => food.Source == "mvt" && food.SourceId == "test.kylling");
        Assert.Equal(1, copies);
        await RetireFixture();
    }

    [Fact]
    public async Task Logging_a_food_stores_the_snapshot_and_editing_scales_that_snapshot()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        await Import(Norwegian(""), English("Fictional chicken fillet"));
        var user = TestData.NewUser("mvt-log");
        var stranger = TestData.NewUser("mvt-log-b");
        using var client = factory.AsUser(user);
        using var other = factory.AsUser(stranger);
        await Setup(client);
        await Setup(other);

        var found = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=kylling");
        var foodId = found.GetProperty("foods").EnumerateArray().Single(row => row.GetProperty("sourceId").GetString() == "test.kylling").GetProperty("id").GetGuid();

        var created = await client.PostAsync("/api/log-entries", Json(Entry("snap-1", foodId, "2", "piece", "\"kcal\":1,\"protein\":1,\"fat\":1,\"carbs\":1")));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("mvt", body.GetProperty("source").GetString());
        Assert.Equal("test.kylling", body.GetProperty("sourceId").GetString());
        Assert.Equal("Fictional kylling fillet", body.GetProperty("name").GetString());
        Assert.Equal(120, body.GetProperty("grams").GetDecimal());
        Assert.Equal(240, body.GetProperty("kcal").GetDecimal());
        Assert.Equal(36, body.GetProperty("protein").GetDecimal());
        Assert.Equal(2, body.GetProperty("amount").GetDecimal());
        Assert.Equal("piece", body.GetProperty("unit").GetString());
        Assert.Equal("UTC", body.GetProperty("timeZone").GetString());
        var id = body.GetProperty("id").GetGuid();

        var replay = await client.PostAsync("/api/log-entries", Json(Entry("snap-1", foodId, "9", "g", "\"kcal\":9")));
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal(id, (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid());

        var grams = await client.PostAsync("/api/log-entries", Json(Entry("snap-g", foodId, "150", "g", "\"kcal\":1,\"protein\":1,\"fat\":1,\"carbs\":1")));
        var gramBody = await grams.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(300, gramBody.GetProperty("kcal").GetDecimal());
        Assert.Equal(150, gramBody.GetProperty("grams").GetDecimal());
        var gramId = gramBody.GetProperty("id").GetGuid();

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var food = await db.Foods.SingleAsync(row => row.Id == foodId);
            food.KcalPer100 = 50;
            food.PieceQuantity = 70;
            await db.SaveChangesAsync();
        }

        var pieces = await client.PatchAsync($"/api/log-entries/{id}", Json("""{"amount":3,"unit":"piece"}"""));
        Assert.Equal(HttpStatusCode.OK, pieces.StatusCode);
        var scaledPieces = await pieces.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(180, scaledPieces.GetProperty("grams").GetDecimal());
        Assert.Equal(360, scaledPieces.GetProperty("kcal").GetDecimal());
        Assert.Equal(54, scaledPieces.GetProperty("protein").GetDecimal());

        var doubled = await client.PatchAsync($"/api/log-entries/{gramId}", Json("""{"amount":300,"unit":"g"}"""));
        var doubledBody = await doubled.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(600, doubledBody.GetProperty("kcal").GetDecimal());
        Assert.Equal(300, doubledBody.GetProperty("grams").GetDecimal());

        var loggedByOther = await other.PostAsync("/api/log-entries", Json(Entry("snap-other", foodId, "100", "g")));
        Assert.Equal(HttpStatusCode.Created, loggedByOther.StatusCode);
        Assert.Equal("mvt", (await loggedByOther.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("source").GetString());

        var custom = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional serving bar",
            kcalPer100 = 80,
            proteinPer100 = 10,
            fatPer100 = 2,
            carbsPer100 = 3,
            nutrientBasis = "per_serving",
        });
        var customId = (await custom.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var stolen = await other.PostAsync("/api/log-entries", Json(Entry("steal", customId, "1", "serving")));
        Assert.Equal(HttpStatusCode.NotFound, stolen.StatusCode);
        var own = await client.PostAsync("/api/log-entries", Json(Entry("serve-1", customId, "1", "serving", "\"kcal\":1")));
        Assert.Equal(HttpStatusCode.Created, own.StatusCode);
        var serving = await own.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, serving.GetProperty("grams").ValueKind);
        Assert.Equal(80, serving.GetProperty("kcal").GetDecimal());
        Assert.Equal("custom", serving.GetProperty("source").GetString());
        var servingId = serving.GetProperty("id").GetGuid();
        var two = await client.PatchAsync($"/api/log-entries/{servingId}", Json("""{"amount":2,"unit":"serving"}"""));
        var twoBody = await two.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(160, twoBody.GetProperty("kcal").GetDecimal());
        Assert.Equal(JsonValueKind.Null, twoBody.GetProperty("grams").ValueKind);
        await RetireFixture();
    }

    [Fact]
    public async Task Food_amounts_use_the_plain_limits_and_require_grams()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        await Import(Norwegian(""), English("Fictional chicken fillet"));
        using var client = factory.AsUser(TestData.NewUser("mvt-limits"));
        await Setup(client);
        var found = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=kylling");
        var foodId = found.GetProperty("foods").EnumerateArray().Single(row => row.GetProperty("sourceId").GetString() == "test.kylling").GetProperty("id").GetGuid();

        var zero = await client.PostAsync("/api/log-entries", Json(Entry("lim-0", foodId, "0", "g")));
        Assert.Equal(HttpStatusCode.BadRequest, zero.StatusCode);
        Assert.Contains("10,000", await zero.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/log-entries", Json(Entry("lim-1", foodId, "10001", "g")))).StatusCode);

        var half = await client.PostAsync("/api/log-entries", Json(Entry("lim-2", foodId, "\"0,5\"", "g")));
        Assert.Equal(HttpStatusCode.Created, half.StatusCode);
        Assert.Equal(0.5m, (await half.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("grams").GetDecimal());
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsync("/api/log-entries", Json(Entry("lim-3", foodId, "10000", "g")))).StatusCode);

        var tooMany = await client.PostAsync("/api/log-entries", Json(Entry("lim-4", foodId, "51", "serving")));
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
        Assert.Contains("50", await tooMany.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        var fifty = await client.PostAsync("/api/log-entries", Json(Entry("lim-5", foodId, "50", "serving")));
        Assert.Equal(HttpStatusCode.Created, fifty.StatusCode);
        Assert.Equal(2000, (await fifty.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("grams").GetDecimal());

        var millilitres = await client.PostAsync("/api/log-entries", Json(Entry("lim-6", foodId, "100", "ml")));
        Assert.Equal(HttpStatusCode.BadRequest, millilitres.StatusCode);
        Assert.Contains("grams", await millilitres.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);

        var bare = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional plain oats",
            kcalPer100 = 100,
            proteinPer100 = 3,
            fatPer100 = 2,
            carbsPer100 = 15,
            basis = "g",
        });
        var bareId = (await bare.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var noPiece = await client.PostAsync("/api/log-entries", Json(Entry("lim-7", bareId, "1", "piece")));
        Assert.Equal(HttpStatusCode.BadRequest, noPiece.StatusCode);
        Assert.Contains("piece", await noPiece.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        await RetireFixture();
    }

    [Fact]
    public async Task Two_requests_with_one_key_create_one_food_entry()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        await Import(Norwegian(""), English("Fictional chicken fillet"));
        using var client = factory.AsUser(TestData.NewUser("mvt-race"));
        await Setup(client);
        var found = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=chicken");
        var foodId = found.GetProperty("foods").EnumerateArray().Single(row => row.GetProperty("sourceId").GetString() == "test.kylling").GetProperty("id").GetGuid();
        var payload = Json(Entry("race-1", foodId, "100", "g"));
        var payloadAgain = Json(Entry("race-1", foodId, "100", "g"));
        var both = await Task.WhenAll(
            client.PostAsync("/api/log-entries", payload),
            client.PostAsync("/api/log-entries", payloadAgain));
        Assert.All(both, response => Assert.True(response.StatusCode is HttpStatusCode.Created or HttpStatusCode.OK));
        var ids = await Task.WhenAll(both.Select(async response => (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid()));
        Assert.Equal(ids[0], ids[1]);
        var list = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(1, list.GetProperty("entries").GetArrayLength());
        await RetireFixture();
    }

    [Fact]
    public async Task Food_logs_keep_the_date_window_time_zone_and_soft_delete()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        await Import(Norwegian(""), English("Fictional chicken fillet"));
        using var client = factory.AsUser(TestData.NewUser("mvt-window"));
        await Setup(client);
        var found = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=kylling");
        var foodId = found.GetProperty("foods").EnumerateArray().Single(row => row.GetProperty("sourceId").GetString() == "test.kylling").GetProperty("id").GetGuid();

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/log-entries", Json(Entry("win-0", foodId, "100", "g", zone: "Not/AZone")))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/log-entries", Json(Entry("win-1", foodId, "100", "g", date: "2026-10-25")))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/log-entries", Json(Entry("win-2", foodId, "100", "g", date: "2026-10-23")))).StatusCode);

        var created = await client.PostAsync("/api/log-entries", Json(Entry("win-3", foodId, "100", "g", "\"time\":\"09:15\"")));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = body.GetProperty("id").GetGuid();
        Assert.Equal("09:15", body.GetProperty("time").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/log-entries/{id}")).StatusCode);
        var hidden = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(0, hidden.GetProperty("entries").GetArrayLength());
        var restored = await client.PostAsync($"/api/log-entries/{id}/restore", new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.OK, restored.StatusCode);
        var back = await restored.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(id, back.GetProperty("id").GetGuid());
        Assert.Equal(200, back.GetProperty("kcal").GetDecimal());
        Assert.Equal("Fictional kylling fillet", back.GetProperty("name").GetString());
        await RetireFixture();
    }

    /// <summary>
    /// The shared test database treats a missing source id as retired.
    /// Leave the fixture inactive so the sample import still sees no new retirement.
    /// </summary>
    private async Task RetireFixture()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rows = await db.Foods.Where(food => food.SourceId == "test.kylling").ToListAsync();
        var now = DateTimeOffset.UtcNow;
        foreach (var row in rows)
        {
            row.RetiredAt ??= now;
        }

        if (rows.Count > 0)
        {
            await db.SaveChangesAsync();
        }
    }

    private static string Norwegian(string extraFields) =>
        """
        {
          "foods": [
            {
              "foodId": "test.kylling",
              "foodName": "Fictional kylling fillet",
        """ + extraFields + """
              "calories": { "quantity": 200, "unit": "kcal" },
              "constituents": [
                { "nutrientId": "Protein", "quantity": 30, "unit": "g" },
                { "nutrientId": "Fett", "quantity": 4, "unit": "g" },
                { "nutrientId": "Karbo", "quantity": 0, "unit": "g" }
              ],
              "portions": [
                { "id": "porsjon", "portionName": "porsjon", "portionUnit": "stk", "quantity": 40, "unit": "g" },
                { "id": "stk", "portionName": "filet", "portionUnit": "stk", "quantity": 60, "unit": "g" }
              ]
            }
          ]
        }
        """;

    private static string English(string name) =>
        "{ \"foods\": [ { \"foodId\": \"test.kylling\", \"foodName\": \"" + name + "\" } ] }";

    private async Task<MatvaretabellenImportResult> Import(string norwegian, string english)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var importer = scope.ServiceProvider.GetRequiredService<MatvaretabellenImporter>();
        await using var nb = new MemoryStream(Encoding.UTF8.GetBytes(norwegian));
        await using var en = new MemoryStream(Encoding.UTF8.GetBytes(english));
        return await importer.ImportAsync(nb, en, CancellationToken.None);
    }

    private static async Task Setup(HttpClient client)
    {
        await TestData.PutWeighIn(client, "2026-10-24", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "UTC"));
    }

    private static string Entry(string key, Guid foodId, string amount, string unit, string? extra = null, string? date = null, string zone = "UTC")
    {
        var tail = string.IsNullOrEmpty(extra) ? "" : "," + extra;
        var day = date ?? "2026-10-24";
        return $$"""
            {"idempotencyKey":"{{key}}","localDate":"{{day}}","timeZone":"{{zone}}","foodId":"{{foodId}}","amount":{{amount}},"unit":"{{unit}}"{{tail}}}
            """;
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");
}
