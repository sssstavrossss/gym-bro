using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

public sealed class QuotedTsvTests
{
    [Fact]
    public void Quotes_tabs_and_newlines_stay_inside_fields()
    {
        var text = "code\tname\tnotes\n001\t\"Oatly\tBarista\"\t\"line\n\"\"two\"\"\"\n002\tPlain\tno quotes\n";
        using var reader = new StringReader(text);
        var rows = QuotedTsv.Read(reader).ToList();
        Assert.Equal(["code", "name", "notes"], rows[0].Fields);
        Assert.Equal("Oatly\tBarista", rows[1].Fields[1]);
        Assert.Equal("line\n\"two\"", rows[1].Fields[2]);
        Assert.False(rows[1].Incomplete);
        Assert.Equal("Plain", rows[2].Fields[1]);
    }

    [Fact]
    public void An_unclosed_quote_is_incomplete()
    {
        using var reader = new StringReader("code\tname\n\"001\tno end");
        var rows = QuotedTsv.Read(reader).ToList();
        Assert.True(rows[^1].Incomplete);
    }
}

public sealed class OffNorwayDecisionTests
{
    [Fact]
    public void Label_kcal_millilitres_and_leading_zeros_are_kept()
    {
        var decision = OffNorwayImporter.Decide(Row(
            code: "0012345",
            name: "Havredrikk",
            brand: "Oatly",
            countries: "en:france,en:norway",
            kcal: "45",
            protein: "1",
            fat: "1.5",
            carbs: "6.5",
            serving: "250 ml",
            quantity: "1 l",
            per: "100ml"));
        var food = Assert.IsType<AcceptedOffFood>(decision.Food);
        Assert.Equal("0012345", food.Barcode);
        Assert.Equal("Oatly Havredrikk", food.Name);
        Assert.Equal("ml", food.Basis);
        Assert.Equal(45m, food.Kcal);
        Assert.True(food.Oatly);
    }

    [Fact]
    public void Missing_label_kcal_is_skipped_even_when_kilojoules_are_present()
    {
        var missing = OffNorwayImporter.Decide(Row(kcal: "", protein: "1", fat: "1", carbs: "1", per: "100g"));
        Assert.Equal("missing-kcal", missing.Skip);
        var kilojoules = OffNorwayImporter.Decide(Row(kcal: "", protein: "0", fat: "0", carbs: "0", kj: "418.4", quantity: "100 g", per: "100g"));
        Assert.Equal("missing-kcal", kilojoules.Skip);
    }

    [Fact]
    public void Package_quantity_does_not_choose_grams_or_millilitres()
    {
        var blank = OffNorwayImporter.Decide(Row(protein: "", fat: "1", carbs: "1", kcal: "10", quantity: "100 g", per: "100g"));
        Assert.Equal("missing-macro", blank.Skip);
        var soldByVolume = OffNorwayImporter.Decide(Row(kcal: "12", protein: "1", fat: "1", carbs: "1", quantity: "350ml", per: "100g"));
        Assert.Equal("g", soldByVolume.Food!.Basis);
        var labelledByVolume = OffNorwayImporter.Decide(Row(kcal: "20", protein: "0", fat: "0", carbs: "0", quantity: "100 g", per: "100ml"));
        Assert.Equal("ml", labelledByVolume.Food!.Basis);
        var servingBasis = OffNorwayImporter.Decide(Row(kcal: "20", protein: "0", fat: "0", carbs: "0", quantity: "1 g", per: "serving"));
        Assert.Equal("unknown-basis", servingBasis.Skip);
        var blankBasis = OffNorwayImporter.Decide(Row(kcal: "20", protein: "0", fat: "0", carbs: "0", quantity: "1 l", per: ""));
        Assert.Equal("unknown-basis", blankBasis.Skip);
    }

