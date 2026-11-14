using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

public sealed class MicronutrientMapTests
{
    [Fact]
    public void Matvaretabellen_keeps_a_real_zero_and_leaves_a_missing_constituent_null()
    {
        var mapped = Micronutrients.FromMatvare(
        [
            new MatvareConstituent("Mettet", "g", 0),
            new MatvareConstituent("Mono+Di", "g", 1.25m),
            new MatvareConstituent("Fiber", "g", 4),
            new MatvareConstituent("Na", "mg", 80),
            new MatvareConstituent("Sukker", "g", 9),
        ]);

        Assert.Equal(0, mapped.SaturatedFat);
        Assert.Equal(1.25m, mapped.Sugars);
        Assert.Equal(4, mapped.Fiber);
        Assert.Null(mapped.Salt);

        var absent = Micronutrients.FromMatvare([new MatvareConstituent("Protein", "g", 10)]);
        Assert.Null(absent.SaturatedFat);
        Assert.Null(absent.Sugars);
        Assert.Null(absent.Fiber);
        Assert.Null(absent.Salt);
    }

    [Fact]
    public void A_non_gram_unit_is_not_converted()
    {
        Assert.Null(Micronutrients.Grams("mg", 80));
        Assert.Equal(0, Micronutrients.Grams("g", 0));
        Assert.Null(Micronutrients.Grams("g", null));
    }

    [Fact]
    public void Kassalapp_reads_salt_and_ignores_sodium()
    {
        var mapped = Micronutrients.FromKassalapp(
        [
            new KassalNutrient("mettede_fettsyrer", "g", 0.4m),
            new KassalNutrient("sukkerarter", "g", 2),
            new KassalNutrient("kostfiber", "g", 0),
            new KassalNutrient("salt", "g", 1.1m),
            new KassalNutrient("natrium", "mg", 440),
        ]);

        Assert.Equal(0.4m, mapped.SaturatedFat);
        Assert.Equal(2, mapped.Sugars);
        Assert.Equal(0, mapped.Fiber);
        Assert.Equal(1.1m, mapped.Salt);
    }

    [Fact]
    public void A_day_total_is_null_unless_every_entry_has_the_value()
    {
        Assert.Null(Micronutrients.CompleteSum([]));
        Assert.Null(Micronutrients.CompleteSum([1m, null]));
        Assert.Equal(0, Micronutrients.CompleteSum([0m]));
        Assert.Equal(2.5m, Micronutrients.CompleteSum([1m, 1.5m]));
        Assert.Equal(50.0m, Micronutrients.Percent(1, 2));
        Assert.Null(Micronutrients.Percent(0, 0));
    }

    [Fact]
    public void The_panel_keeps_a_published_zero_and_drops_a_unit_mismatch()
    {
        var food = new Food();
        NutrientPanel.ApplyMatvare(food,
        [
            new MatvareConstituent("Enumet", "g", 1.2m),
            new MatvareConstituent("Omega-3", "g", 0),
            new MatvareConstituent("Kolest", "mg", 12),
            new MatvareConstituent("Na", "mg", 80),
            new MatvareConstituent("Vit C", "mg", 4),
            new MatvareConstituent("Vit A", "g", 50),
            new MatvareConstituent("NIAEQ", "mg", 3),
        ]);

        Assert.Equal(1.2m, food.MonoFatPer100);
        Assert.Equal(0, food.Omega3Per100);
        Assert.Equal(12, food.CholesterolPer100);
        Assert.Equal(80, food.SodiumPer100);
        Assert.Equal(4, food.VitaminCPer100);
        Assert.Null(food.VitaminAPer100);
        Assert.Equal(3, food.NiacinPer100);
        Assert.Null(food.VitaminDPer100);
    }

