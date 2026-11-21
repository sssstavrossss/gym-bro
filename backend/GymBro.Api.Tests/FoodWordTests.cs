using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

/// <summary>Lexicon v2: a food's word in the other Nordic languages, checked against the three tables' pinned names.</summary>
public sealed class FoodWordPlanTests
{
    private static readonly Lazy<Dictionary<(string Source, string Id), IReadOnlyList<FoodAliasPlanner.PlannedPhrase>>> Planned = new(Plan);

    [Fact]
    public void A_food_gets_its_words_from_the_other_two_tables_languages()
    {
        // Chicken in each table finds the other two languages' word.
        Assert.Equal(["broileri", "kana", "kyckling"], Words("mvt", "03.205"));
        Assert.Equal(["broileri", "kana", "kylling"], Words("slv", "1173"));
        Assert.Equal(["kyckling", "kylling"], Words("fineli", "30265"));

        // Butter, meatballs, a sausage compound and a reindeer genitive.
        Assert.Equal(["smør", "voi"], Words("slv", "29"));
        Assert.Equal(["smör", "smør"], Words("fineli", "30610"));
        Assert.Contains("kjøttboller", Words("slv", "1102"));
        Assert.Contains("lihapullat", Words("slv", "1102"));
        Assert.Contains("korv", Words("fineli", "30157"));
        Assert.Contains("pølse", Words("fineli", "30157"));
        Assert.Contains("reinsdyr", Words("fineli", "734"));

        // An egg is "ägg" in Sweden; "egg" is already the English name, so it is not added again.
        Assert.Contains("ägg", Words("fineli", "8513"));
        Assert.DoesNotContain("egg", Words("fineli", "8513"));
        Assert.Contains("kananmuna", Words("slv", "2205"));
    }

    [Fact]
    public void Dishes_substitutes_and_other_species_keep_to_their_own_words()
    {
        // A compound that names a dish is not the food: reindeer soup, ham pie, carrot cake, egg-rice pasty.
        Assert.DoesNotContain("reinsdyr", Words("fineli", "33479"));
        Assert.DoesNotContain("skinke", Words("fineli", "32813"));
        Assert.DoesNotContain("morot", Words("mvt", "05.210"));
        Assert.DoesNotContain("ägg", Words("fineli", "31796"));
        // A sandwich cake is not butter, and a cream substitute is not cream.
        Assert.DoesNotContain("smør", Words("slv", "797"));
        Assert.DoesNotContain("fløte", Words("slv", "2039"));
        // Baltic herring and Atlantic herring stay apart.
        Assert.Contains("silakka", Words("slv", "1243"));
        Assert.DoesNotContain("sild", Words("slv", "1243"));
        Assert.DoesNotContain("strömming", Words("mvt", "04.033"));
        Assert.Contains("sill", Words("mvt", "04.033"));
    }

    [Fact]
    public void The_english_rules_reach_the_swedish_and_finnish_tables()
    {
        var phrases = Planned.Value[("fineli", "11736")];
        Assert.Contains(phrases, phrase => phrase.Kind == FoodAliasPlanner.KindLexical && phrase.Phrase == "yogurt");
        // Word order and seeds stay Matvaretabellen's, as in v1.
        Assert.DoesNotContain(Planned.Value.Where(row => row.Key.Source != "mvt").SelectMany(row => row.Value),
            phrase => phrase.Kind is FoodAliasPlanner.KindStructural or FoodAliasPlanner.KindHyphen or FoodAliasPlanner.KindSeed);
    }

    [Fact]
    public void Every_word_is_used_and_the_pinned_tables_are_the_ones_reviewed()
    {
        var lexicon = FoodAliasLexicon.Current;
        Assert.Equal(lexicon.Words.Length, lexicon.Words.Select(word => word.Id).Distinct().Count());
        Assert.Equal(lexicon.ReviewedAgainst!.SlvFoodCount, LoadTable("slv").Foods.Count);
        Assert.Equal(lexicon.ReviewedAgainst.FineliFoodCount, LoadTable("fineli").Foods.Count);
        Assert.NotEmpty(lexicon.DishEnds);

        var used = Planned.Value.Values.SelectMany(phrases => phrases)
            .Where(phrase => phrase.Kind == FoodAliasPlanner.KindWord)
            .Select(phrase => phrase.RuleId)
            .ToHashSet(StringComparer.Ordinal);
        var unused = lexicon.Words.Select(word => word.Id).Where(id => !used.Contains(id)).ToList();
        Assert.True(unused.Count == 0, "Words that match no row: " + string.Join(", ", unused));

        foreach (var source in new[] { "mvt", "slv", "fineli" })
        {
            var withWords = Planned.Value.Count(row => row.Key.Source == source && row.Value.Any(phrase => phrase.Kind == FoodAliasPlanner.KindWord));
            Assert.True(withWords >= 300, $"{source}: {withWords}");
        }
    }

