using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class BarcodeEndpointTests(ApiFactory factory)
{
    [Fact]
    public async Task Own_food_wins_and_a_upc_scan_finds_the_ean_with_a_leading_zero()
    {
        factory.Off.Reset();
        var upc = Code(12);
        var me = factory.AsUser(TestData.NewUser("scan-own"));
        var stranger = factory.AsUser(TestData.NewUser("scan-stranger"));
        await AddCatalogue(new Food { Source = "off", SourceId = "0" + upc, Barcode = "0" + upc, Name = "Fictional catalogue bar" });
        var mine = await Create(me, "Fictional own bar", "0" + upc);
        await Create(stranger, "Fictional stranger bar", "0" + upc);

        var body = await Lookup(me, upc);
        Assert.Equal("found", body.GetProperty("status").GetString());
        Assert.Equal(upc, body.GetProperty("code").GetString());
        Assert.Equal(mine, body.GetProperty("food").GetProperty("id").GetGuid());
        Assert.True(body.GetProperty("food").GetProperty("owned").GetBoolean());

        // Someone else's food never shows; the catalogue row does.
        var other = await Lookup(factory.AsUser(TestData.NewUser("scan-third")), upc);
        Assert.Equal("Fictional catalogue bar", other.GetProperty("food").GetProperty("name").GetString());
        Assert.Equal(0, factory.Off.ProductCalls);
    }

    [Fact]
    public async Task Known_numbers_beat_an_unconfirmed_basis_and_a_retired_food_is_skipped()
    {
        factory.Off.Reset();
        var code = Code(13);
        using var client = factory.AsUser(TestData.NewUser("scan-pick"));
        await AddCatalogue(new Food { Source = "kassalapp", SourceId = code, Barcode = code, Name = "Fictional shop juice", NutrientBasis = NutrientBases.Unconfirmed, Basis = null });
        await AddCatalogue(new Food { Source = "off", SourceId = code, Barcode = code, Name = "Fictional labelled juice" });
        var retired = await Create(client, "Fictional old juice", code);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/foods/" + retired)).StatusCode);

        var body = await Lookup(client, code);
        Assert.Equal("Fictional labelled juice", body.GetProperty("food").GetProperty("name").GetString());
    }

    [Fact]
    public async Task Unknown_code_is_fetched_from_open_food_facts_once_and_then_found_here()
    {
        factory.Off.Reset();
        var code = Code(13);
        using var client = factory.AsUser(TestData.NewUser("scan-off"));
        factory.Off.Product = new ParsedFood("off", code, code, "Fictional scanned crisps", "g", 520, 6, 30, 55, 25, "bag", null, null);

        var first = await Lookup(client, $"{code[..1]} {code[1..7]} {code[7..]}");
        Assert.Equal("found", first.GetProperty("status").GetString());
        Assert.Equal(code, factory.Off.LastCode);
        Assert.Equal("off", first.GetProperty("food").GetProperty("source").GetString());
        Assert.Equal(520, first.GetProperty("food").GetProperty("kcalPer100").GetDecimal());

        var again = await Lookup(client, code);
        Assert.Equal(first.GetProperty("food").GetProperty("id").GetGuid(), again.GetProperty("food").GetProperty("id").GetGuid());
        Assert.Equal(1, factory.Off.ProductCalls);
    }

    [Theory]
    [InlineData(OffStatus.Ok, "not_found")]
    [InlineData(OffStatus.RateLimited, "rate_limited")]
    [InlineData(OffStatus.Unavailable, "unavailable")]
    public async Task A_miss_says_why_and_has_no_food(OffStatus off, string status)
    {
        factory.Off.Reset();
        factory.Off.ProductStatus = off;
        using var client = factory.AsUser(TestData.NewUser("scan-miss"));
        var body = await Lookup(client, Code(8));
        Assert.Equal(status, body.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("food").ValueKind);
    }

    [Theory]
    [InlineData("1234567")]
    [InlineData("123456789012345")]
    [InlineData("12345abc")]
    public async Task A_code_that_is_not_8_to_14_digits_is_refused(string code)
    {
        factory.Off.Reset();
        using var client = factory.AsUser(TestData.NewUser("scan-bad"));
        var response = await client.GetAsync("/api/foods/barcode/" + Uri.EscapeDataString(code));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, factory.Off.ProductCalls);
    }

    [Theory]
    [InlineData("012345678905", new[] { "012345678905", "0012345678905" })]
    [InlineData("0012345678905", new[] { "0012345678905", "012345678905" })]
    [InlineData("7038010009457", new[] { "7038010009457" })]
    [InlineData("96385074", new[] { "96385074" })]
    public void Candidates_cover_upc_and_ean_spellings(string code, string[] expected) =>
        Assert.Equal(expected, BarcodeLookup.Candidates(code));

    private static string Code(int length) =>
        "2" + string.Concat(Enumerable.Range(0, length - 1).Select(_ => Random.Shared.Next(10)));

    private static async Task<JsonElement> Lookup(HttpClient client, string code)
    {
        var response = await client.GetAsync("/api/foods/barcode/" + Uri.EscapeDataString(code));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<Guid> Create(HttpClient client, string name, string barcode)
    {
        var response = await client.PostAsJsonAsync("/api/foods", new
        {
            name,
            barcode,
            kcalPer100 = 400,
            proteinPer100 = 5,
            fatPer100 = 20,
            carbsPer100 = 50,
            basis = "g",
            nutrientBasis = "per_100",
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    private async Task AddCatalogue(Food food)
    {
        food.Id = Guid.NewGuid();
        food.KcalPer100 = 100;
        food.UpdatedAt = factory.Clock.GetUtcNow();
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Foods.Add(food);
        await db.SaveChangesAsync();
    }
}
