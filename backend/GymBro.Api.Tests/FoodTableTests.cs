using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Describe;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

/// <summary>The shared food-table import, Livsmedelsverket's mapping, table keywords, and home-first search.</summary>
[Collection(ApiCollection.Name)]
public sealed class FoodTableTests(ApiFactory factory)
{
    [Fact]
    public void Livsmedelsverket_values_map_to_the_panel_and_odd_units_are_left_out()
    {
        var warnings = new List<string>();
        var row = LivsmedelsverketImporter.Row(
            Slv(1166, "Kyckling bröstfilé rå m. skinn", "Chicken breast fillet raw with skin",
                ("ENERC", "kJ", 500), ("ENERC", "kcal", 120), ("PROT", "g", 22.5m), ("FAT", "g", 3.2m), ("CHO", "g", 0),
                ("FASAT", "g", 0.9m), ("SUGAR", "g", 0), ("FIBT", "g", 0), ("NACL", "g", 0.2m),
                ("F18:3", "g", 0.05m), ("F20:5", "g", 0.01m), ("F22:5", "g", 0.01m), ("F22:6", "g", 0.02m),
                ("F18:2", "g", 0.5m), ("F20:4", "g", 0.04m),
                ("VITA", "RE/µg", 21), ("VITD", "μg", 0.3m), ("NIAEQ", "NE/mg", 14), ("NIA", "mg", 10),
                ("THIACLHCL", "mg", 0.08m), ("FOL", "µg", 6), ("ID", "µg", 2), ("NA", "mg", 70),
                ("VITE", "mg-ATE", 0.4m)),
            warnings.Add);

        Assert.NotNull(row);
        var food = row.Food;
        Assert.Equal(("slv", "1166", "Kyckling bröstfilé rå m. skinn"), (food.Source, food.SourceId, food.Name));
        Assert.Equal("Chicken breast fillet raw with skin", row.NameEn);
        Assert.Equal((120m, 22.5m, 3.2m, 0m), (food.KcalPer100, food.ProteinPer100, food.FatPer100, food.CarbsPer100));
        Assert.Equal((0.9m, 0m, 0m, 0.2m), (food.SaturatedFatPer100, food.SugarsPer100, food.FiberPer100, food.SaltPer100));
        Assert.Equal(0.09m, food.Panel["omega3"]);
        Assert.Equal(0.54m, food.Panel["omega6"]);
        Assert.Equal(0.03m, food.Panel["epaDha"]);
        Assert.Equal(21m, food.Panel["vitaminA"]);
        Assert.Equal(0.3m, food.Panel["vitaminD"]);
        Assert.Equal(14m, food.Panel["niacin"]);
        Assert.Equal(0.08m, food.Panel["thiamin"]);
        Assert.Equal(70m, food.Panel["sodium"]);
        Assert.Null(food.Panel["vitaminE"]);
        Assert.Contains(warnings, warning => warning.StartsWith("VITE", StringComparison.Ordinal));
        Assert.Empty(row.Portions);

        // A missing fatty acid makes the omega-3 total unknown rather than too low. No kcal, no food.
        var partial = LivsmedelsverketImporter.Row(Slv(2, "Smör", "Butter", ("ENERC", "kcal", 740), ("F18:3", "g", 0.3m)));
        Assert.Null(partial!.Food.Panel["omega3"]);
        Assert.Null(LivsmedelsverketImporter.Row(Slv(3, "Vatten", "Water", ("ENERC", "kJ", 0))));
        Assert.Null(LivsmedelsverketImporter.Row(Slv(4, " ", "Nothing", ("ENERC", "kcal", 10))));
    }