    [Fact]
    public void Json_product_uses_nutrition_data_per_and_ignores_kilojoules()
    {
        var soldAsMl = OffNorwayImporter.MapProduct("""
            {"code":"0011210000032","product_name":"Pepper sauce","brands":"Tabasco","brands_tags":["tabasco"],"countries_tags":["en:norway"],"quantity":"350 ml","nutrition_data_per":"100g","last_modified_t":1700000000,"nutriments":{"energy-kcal_100g":12,"energy_100g":50,"proteins_100g":1,"fat_100g":1,"carbohydrates_100g":1}}
            """);
        Assert.True(soldAsMl.Norway);
        var grams = OffNorwayImporter.Decide(soldAsMl.Fields);
        Assert.Equal("g", grams.Food!.Basis);
        Assert.Equal(12m, grams.Food.Kcal);

        var labelledMl = OffNorwayImporter.MapProduct("""
            {"code":"000123","product_name":"Havredrikk","brands":"Oatly","countries_tags":["en:france","en:norway"],"quantity":"1 l","nutrition_data_per":"100ml","nutriments":{"energy-kcal_100g":45,"proteins_100g":1,"fat_100g":1.5,"carbohydrates_100g":6.5}}
            """);
        Assert.Equal("ml", OffNorwayImporter.Decide(labelledMl.Fields).Food!.Basis);

        var onlyKj = OffNorwayImporter.MapProduct("""
            {"code":"000124","product_name":"No label","brands":"X","countries_tags":["en:norway"],"nutrition_data_per":"100g","nutriments":{"energy_100g":418.4,"proteins_100g":0,"fat_100g":0,"carbohydrates_100g":0}}
            """);
        Assert.Equal("missing-kcal", OffNorwayImporter.Decide(onlyKj.Fields).Skip);

        var elsewhere = OffNorwayImporter.MapProduct("""
            {"code":"999","product_name":"Sweden","countries_tags":["en:sweden"],"nutrition_data_per":"100g","nutriments":{"energy-kcal_100g":10,"proteins_100g":1,"fat_100g":1,"carbohydrates_100g":1}}
            """);
        Assert.False(elsewhere.Norway);
    }

    [Fact]
    public void Sweden_is_not_norway_and_the_name_keeps_the_brand()
    {
        Assert.Equal("Oatly iKaffe", OffNorwayImporter.DisplayName("Oatly", "iKaffe"));
        Assert.Equal("Oatly iKaffe", OffNorwayImporter.DisplayName("Oatly", "Oatly iKaffe"));
    }

    private static Dictionary<string, string> Row(
        string code = "123",
        string name = "Havredrikk",
        string brand = "Oatly",
        string countries = "en:norway",
        string kcal = "40",
        string protein = "1",
        string fat = "1.5",
        string carbs = "6",
        string kj = "",
        string serving = "",
        string quantity = "1 l",
        string per = "") => new()
    {
        ["code"] = code,
        ["product_name"] = name,
        ["brands"] = brand,
        ["brands_tags"] = brand.ToLowerInvariant(),
        ["countries_tags"] = countries,
        ["energy-kcal_100g"] = kcal,
        ["energy-kj_100g"] = kj,
        ["energy_100g"] = kj,
        ["proteins_100g"] = protein,
        ["fat_100g"] = fat,
        ["carbohydrates_100g"] = carbs,
        ["serving_size"] = serving,
        ["quantity"] = quantity,
        ["nutrition_data_per"] = per,
        ["last_modified_t"] = "1700000000",
    };
}

[Collection(ApiCollection.Name)]
public sealed class OffNorwayImportTests(ApiFactory factory)
{
    [Fact]
    public async Task A_repeat_import_updates_only_off_rows_and_leaves_logs_and_matvaretabellen()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("off-norway");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-24", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "UTC"));

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var mvt = new Food
        {
            Id = Guid.NewGuid(),
            Source = "mvt",
            SourceId = "off-test.mvt",
            Name = "Fictional mvt oats",
            NameEn = "Fictional mvt oats",
            Basis = "g",
            NutrientBasis = NutrientBases.Per100,
            KcalPer100 = 300,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Foods.Add(mvt);
        await db.SaveChangesAsync();

        var importer = scope.ServiceProvider.GetRequiredService<OffNorwayImporter>();
        var first = await importer.ImportCsvAsync(Csv(FirstFile()), dryRun: false, compressedBytes: 0, CancellationToken.None);
        Assert.True(first.Complete);
        Assert.Equal(2, first.Accepted);
        Assert.Equal(2, first.Upserted);
        Assert.Equal(1, first.OatlyAccepted);
        Assert.Equal(1, first.BasisMillilitres);
        Assert.Equal(1, first.BasisGrams);
        Assert.Equal(2, first.LabelKcal);
        Assert.Equal(0, first.SkipReasons.GetValueOrDefault("not-norway"));

        var found = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=oatly%20havre");
        var row = found.GetProperty("foods").EnumerateArray().Single(item => item.GetProperty("sourceId").GetString() == "000123");
        Assert.Equal("off", row.GetProperty("source").GetString());
        Assert.Equal("ml", row.GetProperty("basis").GetString());
        Assert.Equal("000123", row.GetProperty("barcode").GetString());
        Assert.False(row.GetProperty("owned").GetBoolean());
        Assert.Equal(40, row.GetProperty("kcalPer100").GetDecimal());
        var foodId = row.GetProperty("id").GetGuid();

        var logged = await client.PostAsync("/api/log-entries", new StringContent(
            $$"""{"idempotencyKey":"off-1","localDate":"2026-10-24","timeZone":"UTC","foodId":"{{foodId}}","amount":250,"unit":"ml"}""",
            Encoding.UTF8,
            "application/json"));
        Assert.Equal(HttpStatusCode.Created, logged.StatusCode);
        var entry = await logged.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(100, entry.GetProperty("kcal").GetDecimal());
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("grams").ValueKind);
        Assert.Equal("ml", entry.GetProperty("unit").GetString());
        var entryId = entry.GetProperty("id").GetGuid();

