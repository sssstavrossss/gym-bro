using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class FoodEndpointTests(ApiFactory factory)
{
    [Fact]
    public async Task Matvaretabellen_import_is_repeatable_and_keeps_label_kcal()
    {
        var first = await Import("matvaretabellen-sample.json");
        Assert.Equal(2, first.Upserted);
        Assert.Equal(1, first.Skipped);
        Assert.Equal(0, first.Retired);

        var userA = TestData.NewUser("food-a");
        var userB = TestData.NewUser("food-b");
        using var clientA = factory.AsUser(userA);
        using var clientB = factory.AsUser(userB);
        var found = await clientA.GetFromJsonAsync<JsonElement>("/api/foods/search?q=Fictional%20oat");
        var food = Assert.Single(found.GetProperty("foods").EnumerateArray());
        Assert.Equal(100, food.GetProperty("kcalPer100").GetDecimal());
        Assert.Equal(40, food.GetProperty("servingQuantity").GetDecimal());
        Assert.Equal(12, food.GetProperty("pieceQuantity").GetDecimal());
        Assert.False(food.GetProperty("owned").GetBoolean());
        var id = food.GetProperty("id").GetGuid();

        var shared = await clientB.GetAsync("/api/foods/" + id);
        Assert.Equal(HttpStatusCode.OK, shared.StatusCode);

        var second = await ImportJson("""
            {
              "foods": [
                {
                  "foodId": "test.oat",
                  "foodName": "Fictional oat brick revised",
                  "calories": { "quantity": 100, "unit": "kcal" },
                  "constituents": [
                    { "nutrientId": "Protein", "quantity": 11, "unit": "g" },
                    { "nutrientId": "Fett", "quantity": 10, "unit": "g" },
                    { "nutrientId": "Karbo", "quantity": 10, "unit": "g" }
                  ],
                  "portions": []
                }
              ]
            }
            """);
        Assert.Equal(1, second.Upserted);
        Assert.Equal(1, second.Retired);

        var revised = await clientA.GetFromJsonAsync<JsonElement>("/api/foods/search?q=Fictional%20oat");
        var only = Assert.Single(revised.GetProperty("foods").EnumerateArray());
        Assert.Equal("Fictional oat brick revised", only.GetProperty("name").GetString());
        Assert.Equal(id, only.GetProperty("id").GetGuid());
        var broth = await clientB.GetFromJsonAsync<JsonElement>("/api/foods/search?q=Fictional%20broth");
        Assert.Equal(0, broth.GetProperty("foods").GetArrayLength());

        var about = await clientA.GetFromJsonAsync<JsonElement>("/api/about");
        Assert.Equal("Matvaretabellen 2026. Mattilsynet. www.matvaretabellen.no", about.GetProperty("matvaretabellen").GetString());
        Assert.True(about.GetProperty("foodCount").GetInt32() >= 1);
    }

    [Fact]
    public async Task Local_search_does_not_call_open_food_facts_and_on_demand_caches_label_kcal()
    {
        factory.Off.Reset();
        var user = TestData.NewUser("off");
        using var client = factory.AsUser(user);
        var local = await client.GetAsync("/api/foods/search?q=crunch");
        Assert.Equal(HttpStatusCode.OK, local.StatusCode);
        Assert.Equal(0, factory.Off.Calls);

        factory.Off.Foods =
        [
            new ParsedFood("off", "0000000000017", "0000000000017", "Fictional crunch bar", "g", 100, 10, 10, 10, 40, "bar", null, null),
        ];
        var fetched = await client.PostAsJsonAsync("/api/foods/search/open-food-facts", new { query = "crunch" });
        var body = await fetched.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, fetched.StatusCode);
        Assert.Equal("ok", body.GetProperty("openFoodFacts").GetProperty("status").GetString());
        Assert.Equal(100, body.GetProperty("openFoodFacts").GetProperty("results")[0].GetProperty("kcalPer100").GetDecimal());
        Assert.Equal(1, factory.Off.Calls);

        var cached = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=crunch");
        var row = Assert.Single(cached.GetProperty("foods").EnumerateArray());
        Assert.Equal("off", row.GetProperty("source").GetString());
        Assert.Equal("0000000000017", row.GetProperty("barcode").GetString());
        Assert.Equal(1, factory.Off.Calls);

        factory.Off.Foods =
        [
            new ParsedFood("off", "0000000000017", "0000000000017", "Fictional crunch bar", "g", 110, 10, 10, 10, 40, "bar", null, null),
        ];
        await client.PostAsJsonAsync("/api/foods/search/open-food-facts", new { query = "crunch" });
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var copies = await db.Foods.CountAsync(food => food.Source == "off" && food.SourceId == "0000000000017");
        Assert.Equal(1, copies);
    }

    [Fact]
    public async Task Rate_limit_and_outage_return_local_results_with_a_status()
    {
        factory.Off.Reset();
        var user = TestData.NewUser("limit");
        using var client = factory.AsUser(user);
        var created = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional pea dust",
            kcalPer100 = 50,
            proteinPer100 = 4,
            fatPer100 = 1,
            carbsPer100 = 6,
            basis = "g",
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        factory.Off.Status = OffStatus.RateLimited;
        var limited = await client.PostAsJsonAsync("/api/foods/search/open-food-facts", new { query = "pea dust" });
        var limitedBody = await limited.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("rate_limited", limitedBody.GetProperty("openFoodFacts").GetProperty("status").GetString());
        Assert.Equal(0, limitedBody.GetProperty("openFoodFacts").GetProperty("results").GetArrayLength());
        Assert.Contains("Fictional pea dust", limitedBody.GetProperty("local").ToString());

        factory.Off.Status = OffStatus.Unavailable;
        var down = await client.PostAsJsonAsync("/api/foods/search/open-food-facts", new { query = "pea dust" });
        var downBody = await down.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("unavailable", downBody.GetProperty("openFoodFacts").GetProperty("status").GetString());
        Assert.Contains("Fictional pea dust", downBody.GetProperty("local").ToString());
    }

    [Fact]
    public async Task Custom_foods_are_private_to_their_owner()
    {
        factory.Off.Reset();
        var owner = TestData.NewUser("owner");
        var other = TestData.NewUser("other");
        using var ownerClient = factory.AsUser(owner);
        using var otherClient = factory.AsUser(other);
        var created = await ownerClient.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional secret shake",
            kcalPer100 = 120,
            proteinPer100 = 20,
            fatPer100 = 2,
            carbsPer100 = 3,
            basis = "ml",
            barcode = "1234567890123",
        });
        var food = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = food.GetProperty("id").GetGuid();
        Assert.True(food.GetProperty("owned").GetBoolean());

        var hidden = await otherClient.GetFromJsonAsync<JsonElement>("/api/foods/search?q=secret%20shake");
        Assert.Equal(0, hidden.GetProperty("foods").GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await otherClient.GetAsync("/api/foods/" + id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherClient.DeleteAsync("/api/foods/" + id)).StatusCode);

        var owned = await ownerClient.GetFromJsonAsync<JsonElement>("/api/foods/search?q=1234567890123");
        Assert.Equal(id, Assert.Single(owned.GetProperty("foods").EnumerateArray()).GetProperty("id").GetGuid());

        Assert.Equal(HttpStatusCode.NoContent, (await ownerClient.DeleteAsync("/api/foods/" + id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ownerClient.GetAsync("/api/foods/" + id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ownerClient.DeleteAsync("/api/foods/" + id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherClient.DeleteAsync("/api/foods/" + id)).StatusCode);
        var after = await ownerClient.GetFromJsonAsync<JsonElement>("/api/foods/search?q=secret%20shake");
        Assert.Equal(0, after.GetProperty("foods").GetArrayLength());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = await db.Foods.SingleAsync(food => food.Id == id);
        Assert.NotNull(row.RetiredAt);
        Assert.Equal(owner, row.UserId);
        Assert.Equal("Fictional secret shake", row.Name);
    }

    [Fact]
    public void Open_food_facts_http_client_uses_the_configured_user_agent()
    {
        var http = factory.Services.GetRequiredService<IHttpClientFactory>();
        var client = http.CreateClient("IOpenFoodFactsClient");
        Assert.Equal("GymBroTests/1.0 (api tests)", client.DefaultRequestHeaders.UserAgent.ToString());
    }

    private async Task<MatvaretabellenImportResult> Import(string fileName)
    {
        await using var stream = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Fixtures", fileName));
        return await ImportStream(stream);
    }

    private async Task<MatvaretabellenImportResult> ImportJson(string json)
    {
        await using var stream = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(json));
        return await ImportStream(stream);
    }

    private async Task<MatvaretabellenImportResult> ImportStream(Stream stream)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var importer = scope.ServiceProvider.GetRequiredService<MatvaretabellenImporter>();
        return await importer.ImportAsync(stream, CancellationToken.None);
    }
}