    [Fact]
    public async Task A_table_import_stores_retires_and_credits_and_its_foods_say_their_country()
    {
        var user = TestData.NewUser("table-import");
        using var client = factory.AsUser(user);
        await Retire("slv");

        var first = await ImportSlv(
            Slv(90001, "Zqkyckling bröstfilé rå", "Zqchicken breast fillet raw", ("ENERC", "kcal", 110), ("PROT", "g", 23)),
            Slv(90002, "Zqkyckling lår rå", "Zqchicken thigh raw", ("ENERC", "kcal", 140), ("PROT", "g", 19)),
            Slv(90003, "Zqutan energi", "Zqno energy", ("ENERC", "kJ", 100)));
        Assert.Equal((2, 0, 1), (first.Upserted, first.Retired, first.Skipped));
        Assert.StartsWith("Livsmedelsverket", first.Coverage, StringComparison.Ordinal);

        var found = await Search(client, "zqchicken breast");
        var row = Assert.Single(found);
        Assert.Equal("90001", row.GetProperty("sourceId").GetString());
        Assert.Equal("SE", row.GetProperty("country").GetString());

        var second = await ImportSlv(Slv(90001, "Zqkyckling bröstfilé rå", "Zqchicken breast fillet raw", ("ENERC", "kcal", 112)));
        Assert.Equal((1, 1), (second.Upserted, second.Retired));
        Assert.Empty(await Search(client, "zqchicken thigh"));

        var about = await client.GetFromJsonAsync<JsonElement>("/api/about");
        var credit = about.GetProperty("sources").EnumerateArray().Single(source => source.GetProperty("source").GetString() == "slv");
        Assert.Equal(Livsmedelsverket.Citation, credit.GetProperty("citation").GetString());
        Assert.Equal("SE", credit.GetProperty("country").GetString());
        Assert.Equal(1, credit.GetProperty("foodCount").GetInt32());
        await Retire("slv");
    }

    [Fact]
    public async Task Table_keywords_find_foods_and_a_word_many_foods_share_never_outranks_a_name()
    {
        var user = TestData.NewUser("table-keywords");
        using var client = factory.AsUser(user);
        var source = new FoodSource("zqtable", "Zq table", "NO", "Zq citation");
        var group = new[] { "zqgruppe" };
        await ImportTable(source,
            Row("k1", "Agurker, syltede", "Gherkins", "zqsyltis, zqpickle", "zqk"),
            Row("k2", "Zqgruppe, laks", "Salmon", group),
            Row("k3", "Torsk", "Cod", group),
            Row("k4", "Sei", "Saithe", group),
            Row("k5", "Hyse", "Haddock", group),
            Row("k6", "Zqgruppebolle", "Fish ball"));

        // A table's own word finds its food as closely as a name would. A comma-separated list is several words,
        // and a word shorter than four letters is left out.
        Assert.Equal(["k1"], await SourceIds(client, "zqsyltis"));
        Assert.Equal(["k1"], await SourceIds(client, "zqpickle"));
        Assert.DoesNotContain("k1", await SourceIds(client, "zqk"));

        // Four foods share "zqgruppe", so it is a group word: it still finds them, after every food whose name matches.
        var grouped = await SourceIds(client, "zqgruppe");
        Assert.Equal(["k2", "k6"], grouped.Take(2).Order());
        Assert.Equal(["k3", "k4", "k5"], grouped.Skip(2).Order());

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var kinds = await db.FoodAliases.Where(alias => alias.Source == "zqtable")
                .Select(alias => new { alias.SourceId, alias.Normalized, alias.Kind }).ToListAsync();
            Assert.Contains(kinds, alias => alias is { SourceId: "k3", Normalized: "zqgruppe", Kind: FoodAliasKinds.Category });
            Assert.Contains(kinds, alias => alias is { SourceId: "k1", Normalized: "zqpickle", Kind: FoodAliasKinds.Keyword });
            // "zqgruppe" is already in k2's name, so it adds nothing there.
            Assert.DoesNotContain(kinds, alias => alias.SourceId == "k2");

            // Our own phrase is kept when the table drops its keywords.
            db.FoodAliases.Add(new FoodAlias
            {
                Id = Guid.NewGuid(), Source = "zqtable", SourceId = "k3", Phrase = "zqcodfish", Normalized = "zqcodfish",
                ExpectedNameEn = "Cod", Kind = FoodAliasKinds.Lexicon,
            });
            await db.SaveChangesAsync();
        }