        var grams = await client.PostAsync("/api/log-entries", new StringContent(
            $$"""{"idempotencyKey":"off-2","localDate":"2026-10-24","timeZone":"UTC","foodId":"{{foodId}}","amount":100,"unit":"g"}""",
            Encoding.UTF8,
            "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, grams.StatusCode);

        var remembered = await db.Foods.SingleAsync(food => food.Id == foodId);
        remembered.NameEn = "Oat drink";
        remembered.ServingQuantity = 250;
        remembered.ServingLabel = "glass";
        remembered.PieceQuantity = 1;
        remembered.PieceLabel = "carton";
        await db.SaveChangesAsync();

        var second = await importer.ImportCsvAsync(Csv(SecondFile()), dryRun: false, compressedBytes: 0, CancellationToken.None);
        Assert.Equal(1, second.Upserted);
        var copies = await db.Foods.CountAsync(food => food.Source == "off" && food.SourceId == "000123");
        Assert.Equal(1, copies);
        var updated = await db.Foods.SingleAsync(food => food.Id == foodId);
        Assert.Equal(50, updated.KcalPer100);
        Assert.Equal("Oat drink", updated.NameEn);
        Assert.Equal(250, updated.ServingQuantity);
        Assert.Equal("glass", updated.ServingLabel);
        Assert.Equal(1, updated.PieceQuantity);
        Assert.Equal("carton", updated.PieceLabel);
        var sauce = await db.Foods.SingleAsync(food => food.Source == "off" && food.SourceId == "000125");
        Assert.Null(sauce.RetiredAt);
        Assert.Equal("g", sauce.Basis);
        Assert.Equal(12, sauce.KcalPer100);
        var kept = await db.LogEntries.SingleAsync(item => item.Id == entryId);
        Assert.Equal(100, kept.Kcal);
        Assert.Null(kept.Grams);
        var catalogue = await db.Foods.SingleAsync(food => food.SourceId == "off-test.mvt");
        Assert.Equal(300, catalogue.KcalPer100);
        Assert.Null(catalogue.RetiredAt);

        var dry = await importer.ImportCsvAsync(Csv(BrokenFile()), dryRun: true, compressedBytes: 0, CancellationToken.None);
        Assert.False(dry.Complete);
        Assert.Equal(0, dry.Upserted);
        Assert.Equal(50, (await db.Foods.SingleAsync(food => food.Id == foodId)).KcalPer100);

        await db.FoodAliases.Where(alias => alias.SourceId == "000123").ExecuteDeleteAsync();
        db.LogEntries.Remove(kept);
        db.Foods.Remove(updated);
        db.Foods.Remove(sauce);
        db.Foods.Remove(catalogue);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task The_last_copy_of_a_barcode_wins_across_batches_and_a_repeat_is_stable()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var importer = scope.ServiceProvider.GetRequiredService<OffNorwayImporter>();
        var file = Header +
            "111\tFirst\tBrand\tbrand\ten:norway\t10\t1\t1\t1\t\t100 g\t100g\t1700000000\n" +
            "111\tSecond\tBrand\tbrand\ten:norway\t20\t1\t1\t1\t\t350 ml\t100g\t1700000001\n";
        var first = await importer.ImportCsvAsync(Csv(file), dryRun: false, compressedBytes: 0, CancellationToken.None, batchSize: 1);
        Assert.Equal(1, first.Accepted);
        Assert.Equal(1, first.SkipReasons.GetValueOrDefault("duplicate-barcode"));
        Assert.Equal(1, first.BasisGrams);
        var row = await db.Foods.SingleAsync(food => food.Source == "off" && food.SourceId == "111");
        Assert.Equal(20, row.KcalPer100);
        Assert.Equal("Brand Second", row.Name);
        Assert.Equal("g", row.Basis);

        var again = await importer.ImportCsvAsync(Csv(file), dryRun: false, compressedBytes: 0, CancellationToken.None, batchSize: 1);
        Assert.Equal(1, again.Unchanged);
        Assert.Equal(0, again.Upserted);
        var stable = await db.Foods.SingleAsync(food => food.Id == row.Id);
        Assert.Equal(20, stable.KcalPer100);
        Assert.Equal("Brand Second", stable.Name);

        db.Foods.Remove(stable);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Retiring_keeps_the_log_link_and_deleting_the_food_clears_it()
    {
        var user = TestData.NewUser("off-retire");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-24", """{"kg":80,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "UTC"));
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var importer = scope.ServiceProvider.GetRequiredService<OffNorwayImporter>();
        await importer.ImportCsvAsync(Csv(Header +
            "222\tSauce\tBrand\tbrand\ten:norway\t12\t1\t1\t1\t\t350 ml\t100g\t1700000000\n"),
            dryRun: false, compressedBytes: 0, CancellationToken.None);
        var food = await db.Foods.SingleAsync(item => item.SourceId == "222");
        var logged = await client.PostAsync("/api/log-entries", new StringContent(
            $$"""{"idempotencyKey":"off-retire-{{Guid.NewGuid():N}}","localDate":"2026-10-24","timeZone":"UTC","foodId":"{{food.Id}}","amount":100,"unit":"g"}""",
            Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Created, logged.StatusCode);
        var entryId = (await logged.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        food.RetiredAt = DateTimeOffset.UnixEpoch;
        await db.SaveChangesAsync();
        var retired = await db.LogEntries.SingleAsync(item => item.Id == entryId);
        Assert.Equal(food.Id, retired.FoodId);
        Assert.Equal(12, retired.Kcal);

        var foodId = food.Id;
        db.ChangeTracker.Clear();
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM foods WHERE id = {foodId}");
        var detached = await db.LogEntries.AsNoTracking().SingleAsync(item => item.Id == entryId);
        Assert.Null(detached.FoodId);
        Assert.Equal(12, detached.Kcal);
        db.LogEntries.Remove(detached);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task A_csv_without_the_basis_column_is_refused()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var importer = scope.ServiceProvider.GetRequiredService<OffNorwayImporter>();
        var text = "code\tproduct_name\tbrands\tcountries_tags\tenergy-kcal_100g\tproteins_100g\tfat_100g\tcarbohydrates_100g\n" +
            "1\tName\tBrand\ten:norway\t10\t1\t1\t1\n";
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            importer.ImportCsvAsync(Csv(text), dryRun: true, compressedBytes: 0, CancellationToken.None));
        Assert.Contains("nutrition_data_per", error.Message, StringComparison.Ordinal);
    }

    private static Stream Csv(string text) => new MemoryStream(Encoding.UTF8.GetBytes(text));

    private static string Header =>
        "code\tproduct_name\tbrands\tbrands_tags\tcountries_tags\tenergy-kcal_100g\tproteins_100g\tfat_100g\tcarbohydrates_100g\tserving_size\tquantity\tnutrition_data_per\tlast_modified_t\n";

    private static string FirstFile() => Header +
        "000123\tHavredrikk\tOatly\toatly\ten:norway\t40\t1\t1.5\t6.5\t250 ml\t1 l\t100ml\t1700000000\n" +
        "000125\tHot sauce\tOther\tother\ten:norway\t12\t1\t1\t1\t\t350 ml\t100g\t1700000000\n" +
        "999\tSweden only\tOther\tother\ten:sweden\t10\t1\t1\t1\t100 g\t100 g\t100g\t1700000000\n" +
        "000124\tNo protein\tOatly\toatly\ten:norway\t40\t\t1\t1\t100 g\t100 g\t100g\t1700000000\n" +
        "000128\tNo basis\tOther\tother\ten:norway\t10\t1\t1\t1\t\t1 l\t\t1700000000\n";

    private static string SecondFile() => Header +
        "000123\tHavredrikk\tOatly\toatly\ten:norway\t50\t1\t1.5\t6.5\t250 ml\t1 l\t100ml\t1700000001\n";

    private static string BrokenFile() => Header + "\"000123\tunterminated";
}
