using System.IO.Compression;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

/// <summary>Reading Fineli's open-data package and importing it as Finland's table.</summary>
[Collection(ApiCollection.Name)]
public sealed class FineliImportTests(ApiFactory factory)
{
    [Fact]
    public void The_package_maps_units_names_measures_and_the_panel()
    {
        using var archive = new ZipArchive(Package(), ZipArchiveMode.Read);
        var foods = FineliImporter.Read(archive);
        Assert.Equal([91001, 91002, 91003], foods.Select(food => food.Id));

        var warnings = new List<string>();
        var row = FineliImporter.Row(foods[0], warnings.Add);
        Assert.NotNull(row);
        var food = row.Food;
        Assert.Equal(("fineli", "91001", "Zqbroileri, rintafilee, paistettu, ä"), (food.Source, food.SourceId, food.Name));
        Assert.Equal("Zqchicken breast fillet, fried", row.NameEn);
        // 600 kJ is 143.4 kcal. Salt comes in mg, EPA and DHA in mg.
        Assert.Equal((143.4m, 25.5m, 4.2m, 0.5m), (food.KcalPer100, food.ProteinPer100, food.FatPer100, food.CarbsPer100));
        Assert.Equal((1.1m, 0.2m, 0.3m, 0.9m), (food.SaturatedFatPer100, food.SugarsPer100, food.FiberPer100, food.SaltPer100));
        Assert.Equal(0.05m, food.Panel["epaDha"]);
        Assert.Equal(0.12m, food.Panel["omega3"]);
        Assert.Equal(0.04m, food.Panel["transFat"]);
        Assert.Equal(0.06m, food.Panel["copper"]);
        // Retinol equivalents: 12 µg retinol + 60 µg beta-carotene / 6.
        Assert.Equal(22m, food.Panel["vitaminA"]);
        // An empty value is unknown, not zero.
        Assert.Null(food.Panel["vitaminD"]);
        Assert.Empty(warnings);

        Assert.Equal((150m, "portion", 120m, "piece"), (food.ServingQuantity, food.ServingLabel, food.PieceQuantity, food.PieceLabel));
        Assert.Equal(
            [("portion_small", 100m), ("portion_large", 200m), ("tbsp", 15m)],
            row.Portions.Select(portion => (portion.Id, portion.Grams)));
        Assert.Equal("tablespoon", row.Portions[2].NameEn);

        // No serving or piece in the package, no serving or piece on the food. No energy, no food.
        var plain = FineliImporter.Row(foods[1]);
        Assert.Equal((null, null), (plain!.Food.ServingQuantity, plain.Food.PieceQuantity));
        Assert.Null(FineliImporter.Row(foods[2]));
    }

    [Fact]
    public void A_package_without_its_files_names_the_one_to_use()
    {
        var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            zip.CreateEntry("readme.txt");
        }

        stream.Position = 0;
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        var error = Assert.Throws<InvalidOperationException>(() => FineliImporter.Read(archive));
        Assert.Contains("74 components", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_import_stores_finnish_foods_with_measures_tagged_as_finland()
    {
        using var client = factory.AsUser(TestData.NewUser("fineli-import"));
        await Retire();
        try
        {
            FoodTableImportResult result;
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var importer = scope.ServiceProvider.GetRequiredService<FineliImporter>();
                result = await importer.ImportFileAsync(Package(), CancellationToken.None);
            }

            Assert.Equal((2, 0, 1), (result.Upserted, result.Retired, result.Skipped));
            Assert.StartsWith("Fineli", result.Coverage, StringComparison.Ordinal);

            var body = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=zqchicken");
            var found = body.GetProperty("foods").EnumerateArray().Single(food => food.GetProperty("sourceId").GetString() == "91001");
            Assert.Equal("FI", found.GetProperty("country").GetString());
            Assert.Equal("fineli", found.GetProperty("source").GetString());

            await using var check = factory.Services.CreateAsyncScope();
            var db = check.ServiceProvider.GetRequiredService<AppDbContext>();
            var stored = await db.Foods.SingleAsync(food => food.Source == "fineli" && food.SourceId == "91001" && food.RetiredAt == null);
            Assert.Equal(["portion_small", "portion_large", "tbsp"], FoodPortions.Read(stored).Select(portion => portion.Id));
            var credit = await db.FoodSourceCredits.SingleAsync(row => row.Source == "fineli");
            Assert.Equal(Fineli.Citation, credit.Citation);
        }
        finally
        {
            await Retire();
        }
    }