    private static string[] Words(string source, string id) =>
        Planned.Value[(source, id)].Where(phrase => phrase.Kind == FoodAliasPlanner.KindWord).Select(phrase => phrase.Phrase).Distinct().Order(StringComparer.Ordinal).ToArray();

    private static Dictionary<(string Source, string Id), IReadOnlyList<FoodAliasPlanner.PlannedPhrase>> Plan()
    {
        var planned = new Dictionary<(string, string), IReadOnlyList<FoodAliasPlanner.PlannedPhrase>>();
        foreach (var food in FoodAliasPlanTests.LoadNames().Foods)
        {
            planned[("mvt", food.Id)] = FoodAliasPlanner.PhrasesFor("mvt", food.Id, food.Nb, food.En);
        }

        foreach (var source in new[] { "slv", "fineli" })
        {
            foreach (var food in LoadTable(source).Foods)
            {
                planned[(source, food.Id)] = FoodAliasPlanner.PhrasesFor(source, food.Id, food.Name, food.En);
            }
        }

        return planned;
    }

    internal static TableNames LoadTable(string source)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", $"{source}-names.v2.json");
        return JsonSerializer.Deserialize<TableNames>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException("Name fixture was empty.");
    }

    internal sealed record TableNames(string Language, List<TableName> Foods);

    internal sealed record TableName(string Id, string Name, string? En);
}

/// <summary>Searching another Nordic language's word finds the home table's food first.</summary>
[Collection(ApiCollection.Name)]
public sealed class FoodWordSearchTests(ApiFactory factory)
{
    [Fact]
    public async Task A_neighbours_word_finds_the_home_tables_food_first()
    {
        string[] sources = ["mvt", "slv", "fineli"];
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 12, 0, 0, TimeSpan.Zero);
        await Clear();
        try
        {
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.Foods.AddRange(
                    Food("mvt", "zqw1", "Kylling, zqvinge", "Chicken, zqwing"),
                    Food("slv", "zqw2", "Kyckling zqvinge", "Chicken zqwing"),
                    Food("fineli", "zqw3", "Broilerin zqsiipi", "Chicken zqwing, fineli"));
                await db.SaveChangesAsync();
                await FoodAliasCatalogue.ApplyAsync(db, CancellationToken.None);
                var phrases = await db.FoodAliases.Where(alias => alias.SourceId.StartsWith("zqw")).Select(alias => alias.SourceId + " " + alias.Normalized).ToListAsync();
                Assert.Contains("zqw1 kyckling", phrases);
                Assert.Contains("zqw2 kylling", phrases);
                Assert.Contains("zqw3 kyckling", phrases);
            }

            // In Norway the Swedish word finds the Norwegian row first; in Finland the Norwegian word finds Fineli's.
            Assert.Equal("zqw1", (await Order("Europe/Oslo", "kyckling"))[0]);
            Assert.Equal("zqw3", (await Order("Europe/Helsinki", "kylling"))[0]);
            Assert.Equal("zqw2", (await Order("Europe/Stockholm", "kylling"))[0]);
            Assert.Equal(3, (await Order("Europe/Oslo", "kyckling")).Length);
        }
        finally
        {
            await Clear();
        }

        async Task<string[]> Order(string zone, string query)
        {
            using var client = factory.AsUser(TestData.NewUser("word-search"));
            if (zone != "Europe/Oslo")
            {
                await TestData.PutWeighIn(client, "2026-10-24", """{"kg":83.6,"timeZone":"UTC"}""");
                await TestData.PutProfile(client, TestData.Profile(timeZone: zone));
            }

            var body = await client.GetFromJsonAsync<JsonElement>($"/api/foods/search?q={Uri.EscapeDataString(query)}");
            return body.GetProperty("foods").EnumerateArray()
                .Where(food => sources.Contains(food.GetProperty("source").GetString()) && food.GetProperty("sourceId").GetString()!.StartsWith("zqw", StringComparison.Ordinal))
                .Select(food => food.GetProperty("sourceId").GetString()!)
                .ToArray();
        }
    }

    private static Food Food(string source, string id, string name, string nameEn) => new()
    {
        Id = Guid.NewGuid(),
        Source = source,
        SourceId = id,
        Name = name,
        NameEn = nameEn,
        Basis = "g",
        KcalPer100 = 150,
        ProteinPer100 = 20,
        FatPer100 = 7,
        CarbsPer100 = 0,
        UpdatedAt = DateTimeOffset.UtcNow,
    };

    private async Task Clear()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.FoodAliases.Where(alias => alias.SourceId.StartsWith("zqw")).ExecuteDeleteAsync();
        await db.Foods.Where(food => food.SourceId.StartsWith("zqw")).ExecuteDeleteAsync();
    }
}
