using System.IO.Compression;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

/// <summary>Reading USDA FoodData Central's SR Legacy package and importing it as the United States' table.</summary>
[Collection(ApiCollection.Name)]
public sealed class UsdaImportTests(ApiFactory factory)
{
    [Fact]
    public void The_package_maps_values_and_measures_and_leaves_out_baby_foods()
    {
        using var archive = new ZipArchive(Package(), ZipArchiveMode.Read);
        var foods = UsdaImporter.Read(archive);
        Assert.Equal([990001, 990002, 990003, 990004], foods.Select(food => food.Id));

        var banana = UsdaImporter.Row(foods[0]);
        Assert.NotNull(banana);
        var food = banana.Food;
        Assert.Equal(("usda", "990001", "Zqbananas, raw"), (food.Source, food.SourceId, food.Name));
        Assert.Equal("Zqbananas, raw", banana.NameEn);
        // Carbohydrate by difference less fibre (22.84 − 2.6); salt is sodium × 2.5.
        Assert.Equal((89m, 1.09m, 0.33m, 20.24m), (food.KcalPer100, food.ProteinPer100, food.FatPer100, food.CarbsPer100));
        Assert.Equal((0.112m, 12.23m, 2.6m, 0.0025m), (food.SaturatedFatPer100, food.SugarsPer100, food.FiberPer100, food.SaltPer100));
        // Retinol equivalents: 0 + 26 / 6 + (25 + 0) / 12 = 6.4 µg.
        Assert.Equal(6.4m, food.Panel["vitaminA"]);
        // 18:3 (ALA when split out) + EPA + DPA + DHA, and 18:2 + 20:4.
        Assert.Equal(0.027m, food.Panel["omega3"]);
        Assert.Equal(0.046m, food.Panel["omega6"]);
        Assert.Null(food.Panel["transFat"]);

        // The NLEA serving is the serving and the medium size the piece. Weights are dropped, and a measure
        // for several is per one: "0.5 cup, mashed" of 112.5 g is a cup of 225 g.
        Assert.Equal((126m, "portion", 118m, "piece"), (food.ServingQuantity, food.ServingLabel, food.PieceQuantity, food.PieceLabel));
        Assert.Equal(
            [("large", "large", 136m), ("cup_sliced", "cup, sliced", 150m), ("cup_mashed", "cup, mashed", 225m), ("piece_2", "piece", 30m)],
            banana.Portions.Select(portion => (portion.Id, portion.NameEn!, portion.Grams)));

        // No medium size: the first measure that is one whole thing ("large") is the piece. A measure that starts
        // with "serving" is the serving.
        var egg = UsdaImporter.Row(foods[1])!;
        Assert.Equal((100m, 50m), (egg.Food.ServingQuantity, egg.Food.PieceQuantity));
        Assert.Equal(["tbsp", "cup_chopped"], egg.Portions.Select(portion => portion.Id));
        // Without beta-carotene vitamin A is unknown; a missing fatty acid makes omega-3 unknown.
        Assert.Null(egg.Food.Panel["vitaminA"]);
        Assert.Null(egg.Food.Panel["omega3"]);

        // A baby food and a food without kilocalories are left out.
        Assert.Null(UsdaImporter.Row(foods[2]));
        Assert.Null(UsdaImporter.Row(foods[3]));
    }