    [Fact]
    public void Matvaretabellen_vitamin_A_and_E_keep_the_published_equivalent_and_drop_an_unknown_unit()
    {
        var both = new Food();
        var notes = new List<string>();
        NutrientPanel.ApplyMatvare(both,
        [
            new MatvareConstituent("Vit A", "RAE", 40),
            new MatvareConstituent("Vit A RE", "RE", 90),
            new MatvareConstituent("Vit E", "mg-ATE", 0.8m),
        ], notes.Add);

        Assert.Equal(40m, both.VitaminAPer100);
        Assert.Equal(0.8m, both.VitaminEPer100);
        Assert.Empty(notes);

        var onlyRe = new Food();
        NutrientPanel.ApplyMatvare(onlyRe, [new MatvareConstituent("Vit A RE", "RE", 12)]);
        Assert.Equal(12m, onlyRe.VitaminAPer100);

        var publishedZero = new Food();
        NutrientPanel.ApplyMatvare(publishedZero,
        [
            new MatvareConstituent("Vit A", "RAE", 0),
            new MatvareConstituent("Vit E", "mg-ATE", 0),
        ]);
        Assert.Equal(0m, publishedZero.VitaminAPer100);
        Assert.Equal(0m, publishedZero.VitaminEPer100);

        var unknown = new Food();
        notes.Clear();
        NutrientPanel.ApplyMatvare(unknown,
        [
            new MatvareConstituent("Vit A", "IU", 9),
            new MatvareConstituent("Vit A RE", "µg", 8),
            new MatvareConstituent("Vit E", "mg", 1),
        ], notes.Add);

        Assert.Null(unknown.VitaminAPer100);
        Assert.Null(unknown.VitaminEPer100);
        Assert.Equal(
            [
                "vitamin A unit 'IU' was not accepted.",
                "vitamin A unit 'µg' was not accepted.",
                "vitamin E unit 'mg' was not accepted.",
            ],
            notes);

        var missing = new Food();
        notes.Clear();
        NutrientPanel.ApplyMatvare(missing,
        [
            new MatvareConstituent("Vit A", null, null),
            new MatvareConstituent("Vit E", null, null),
        ], notes.Add);
        Assert.Null(missing.VitaminAPer100);
        Assert.Null(missing.VitaminEPer100);
        Assert.Empty(notes);
    }

    [Fact]
    public void Open_food_facts_sodium_and_cholesterol_are_stored_in_milligrams()
    {
        using var doc = JsonDocument.Parse("""{"sodium_100g":0.08,"cholesterol_100g":0.012,"vitamin-c_100g":4}""");
        var panel = NutrientPanel.ReadOff(doc.RootElement);
        Assert.Equal(80m, panel["sodium"]);
        Assert.Equal(12m, panel["cholesterol"]);
        Assert.Equal(4m, panel["vitaminC"]);
    }
}

