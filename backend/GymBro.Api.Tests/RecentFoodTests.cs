using System.Globalization;
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
public sealed class RecentFoodTests(ApiFactory factory)
{
    [Fact]
    public async Task Recents_keep_each_users_last_amount_and_drop_deleted_entries()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 18, 0, 0, TimeSpan.Zero);
        factory.Off.Reset();
        var userA = TestData.NewUser("recent-a");
        var userB = TestData.NewUser("recent-b");
        using var clientA = factory.AsUser(userA);
        using var clientB = factory.AsUser(userB);
        await Setup(clientA, "2026-10-24");
        await Setup(clientB, "2026-10-24");

        var oats = await CatalogueFood("Fictional recent oats", 100);
        var yoghurt = await CatalogueFood("Fictional recent yoghurt", 80);
        var first = await LogFood(clientA, "a-oats-100", "2026-10-24", oats, 100, "g", "08:00");
        await LogFood(clientA, "a-yoghurt", "2026-10-24", yoghurt, 150, "g", "09:00");
        var later = await LogFood(clientA, "a-oats-250", "2026-10-24", oats, 250, "g", "10:00");
        await LogFood(clientB, "b-oats", "2026-10-24", oats, 50, "g", "11:00");
        var quick = await clientA.PostAsync("/api/log-entries", Json("""
            {"idempotencyKey":"a-quick","localDate":"2026-10-24","timeZone":"UTC","name":"Fictional loose bar","kcal":40,"protein":1,"fat":1,"carbs":1,"time":"12:00"}
            """));
        Assert.Equal(HttpStatusCode.Created, quick.StatusCode);

        var recentsA = await clientA.GetFromJsonAsync<JsonElement>("/api/foods/recents");
        var rowsA = recentsA.GetProperty("foods").EnumerateArray().ToList();
        Assert.Equal(2, rowsA.Count);
        Assert.Equal(oats, rowsA[0].GetProperty("id").GetGuid());
        Assert.Equal(250, rowsA[0].GetProperty("amount").GetDecimal());
        Assert.Equal("g", rowsA[0].GetProperty("unit").GetString());
        Assert.Equal(yoghurt, rowsA[1].GetProperty("id").GetGuid());
        Assert.Equal(150, rowsA[1].GetProperty("amount").GetDecimal());
        Assert.DoesNotContain(rowsA, row => row.GetProperty("name").GetString() == "Fictional loose bar");

        var recentsB = await clientB.GetFromJsonAsync<JsonElement>("/api/foods/recents");
        var rowB = Assert.Single(recentsB.GetProperty("foods").EnumerateArray());
        Assert.Equal(oats, rowB.GetProperty("id").GetGuid());
        Assert.Equal(50, rowB.GetProperty("amount").GetDecimal());
        Assert.Equal("g", rowB.GetProperty("unit").GetString());
        Assert.DoesNotContain("250", rowB.ToString(), StringComparison.Ordinal);

        Assert.Equal(HttpStatusCode.NoContent, (await clientA.DeleteAsync("/api/log-entries/" + later.GetProperty("id").GetGuid())).StatusCode);
        var afterDelete = await clientA.GetFromJsonAsync<JsonElement>("/api/foods/recents");
        var oatsAgain = afterDelete.GetProperty("foods").EnumerateArray().Single(row => row.GetProperty("id").GetGuid() == oats);
        Assert.Equal(100, oatsAgain.GetProperty("amount").GetDecimal());
        Assert.Equal("g", oatsAgain.GetProperty("unit").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await clientA.DeleteAsync("/api/log-entries/" + first.GetProperty("id").GetGuid())).StatusCode);
        var gone = await clientA.GetFromJsonAsync<JsonElement>("/api/foods/recents");
        Assert.DoesNotContain(gone.GetProperty("foods").EnumerateArray(), row => row.GetProperty("id").GetGuid() == oats);
        var stillB = Assert.Single((await clientB.GetFromJsonAsync<JsonElement>("/api/foods/recents")).GetProperty("foods").EnumerateArray());
        Assert.Equal(50, stillB.GetProperty("amount").GetDecimal());

        var opened = await clientA.GetAsync("/api/foods/" + yoghurt);
        Assert.Equal(HttpStatusCode.OK, opened.StatusCode);
        Assert.Equal(0, factory.Off.ProductCalls);
        Assert.Equal(0, factory.Off.Calls);
    }

    [Fact]
    public async Task One_tap_add_stores_the_last_amount_at_the_current_time()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 15, 42, 0, TimeSpan.Zero);
        var user = TestData.NewUser("recent-tap");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-10-24");
        var foodId = await CatalogueFood("Fictional tap oats", 200);
        await LogFood(client, "tap-first", "2026-10-24", foodId, 40, "g", "09:15");

        var recent = Assert.Single((await client.GetFromJsonAsync<JsonElement>("/api/foods/recents")).GetProperty("foods").EnumerateArray());
        Assert.Equal(40, recent.GetProperty("amount").GetDecimal());
        Assert.Equal("g", recent.GetProperty("unit").GetString());

        var added = await LogFood(client, "tap-again", "2026-10-24", foodId, recent.GetProperty("amount").GetDecimal(), recent.GetProperty("unit").GetString()!, null, "999");
        Assert.Equal("15:42", added.GetProperty("time").GetString());
        Assert.Equal(40, added.GetProperty("amount").GetDecimal());
        Assert.Equal("g", added.GetProperty("unit").GetString());
        Assert.Equal(80, added.GetProperty("kcal").GetDecimal());
        Assert.Equal("Fictional tap oats", added.GetProperty("name").GetString());
        Assert.NotEqual(999, added.GetProperty("kcal").GetDecimal());

        var day = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(2, day.GetProperty("entries").GetArrayLength());
        Assert.Equal(160, day.GetProperty("totals").GetProperty("kcal").GetDecimal());
    }

    [Fact]
    public async Task Open_food_facts_stays_local_until_asked_and_reports_missing_calories()
    {
        factory.Off.Reset();
        var user = TestData.NewUser("off-ask");
        using var client = factory.AsUser(user);
        var local = await client.GetAsync("/api/foods/search?q=fictional%20pack");
        Assert.Equal(HttpStatusCode.OK, local.StatusCode);
        Assert.Equal(0, factory.Off.Calls);
        Assert.Equal(0, factory.Off.ProductCalls);

        factory.Off.MissingKcal = 1;
        factory.Off.Foods =
        [
            new ParsedFood("off", "0000000099994", "0000000099994", "Fictional labeled pack", "g", 90, 8, 2, 10, null, null, null, null),
        ];
        var asked = await client.PostAsJsonAsync("/api/foods/search/open-food-facts", new { query = "fictional pack" });
        var body = await asked.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, asked.StatusCode);
        Assert.Equal(1, factory.Off.Calls);
        Assert.Equal("ok", body.GetProperty("openFoodFacts").GetProperty("status").GetString());
        Assert.Equal(1, body.GetProperty("openFoodFacts").GetProperty("missingKcal").GetInt32());
        var shown = Assert.Single(body.GetProperty("openFoodFacts").GetProperty("results").EnumerateArray());
        Assert.Equal(90, shown.GetProperty("kcalPer100").GetDecimal());
        Assert.Equal("Fictional labeled pack", shown.GetProperty("name").GetString());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var stored = await db.Foods.SingleAsync(food => food.Source == "off" && food.Barcode == "0000000099994");
        Assert.Equal(90, stored.KcalPer100);
    }

    [Fact]
    public async Task Cached_product_refreshes_only_after_30_days_and_old_logs_keep_their_snapshot()
    {
        var cachedAt = new DateTimeOffset(2026, 10, 1, 8, 0, 0, TimeSpan.Zero);
        factory.Clock.UtcNow = cachedAt;
        factory.Off.Reset();
        var code = "999100" + Guid.NewGuid().ToString("N")[..8];
        factory.Off.Foods =
        [
            new ParsedFood("off", code, code, "Fictional cached bar", "g", 100, 10, 1, 10, null, null, null, null),
        ];
        factory.Off.Product = new ParsedFood("off", code, code, "Fictional cached bar revised", "g", 180, 12, 1, 10, null, null, null, null);

        var user = TestData.NewUser("off-refresh");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-10-01");
        var searched = await client.PostAsJsonAsync("/api/foods/search/open-food-facts", new { query = "cached bar" });
        var searchedBody = await searched.Content.ReadFromJsonAsync<JsonElement>();
        var foodId = searchedBody.GetProperty("openFoodFacts").GetProperty("results")[0].GetProperty("id").GetGuid();
        var logged = await LogFood(client, "cached-log", "2026-10-01", foodId, 50, "g", "08:05", "999");
        Assert.Equal(50, logged.GetProperty("kcal").GetDecimal());
        Assert.Equal("Fictional cached bar", logged.GetProperty("name").GetString());
        var entryId = logged.GetProperty("id").GetGuid();

        factory.Clock.UtcNow = cachedAt.AddDays(29);
        var at29 = await client.GetFromJsonAsync<JsonElement>("/api/foods/" + foodId);
        Assert.Equal(0, factory.Off.ProductCalls);
        Assert.Equal(100, at29.GetProperty("kcalPer100").GetDecimal());
        Assert.Equal("Fictional cached bar", at29.GetProperty("name").GetString());

        factory.Clock.UtcNow = cachedAt.AddDays(30);
        var at30 = await client.GetFromJsonAsync<JsonElement>("/api/foods/" + foodId);
        Assert.Equal(0, factory.Off.ProductCalls);
        Assert.Equal(100, at30.GetProperty("kcalPer100").GetDecimal());

        factory.Clock.UtcNow = cachedAt.AddDays(30).AddMinutes(1);
        var refreshed = await client.GetFromJsonAsync<JsonElement>("/api/foods/" + foodId);
        Assert.Equal(1, factory.Off.ProductCalls);
        Assert.Equal(code, factory.Off.LastCode);
        Assert.Equal(foodId, refreshed.GetProperty("id").GetGuid());
        Assert.Equal(180, refreshed.GetProperty("kcalPer100").GetDecimal());
        Assert.Equal("Fictional cached bar revised", refreshed.GetProperty("name").GetString());

        var again = await client.GetFromJsonAsync<JsonElement>("/api/foods/" + foodId);
        Assert.Equal(1, factory.Off.ProductCalls);
        Assert.Equal(180, again.GetProperty("kcalPer100").GetDecimal());

        var day = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-01");
        var entry = Assert.Single(day.GetProperty("entries").EnumerateArray());
        Assert.Equal(entryId, entry.GetProperty("id").GetGuid());
        Assert.Equal(50, entry.GetProperty("kcal").GetDecimal());
        Assert.Equal(5, entry.GetProperty("protein").GetDecimal());
        Assert.Equal("Fictional cached bar", entry.GetProperty("name").GetString());
        Assert.Equal(50, entry.GetProperty("amount").GetDecimal());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var stored = await db.Foods.SingleAsync(food => food.Id == foodId);
        Assert.Null(stored.RetiredAt);
        Assert.Equal(180, stored.KcalPer100);
        var history = await db.LogEntries.AsNoTracking().SingleAsync(row => row.Id == entryId);
        Assert.Equal(50, history.Kcal);
        Assert.Equal("Fictional cached bar", history.Name);
        Assert.Null(history.DeletedAt);
        Assert.Equal(1, await db.Foods.CountAsync(food => food.Source == "off" && food.SourceId == code));
    }

    [Fact]
    public void A_product_updated_29_or_exactly_30_days_ago_is_not_due_for_refresh()
    {
        var updated = new DateTimeOffset(2026, 10, 1, 8, 0, 0, TimeSpan.Zero);
        Assert.False(OpenFoodFactsCredit.NeedsRefresh(updated, updated.AddDays(29)));
        Assert.False(OpenFoodFactsCredit.NeedsRefresh(updated, updated.AddDays(30)));
        Assert.True(OpenFoodFactsCredit.NeedsRefresh(updated, updated.AddDays(30).AddMinutes(1)));
    }

    private async Task<Guid> CatalogueFood(string name, decimal kcal)
    {
        var id = Guid.NewGuid();
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Foods.Add(new Food
        {
            Id = id,
            Source = "test",
            SourceId = "recent-" + id.ToString("N"),
            Name = name,
            Basis = "g",
            NutrientBasis = NutrientBases.Per100,
            KcalPer100 = kcal,
            ProteinPer100 = 10,
            FatPer100 = 2,
            CarbsPer100 = 12,
            UpdatedAt = factory.Clock.GetUtcNow(),
        });
        await db.SaveChangesAsync();
        return id;
    }

    private static async Task Setup(HttpClient client, string date)
    {
        await TestData.PutWeighIn(client, date, $$"""{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "UTC"));
    }

    private static async Task<JsonElement> LogFood(
        HttpClient client,
        string key,
        string date,
        Guid foodId,
        decimal amount,
        string unit,
        string? time,
        string kcal = "1")
    {
        var timePart = time is null ? "" : $",\"time\":\"{time}\"";
        var amountText = amount.ToString(CultureInfo.InvariantCulture);
        var json = $$"""
            {"idempotencyKey":"{{key}}","localDate":"{{date}}","timeZone":"UTC","name":"client name","kcal":{{kcal}},"protein":1,"fat":1,"carbs":1,"foodId":"{{foodId}}","amount":{{amountText}},"unit":"{{unit}}"{{timePart}}}
            """;
        var response = await client.PostAsync("/api/log-entries", Json(json));
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, body);
        return JsonDocument.Parse(body).RootElement.Clone();
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");
}
