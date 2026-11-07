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
            quantity: "1 l"), hasBasisColumn: false);
        var food = Assert.IsType<AcceptedOffFood>(decision.Food);
        Assert.Equal("0012345", food.Barcode);
        Assert.Equal("Oatly Havredrikk", food.Name);
        Assert.Equal("ml", food.Basis);
        Assert.Equal(45m, food.Kcal);
        Assert.True(food.Oatly);
        Assert.False(food.FromKilojoules);
    }

    [Fact]
    public void Missing_kcal_is_not_stored_as_zero_and_kilojoules_convert_only_when_needed()
    {
        var missing = OffNorwayImporter.Decide(Row(kcal: "", protein: "1", fat: "1", carbs: "1", kj: ""), false);
        Assert.Equal("missing-kcal", missing.Skip);
        var converted = OffNorwayImporter.Decide(Row(kcal: "", protein: "0", fat: "0", carbs: "0", kj: "418.4", quantity: "100 g"), false);
        Assert.Equal(100m, converted.Food!.Kcal);
        Assert.True(converted.Food.FromKilojoules);
        Assert.Equal("g", converted.Food.Basis);
    }

    [Fact]
    public void A_blank_macro_is_skipped_and_a_hundred_millilitres_is_not_called_grams()
    {
        var blank = OffNorwayImporter.Decide(Row(protein: "", fat: "1", carbs: "1", kcal: "10", quantity: "100 g"), false);
        Assert.Equal("missing-macro", blank.Skip);
        var liquid = OffNorwayImporter.Decide(Row(kcal: "20", protein: "0", fat: "0", carbs: "0", serving: "5 ml", quantity: "350ml"), false);
        Assert.Equal("ml", liquid.Food!.Basis);
        var mixed = OffNorwayImporter.Decide(Row(kcal: "20", protein: "0", fat: "0", carbs: "0", serving: "5 ml", quantity: "100 g"), false);
        Assert.Equal("unknown-basis", mixed.Skip);
        var column = OffNorwayImporter.Decide(Row(kcal: "20", protein: "0", fat: "0", carbs: "0", per: "100ml", quantity: "100 g"), true);
        Assert.Equal("ml", column.Food!.Basis);
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
        Assert.Equal(1, first.Accepted);
        Assert.Equal(1, first.Upserted);
        Assert.Equal(1, first.OatlyAccepted);
        Assert.Equal(1, first.BasisMillilitres);
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

        var second = await importer.ImportCsvAsync(Csv(SecondFile()), dryRun: false, compressedBytes: 0, CancellationToken.None);
        Assert.Equal(1, second.Upserted);
        var copies = await db.Foods.CountAsync(food => food.Source == "off" && food.SourceId == "000123");
        Assert.Equal(1, copies);
        var updated = await db.Foods.SingleAsync(food => food.Id == foodId);
        Assert.Equal(50, updated.KcalPer100);
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
        db.Foods.Remove(catalogue);
        await db.SaveChangesAsync();
    }

    private static Stream Csv(string text) => new MemoryStream(Encoding.UTF8.GetBytes(text));

    private static string Header =>
        "code\tproduct_name\tbrands\tbrands_tags\tcountries_tags\tenergy-kcal_100g\tenergy-kj_100g\tproteins_100g\tfat_100g\tcarbohydrates_100g\tserving_size\tquantity\tlast_modified_t\n";

    private static string FirstFile() => Header +
        "000123\tHavredrikk\tOatly\toatly\ten:norway\t40\t\t1\t1.5\t6.5\t250 ml\t1 l\t1700000000\n" +
        "999\tSweden only\tOther\tother\ten:sweden\t10\t\t1\t1\t1\t100 g\t100 g\t1700000000\n" +
        "000124\tNo protein\tOatly\toatly\ten:norway\t40\t\t\t1\t1\t100 g\t100 g\t1700000000\n";

    private static string SecondFile() => Header +
        "000123\tHavredrikk\tOatly\toatly\ten:norway\t50\t\t1\t1.5\t6.5\t250 ml\t1 l\t1700000001\n";

    private static string BrokenFile() => Header + "\"000123\tunterminated";
}