[Collection(ApiCollection.Name)]
public sealed class MicronutrientLogTests(ApiFactory factory)
{
    [Fact]
    public async Task A_new_log_snapshots_the_numbers_and_the_day_total_stays_null_until_every_entry_has_them()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 14, 8, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("micro"));
        await TestData.PutWeighIn(client, "2026-11-14", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "UTC"));

        var created = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional seeded oats",
            kcalPer100 = 100,
            proteinPer100 = 4,
            fatPer100 = 2,
            carbsPer100 = 16,
            saturatedFatPer100 = 0,
            sugarsPer100 = 1.5m,
            fiberPer100 = 3,
            saltPer100 = 0.1m,
            basis = "g",
            nutrientBasis = "per_100",
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var food = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, food.GetProperty("saturatedFatPer100").GetDecimal());
        Assert.Equal(1.5m, food.GetProperty("sugarsPer100").GetDecimal());
        var foodId = food.GetProperty("id").GetGuid();

        var logged = await client.PostAsync("/api/log-entries", Json(Entry("micro-1", foodId, "50", "g")));
        Assert.Equal(HttpStatusCode.Created, logged.StatusCode);
        var entry = await logged.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, entry.GetProperty("saturatedFat").GetDecimal());
        Assert.Equal(0.75m, entry.GetProperty("sugars").GetDecimal());
        Assert.Equal(1.5m, entry.GetProperty("fiber").GetDecimal());
        Assert.Equal(0.05m, entry.GetProperty("salt").GetDecimal());

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = await db.Foods.SingleAsync(item => item.Id == foodId);
            row.SaltPer100 = 9;
            await db.SaveChangesAsync();
        }

        var listed = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-11-14");
        Assert.Equal(0.05m, listed.GetProperty("entries")[0].GetProperty("salt").GetDecimal());
        Assert.Equal(0.05m, listed.GetProperty("totals").GetProperty("salt").GetDecimal());

        var quick = await client.PostAsync("/api/log-entries", new StringContent("""
            {"idempotencyKey":"micro-quick","localDate":"2026-11-14","timeZone":"UTC","time":"09:00","name":"Fictional quick","amount":1,"unit":"serving","kcal":40,"protein":1,"fat":1,"carbs":1}
            """, Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Created, quick.StatusCode);
        var after = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-11-14");
        Assert.Equal(JsonValueKind.Null, after.GetProperty("totals").GetProperty("salt").ValueKind);
        Assert.Equal(JsonValueKind.Null, after.GetProperty("totals").GetProperty("saturatedFat").ValueKind);
    }

    [Fact]
    public async Task Matvaretabellen_import_reports_coverage_and_does_not_invent_a_missing_value()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var importer = scope.ServiceProvider.GetRequiredService<MatvaretabellenImporter>();
        const string json = """
            {
              "foods": [
                {
                  "foodId": "micro.full",
                  "foodName": "Fictional full seed",
                  "calories": { "quantity": 90, "unit": "kcal" },
                  "constituents": [
                    { "nutrientId": "Protein", "quantity": 3, "unit": "g" },
                    { "nutrientId": "Fett", "quantity": 1, "unit": "g" },
                    { "nutrientId": "Karbo", "quantity": 12, "unit": "g" },
                    { "nutrientId": "Mettet", "quantity": 0, "unit": "g" },
                    { "nutrientId": "Mono+Di", "quantity": 2, "unit": "g" },
                    { "nutrientId": "Fiber", "quantity": 4, "unit": "g" },
                    { "nutrientId": "NaCl", "quantity": 0.2, "unit": "g" },
                    { "nutrientId": "Na", "quantity": 80, "unit": "mg" },
                    { "nutrientId": "Enumet", "quantity": 0.4, "unit": "g" },
                    { "nutrientId": "Flerum", "quantity": 0.3, "unit": "g" },
                    { "nutrientId": "Omega-3", "quantity": 0.1, "unit": "g" },
                    { "nutrientId": "Omega-6", "quantity": 0.2, "unit": "g" },
                    { "nutrientId": "Trans", "quantity": 0, "unit": "g" },
                    { "nutrientId": "Kolest", "quantity": 12, "unit": "mg" },
                    { "nutrientId": "Sukker", "quantity": 1, "unit": "g" },
                    { "nutrientId": "Vit A", "quantity": 40, "unit": "RAE" },
                    { "nutrientId": "Vit A RE", "quantity": 90, "unit": "RE" },
                    { "nutrientId": "Vit D", "quantity": 1.5, "unit": "µg" },
                    { "nutrientId": "Vit E", "quantity": 0.8, "unit": "mg-ATE" },
                    { "nutrientId": "Vit B1", "quantity": 0.1, "unit": "mg" },
                    { "nutrientId": "Vit B2", "quantity": 0.2, "unit": "mg" },
                    { "nutrientId": "NIAEQ", "quantity": 3, "unit": "mg" },
                    { "nutrientId": "Vit B6", "quantity": 0.3, "unit": "mg" },
                    { "nutrientId": "Folat", "quantity": 20, "unit": "µg" },
                    { "nutrientId": "Vit B12", "quantity": 0.5, "unit": "µg" },
                    { "nutrientId": "Vit C", "quantity": 4, "unit": "mg" },
                    { "nutrientId": "Ca", "quantity": 50, "unit": "mg" },
                    { "nutrientId": "Fe", "quantity": 1, "unit": "mg" },
                    { "nutrientId": "Zn", "quantity": 0.6, "unit": "mg" },
                    { "nutrientId": "Mg", "quantity": 18, "unit": "mg" },
                    { "nutrientId": "K", "quantity": 200, "unit": "mg" },
                    { "nutrientId": "P", "quantity": 90, "unit": "mg" },
                    { "nutrientId": "Se", "quantity": 8, "unit": "µg" },
                    { "nutrientId": "I", "quantity": 6, "unit": "µg" }
                  ],
                  "portions": []
                },
                {
                  "foodId": "micro.gap",
                  "foodName": "Fictional gap seed",
                  "calories": { "quantity": 40, "unit": "kcal" },
                  "constituents": [
                    { "nutrientId": "Protein", "quantity": 1, "unit": "g" },
                    { "nutrientId": "Fett", "quantity": 0, "unit": "g" },
                    { "nutrientId": "Karbo", "quantity": 8, "unit": "g" },
                    { "nutrientId": "Mettet", "quantity": 0, "unit": "g" },
                    { "nutrientId": "Vit A", "quantity": 9, "unit": "IU" },
                    { "nutrientId": "Vit E", "quantity": 1, "unit": "mg" }
                  ],
                  "portions": []
                }
              ]
            }
            """;
        await using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));
        var result = await importer.ImportAsync(stream, CancellationToken.None);
        var catalogue = await db.Foods.Where(row => row.Source == Matvaretabellen.Source && row.RetiredAt == null).ToListAsync();
        Assert.Equal(Micronutrients.CoverageLine(
            "Matvaretabellen",
            catalogue.Count,
            catalogue.Count(row => row.SaturatedFatPer100 is not null),
            catalogue.Count(row => row.SugarsPer100 is not null),
            catalogue.Count(row => row.FiberPer100 is not null),
            catalogue.Count(row => row.SaltPer100 is not null)) + " " + Micronutrients.PanelCoverage(catalogue), result.Coverage);
        var full = await db.Foods.SingleAsync(row => row.SourceId == "micro.full");
        var gap = await db.Foods.SingleAsync(row => row.SourceId == "micro.gap");
        Assert.Equal(0, full.SaturatedFatPer100);
        Assert.Equal(0.2m, full.SaltPer100);
        Assert.Equal(80m, full.SodiumPer100);
        Assert.Equal(0m, full.TransFatPer100);
        Assert.Equal(3m, full.NiacinPer100);
        Assert.Equal(4m, full.VitaminCPer100);
        Assert.Equal(40m, full.VitaminAPer100);
        Assert.Equal(0.8m, full.VitaminEPer100);
        Assert.Contains("vitamin A", result.Coverage, StringComparison.Ordinal);
        Assert.Contains("vitamin E", result.Coverage, StringComparison.Ordinal);
        Assert.Null(gap.SodiumPer100);
        Assert.Null(gap.VitaminCPer100);
        Assert.Null(gap.VitaminAPer100);
        Assert.Null(gap.VitaminEPer100);
        Assert.Equal(0, gap.SaturatedFatPer100);
        Assert.Null(gap.SugarsPer100);
        Assert.Null(gap.FiberPer100);
        Assert.Null(gap.SaltPer100);
        db.Foods.RemoveRange(full, gap);
        await db.SaveChangesAsync();
    }

    private static string Entry(string key, Guid foodId, string amount, string unit) =>
        $$"""{"idempotencyKey":"{{key}}","localDate":"2026-11-14","timeZone":"UTC","foodId":"{{foodId}}","amount":{{amount}},"unit":"{{unit}}"}""";

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");
}