    [Fact]
    public void Another_fooddata_central_package_names_the_one_to_use()
    {
        var stream = Zip("""{ "FoundationFoods": [] }""");
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        var error = Assert.Throws<InvalidOperationException>(() => UsdaImporter.Read(archive));
        Assert.Contains("SR Legacy", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void The_united_states_table_is_home_there_and_comes_last_in_the_nordics()
    {
        Assert.Equal("US", FoodSources.Country(Usda.Source));
        Assert.Equal(0, FoodSources.Tier(Usda.Source, "US"));
        Assert.Equal(2, FoodSources.Tier(Usda.Source, "NO"));
        Assert.Equal(2, FoodSources.Tier(Matvaretabellen.Source, "US"));
    }

    [Fact]
    public async Task An_import_stores_american_foods_with_measures_tagged_as_the_united_states()
    {
        using var client = factory.AsUser(TestData.NewUser("usda-import"));
        await Retire();
        try
        {
            FoodTableImportResult result;
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var importer = scope.ServiceProvider.GetRequiredService<UsdaImporter>();
                result = await importer.ImportFileAsync(Package(), CancellationToken.None);
            }

            Assert.Equal((2, 0, 2), (result.Upserted, result.Retired, result.Skipped));
            Assert.StartsWith("USDA FoodData Central", result.Coverage, StringComparison.Ordinal);

            var body = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=zqbananas");
            var found = body.GetProperty("foods").EnumerateArray().Single(food => food.GetProperty("sourceId").GetString() == "990001");
            Assert.Equal("US", found.GetProperty("country").GetString());
            Assert.Equal("usda", found.GetProperty("source").GetString());

            await using var check = factory.Services.CreateAsyncScope();
            var db = check.ServiceProvider.GetRequiredService<AppDbContext>();
            var stored = await db.Foods.SingleAsync(food => food.Source == "usda" && food.SourceId == "990001" && food.RetiredAt == null);
            Assert.Equal(["large", "cup_sliced", "cup_mashed", "piece_2"], FoodPortions.Read(stored).Select(portion => portion.Id));
            var credit = await db.FoodSourceCredits.SingleAsync(row => row.Source == "usda");
            Assert.Equal(Usda.Citation, credit.Citation);
        }
        finally
        {
            await Retire();
        }
    }

    /// <summary>A small package in SR Legacy's JSON shape, with the fields the importer reads and some it ignores.</summary>
    private static MemoryStream Package() => Zip("""
        {
          "SRLegacyFoods": [
            {
              "foodClass": "FinalFood", "description": "Zqbananas, raw", "fdcId": 990001, "dataType": "SR Legacy",
              "foodCategory": { "description": "Fruits and Fruit Juices" },
              "foodNutrients": [
                { "type": "FoodNutrient", "nutrient": { "id": 1008, "number": "208", "name": "Energy", "unitName": "kcal" }, "amount": 89.0 },
                { "nutrient": { "id": 1062, "name": "Energy", "unitName": "kJ" }, "amount": 371.0 },
                { "nutrient": { "id": 1003 }, "amount": 1.09 },
                { "nutrient": { "id": 1004 }, "amount": 0.33 },
                { "nutrient": { "id": 1005 }, "amount": 22.84 },
                { "nutrient": { "id": 1079 }, "amount": 2.6 },
                { "nutrient": { "id": 2000 }, "amount": 12.23 },
                { "nutrient": { "id": 1258 }, "amount": 0.112 },
                { "nutrient": { "id": 1093 }, "amount": 1.0 },
                { "nutrient": { "id": 1105 }, "amount": 0.0 },
                { "nutrient": { "id": 1107 }, "amount": 26.0 },
                { "nutrient": { "id": 1108 }, "amount": 25.0 },
                { "nutrient": { "id": 1120 }, "amount": 0.0 },
                { "nutrient": { "id": 1270 }, "amount": 0.027 },
                { "nutrient": { "id": 1278 }, "amount": 0.0 },
                { "nutrient": { "id": 1280 }, "amount": 0.0 },
                { "nutrient": { "id": 1272 }, "amount": 0.0 },
                { "nutrient": { "id": 1269 }, "amount": 0.046 },
                { "nutrient": { "id": 1271 }, "amount": 0.0 },
                { "nutrient": { "id": 1110 } }
              ],
              "foodPortions": [
                { "id": 1, "amount": 1.0, "measureUnit": { "id": 9999, "name": "undetermined" }, "modifier": "NLEA serving", "gramWeight": 126.0 },
                { "id": 2, "amount": 1.0, "modifier": "large", "gramWeight": 136.0 },
                { "id": 3, "amount": 1.0, "modifier": "cup,  sliced", "gramWeight": 150.0 },
                { "id": 4, "amount": 1.0, "modifier": "medium (7\" to 7-7/8\" long)", "gramWeight": 118.0 },
                { "id": 5, "amount": 0.5, "modifier": "cup, mashed", "gramWeight": 112.5 },
                { "id": 6, "amount": 3.0, "modifier": "oz", "gramWeight": 85.0 },
                { "id": 7, "amount": 1.0, "modifier": "piece", "gramWeight": 30.0 },
                { "id": 8, "amount": 1.0, "modifier": "large", "gramWeight": 136.0 }
              ]
            },
            {
              "description": "Zqegg, whole, cooked, hard-boiled", "fdcId": 990002,
              "foodCategory": { "description": "Dairy and Egg Products" },
              "foodNutrients": [
                { "nutrient": { "id": 1008 }, "amount": 155.0 },
                { "nutrient": { "id": 1003 }, "amount": 12.58 },
                { "nutrient": { "id": 1105 }, "amount": 149.0 },
                { "nutrient": { "id": 1270 }, "amount": 0.03 }
              ],
              "foodPortions": [
                { "amount": 1.0, "modifier": "tbsp", "gramWeight": 8.5 },
                { "amount": 1.0, "modifier": "cup, chopped", "gramWeight": 136.0 },
                { "amount": 1.0, "modifier": "large", "gramWeight": 50.0 },
                { "amount": 1.0, "modifier": "serving 2 eggs", "gramWeight": 100.0 }
              ]
            },
            {
              "description": "Babyfood, zqapple", "fdcId": 990003,
              "foodCategory": { "description": "Baby Foods" },
              "foodNutrients": [ { "nutrient": { "id": 1008 }, "amount": 40.0 } ]
            },
            {
              "description": "Zqwater, no energy listed", "fdcId": 990004,
              "foodCategory": { "description": "Beverages" },
              "foodNutrients": [ { "nutrient": { "id": 1003 }, "amount": 0.0 } ]
            }
          ]
        }
        """);

    private static MemoryStream Zip(string json)
    {
        var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            using var writer = new StreamWriter(zip.CreateEntry("FoodData_Central_sr_legacy_food_json_2018-04.json").Open(), new UTF8Encoding(false));
            writer.Write(json);
        }

        stream.Position = 0;
        return stream;
    }

    private async Task Retire()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Foods.Where(food => food.Source == "usda" && food.RetiredAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(food => food.RetiredAt, DateTimeOffset.UtcNow));
    }
}