        await ImportTable(source, Row("k1", "Agurker, syltede", "Gherkins"), Row("k3", "Torsk", "Cod"));
        Assert.Empty(await SourceIds(client, "zqsyltis"));
        Assert.Equal(["k3"], await SourceIds(client, "zqcodfish"));
        await Retire("zqtable");
    }

    [Fact]
    public async Task Home_foods_come_first_within_each_kind_of_match_and_another_countrys_food_is_logged_in_English()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 12, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("table-home");
        using var client = factory.AsUser(user);
        await Retire("slv");
        await Retire("zqhome");
        await ImportTable(new FoodSource("zqhome", "Zq home", "NO", "Zq"),
            Row("h1", "Zqquinoa, kokt", "Zqquinoa, boiled"),
            Row("h2", "Salat med zqquinoa", "Salad with zqquinoa"));
        await ImportSlv(
            Slv(91001, "Zqquinoa", "Zqquinoa", ("ENERC", "kcal", 360)),
            Slv(91002, "Zqquinoasallad m. fetaost", "Zqquinoa salad with feta", ("ENERC", "kcal", 180)));

        // Name and start of name first, home before Sweden; then last-word matches, home first again.
        Assert.Equal(["h1", "91001", "91002", "h2"], await SourceIds(client, "zqquinoa"));

        await TestData.PutWeighIn(client, "2026-10-24", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "UTC"));
        var swedish = (await Search(client, "zqquinoasallad")).Single().GetProperty("id").GetGuid();
        var logged = await client.PostAsync("/api/log-entries", new StringContent(
            $$"""{"idempotencyKey":"table-home-1","localDate":"2026-10-24","timeZone":"UTC","foodId":"{{swedish}}","amount":150,"unit":"g"}""",
            Encoding.UTF8,
            "application/json"));
        Assert.True(logged.StatusCode == HttpStatusCode.Created, await logged.Content.ReadAsStringAsync());
        var entry = await logged.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Zqquinoa salad with feta", entry.GetProperty("name").GetString());
        await Retire("slv");
        await Retire("zqhome");
    }

    private static SlvFood Slv(int number, string name, string nameEn, params (string Code, string Unit, decimal Value)[] values) =>
        new(number, name, nameEn, values.Select(value => new SlvNutrient(value.Code, value.Unit, value.Value)).ToList());

    private static FoodTableRow Row(string id, string name, string nameEn, params string[] keywords) =>
        new(new ParsedFood("zq", id, null, name, "g", 100, 10, 5, 5, null, null, null, null), nameEn, [], keywords);

    private async Task<FoodTableImportResult> ImportSlv(params SlvFood[] foods)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var importer = scope.ServiceProvider.GetRequiredService<LivsmedelsverketImporter>();
        return await importer.ImportAsync(foods, CancellationToken.None);
    }

    private async Task ImportTable(FoodSource source, params FoodTableRow[] rows)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var importer = scope.ServiceProvider.GetRequiredService<FoodTableImporter>();
        await importer.ImportAsync(source, rows, CancellationToken.None);
    }

    /// <summary>Takes a source out of search, the way an operator would, so other tests' catalogue rows are not affected.</summary>
    private async Task Retire(string source)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.FoodAliases.Where(alias => alias.Source == source).ExecuteDeleteAsync();
        await db.Foods.Where(food => food.Source == source && food.RetiredAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(food => food.RetiredAt, DateTimeOffset.UtcNow));
    }

    private static async Task<List<JsonElement>> Search(HttpClient client, string query)
    {
        var body = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=" + Uri.EscapeDataString(query));
        return body.GetProperty("foods").EnumerateArray().ToList();
    }

    [Fact]
    public void Describe_offers_another_countrys_foods_only_when_home_has_none()
    {
        static RankedFood Hit(string name, int tier) => new(new Food { Name = name }, 1, tier);
        var mixed = new[] { Hit("Hallon", 1), Hit("Bringebær, rå", 0), Hit("Raspberries", 2) };
        Assert.Equal(["Bringebær, rå"], MealDescriber.HomeOnlyWhenFound(mixed).Select(hit => hit.Food.Name));

        var foreignOnly = new[] { Hit("Kåldolmar stekta hemlagade", 1), Hit("Cabbage rolls", 2) };
        Assert.Equal(foreignOnly, MealDescriber.HomeOnlyWhenFound(foreignOnly));
        Assert.Empty(MealDescriber.HomeOnlyWhenFound([]));
    }

    private static async Task<List<string>> SourceIds(HttpClient client, string query) =>
        (await Search(client, query)).Select(row => row.GetProperty("sourceId").GetString() ?? "").ToList();
}