    /// <summary>A small package in Fineli's format: Latin-1, semicolons, decimal commas, CRLF, names in capitals.</summary>
    private static MemoryStream Package()
    {
        var files = new Dictionary<string, string>
        {
            ["component.csv"] = """
                EUFDNAME;COMPUNIT;CMPCLASS;CMPCLASSP
                ENERC;KJ;ENERGY;MACROCMP
                PROT;G;PROTEIN;MACROCMP
                FAT;G;TOTALFAT;MACROCMP
                CHOAVL;G;TOTALCAR;MACROCMP
                FASAT;G;FATACID;FAT
                SUGAR;G;SUGAR;CARBOCMP
                FIBC;G;FIBRE;CARBOCMP
                NACL;MG;MACROELM;MINERAL
                FAPUN3;G;FATACID;FAT
                FATRN;G;FATACID;FAT
                CU;MG;TRACEELM;MINERAL
                RETOL;UG;FSVITAM;VITAM
                CARTB;UG;FSVITAM;VITAM
                VITD;UG;FSVITAM;VITAM
                F20D5N3;MG;FATACID;FAT
                F22D6N3;MG;FATACID;FAT
                """,
            ["food.csv"] = """
                FOODID;FOODNAME;FOODTYPE;PROCESS;EDPORT;IGCLASS;IGCLASSP;FUCLASS;FUCLASSP
                91001;ZQBROILERI, RINTAFILEE, PAISTETTU, Ä;DISH;FRIE;100;POULTRY;MEATTOT;MEATCUTS;MEATPROD
                91002;ZQKAURAPUURO, VESI;DISH;BOIL;100;PORRIDGE;CEREALTOT;PORRIDGE;CEREALPR
                91003;ZQVESI;FOOD;IND;100;WATER;BEVERAGE;WATER;BEVERAGE
                """,
            ["foodname_EN.csv"] = """
                FOODID;FOODNAME;LANG
                91001;ZQCHICKEN BREAST FILLET, FRIED;EN
                91002;ZQPORRIDGE, OAT, WATER;EN
                91003;ZQWATER;EN
                """,
            ["component_value.csv"] = """
                FOODID;EUFDNAME;BESTLOC;ACQTYPE;METHTYPE;METHIND
                91001;ENERC;600,00;S;S;MI0107
                91001;PROT;25,5;A;A;MI0001
                91001;FAT;4,2;A;A;MI0001
                91001;CHOAVL;0,5;A;A;MI0001
                91001;FASAT;1,1;A;A;MI0001
                91001;SUGAR;0,2;A;A;MI0001
                91001;FIBC;0,3;A;A;MI0001
                91001;NACL;900;S;S;MI0001
                91001;FAPUN3;0,12;A;A;MI0001
                91001;FATRN;0,04;A;A;MI0001
                91001;CU;0,06;A;A;MI0001
                91001;RETOL;12;A;A;MI0001
                91001;CARTB;60;A;A;MI0001
                91001;VITD;;X;X;MIR003
                91001;F20D5N3;20;A;A;MI0001
                91001;F22D6N3;30;A;A;MI0001
                91002;ENERC;250;S;S;MI0107
                91002;PROT;2,1;A;A;MI0001
                """,
            ["foodaddunit.csv"] = """
                FOODID;FOODUNIT;MASS
                91001;PORTS;100,00
                91001;PORTM;150,00
                91001;PORTL;200,00
                91001;KPL_M;120,00
                91001;RKL;15,00
                91001;TL;0
                """,
        };

        var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (name, text) in files)
            {
                using var writer = new StreamWriter(zip.CreateEntry(name).Open(), Encoding.Latin1);
                writer.Write(text.ReplaceLineEndings("\r\n") + "\r\n");
            }
        }

        stream.Position = 0;
        return stream;
    }

    private async Task Retire()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Foods.Where(food => food.Source == "fineli" && food.RetiredAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(food => food.RetiredAt, DateTimeOffset.UtcNow));
    }
}
