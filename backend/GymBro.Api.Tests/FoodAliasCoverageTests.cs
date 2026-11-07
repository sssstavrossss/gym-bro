using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

public sealed class FoodAliasPlanTests
{
    private static readonly Dictionary<string, string> Groups = new()
    {
        ["1"] = "Milk and cheese",
        ["2"] = "Egg",
        ["3"] = "Meat and poultry",
        ["4"] = "Fish and shellfish",
        ["5"] = "Cereals and bread",
        ["6"] = "Vegetables",
        ["7"] = "Sugar and sweets",
        ["8"] = "Fats and oils",
        ["9"] = "Drinks",
        ["10"] = "Prepared dishes and condiments",
        ["11"] = "Baby food",
        ["12"] = "Legumes",
        ["13"] = "Fruit, berries, and jam",
        ["14"] = "Nuts and seeds",
        ["15"] = "Potatoes",
        ["16"] = "Spices",
    };

    [Fact]
    public void The_pinned_catalogue_gets_synonyms_without_the_known_false_matches()
    {
        var file = LoadNames();
        var lexicon = FoodAliasLexicon.Current;
        Assert.Equal(1, lexicon.Version);
        Assert.Equal(lexicon.ReviewedAgainst!.EnSha256, file.EnSha256);
        Assert.Equal(lexicon.ReviewedAgainst.NbSha256, file.NbSha256);
        Assert.Equal(2121, file.Foods.Count);
        Assert.Equal(lexicon.Rules.Select(rule => rule.Id).Distinct().Count(), lexicon.Rules.Length);

        var planned = file.Foods.Select(food => (food, phrases: FoodAliasPlanner.PhrasesFor(food.Id, food.Nb, food.En))).ToList();
        string[] Ids(string query) => planned
            .Where(row => row.phrases.Any(phrase => FoodAliasCatalogue.Normalize(phrase.Phrase) == FoodAliasCatalogue.Normalize(query)))
            .Select(row => row.food.Id)
            .OrderBy(id => id)
            .ToArray();

        Assert.Equal(["03.205", "03.242", "03.418", "03.481"], Ids("chicken breast"));
        Assert.DoesNotContain("03.330", Ids("chicken breast"));
        Assert.Equal(["03.205"], Ids("raw chicken breast"));
        Assert.Equal(["03.242", "03.481"], Ids("fried chicken breast"));
        Assert.DoesNotContain("03.242", Ids("raw chicken breast"));
        Assert.Equal(["03.224"], Ids("hen breast"));
        Assert.DoesNotContain("03.236", Ids("hen breast"));
        Assert.Equal(["03.204", "03.241"], Ids("turkey fillet"));
        Assert.DoesNotContain("03.323", Ids("turkey fillet"));
        Assert.Equal(["06.015"], Ids("eggplant"));
        Assert.Equal(["06.085"], Ids("courgette"));
        Assert.DoesNotContain("06.033", Ids("courgette"));
        Assert.Equal(["06.100"], Ids("arugula"));
        Assert.Equal(["06.113"], Ids("green onion"));
        Assert.DoesNotContain("04.375", Ids("green onion"));
        Assert.Equal(["06.121"], Ids("cilantro"));
        Assert.DoesNotContain("06.194", Ids("cilantro"));
        Assert.Contains("06.213", Ids("garbanzo"));
        Assert.Contains("06.091", Ids("chickpeas"));
        Assert.DoesNotContain("06.817", Ids("garbanzo"));
        Assert.Equal(["08.113", "08.235"], Ids("canola oil"));
        Assert.DoesNotContain("08.229", Ids("canola"));
        Assert.DoesNotContain("03.209", Ids("filet mignon"));
        Assert.Equal(["03.058"], Ids("filet mignon"));
        Assert.Contains("01.055", Ids("brown cheese"));
        Assert.DoesNotContain("01.059", Ids("brown cheese"));
        Assert.Equal(["04.121"], Ids("crayfish"));
        Assert.DoesNotContain("10.206", Ids("crayfish"));
        Assert.Equal(["06.179"], Ids("butter beans"));
        Assert.DoesNotContain("08.005", Ids("butter beans"));
        Assert.Contains("04.220", Ids("raw salmon"));
        Assert.Contains("04.015", Ids("raw salmon"));
        Assert.DoesNotContain("04.343", Ids("raw salmon"));
        Assert.Contains("02.001", Ids("raw egg"));
        Assert.DoesNotContain("02.025", Ids("raw egg"));
        Assert.Empty(Ids("elk"));
        Assert.Contains("05.399", Ids("crispbread"));
        Assert.Contains("06.047", Ids("bell pepper"));
        Assert.DoesNotContain("06.164", Ids("bell pepper"));
        Assert.Contains("06.047", Ids("capsicum"));

        foreach (var seed in FoodAliasCatalogue.Seeds)
        {
            var food = file.Foods.Single(row => row.Id == seed.SourceId);
            Assert.Equal(seed.ExpectedNameEn, food.En);
            var phrases = FoodAliasPlanner.PhrasesFor(food.Id, food.Nb, food.En);
            foreach (var phrase in seed.Phrases)
            {
                Assert.Contains(phrases, item => FoodAliasCatalogue.Normalize(item.Phrase) == FoodAliasCatalogue.Normalize(phrase));
            }
        }

        var lexicalFoods = planned.Count(row => row.phrases.Any(phrase => phrase.Kind is FoodAliasPlanner.KindLexical or FoodAliasPlanner.KindSeed));
        var any = planned.Count(row => row.phrases.Count > 0);
        Assert.True(lexicalFoods >= 100, lexicalFoods.ToString());
        Assert.True(any >= 1800, any.ToString());
        Assert.Equal(16, planned.Select(row => row.food.Group.Split('.')[0]).Distinct().Count());
        WriteReport(file, planned);
    }

    private static void WriteReport(NameFile file, List<(NameFood food, IReadOnlyList<FoodAliasPlanner.PlannedPhrase> phrases)> planned)
    {
        var rules = planned
            .SelectMany(row => row.phrases.Where(phrase => phrase.Kind is FoodAliasPlanner.KindLexical or FoodAliasPlanner.KindSeed).Select(phrase => phrase.RuleId).Distinct()
                .Select(rule => (rule, row.food)))
            .GroupBy(item => item.rule)
            .Select(group => new
            {
                rule = group.Key,
                foods = group.Count(),
                examples = group.Take(3).Select(item => new { item.food.Id, item.food.En, item.food.Nb }).ToArray(),
            })
            .OrderByDescending(item => item.foods)
            .ToArray();
        var groups = planned.GroupBy(row => row.food.Group.Split('.')[0])
            .Select(group => new
            {
                group = group.Key,
                label = Groups.GetValueOrDefault(group.Key, group.Key),
                foods = group.Count(),
                withLexical = group.Count(row => row.phrases.Any(phrase => phrase.Kind is FoodAliasPlanner.KindLexical or FoodAliasPlanner.KindSeed)),
                withAnyPhrase = group.Count(row => row.phrases.Count > 0),
            })
            .OrderBy(item => item.group, StringComparer.Ordinal)
            .ToArray();
        var uncovered = planned.Where(row => row.phrases.Count == 0).Take(20)
            .Select(row => new { row.food.Id, row.food.En, reason = "Official name has no comma gap, hyphen, or lexicon match, so the existing name search already covers the words it uses." })
            .ToArray();
        var report = new
        {
            lexiconVersion = FoodAliasLexicon.Current.Version,
            catalogueFoods = file.Foods.Count,
            enSha256 = file.EnSha256,
            nbSha256 = file.NbSha256,
            aliasRows = planned.Sum(row => row.phrases.Count),
            foodsWithAnyPhrase = planned.Count(row => row.phrases.Count > 0),
            foodsWithLexicalOrPreservedSeed = planned.Count(row => row.phrases.Any(phrase => phrase.Kind is FoodAliasPlanner.KindLexical or FoodAliasPlanner.KindSeed)),
            foodsWithOnlyPunctuationOrWordOrder = planned.Count(row => row.phrases.Count > 0 && row.phrases.All(phrase => phrase.Kind is FoodAliasPlanner.KindStructural or FoodAliasPlanner.KindHyphen)),
            foodsWithNoAddedPhrase = planned.Count(row => row.phrases.Count == 0),
            preservedSeedPhrases = FoodAliasCatalogue.Seeds.Sum(seed => seed.Phrases.Count),
            groups,
            rules,
            uncoveredExamples = uncovered,
            limits = FoodAliasLexicon.Current.Limits,
        };
        var json = JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true });
        try
        {
            Directory.CreateDirectory("/opt/cursor/artifacts");
            File.WriteAllText("/opt/cursor/artifacts/food-alias-coverage.json", json);
        }
        catch (IOException)
        {
            // The assertions above are the check. The artifact directory is for review.
        }
    }

    internal static NameFile LoadNames()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "mvt-names.v1.json");
        return JsonSerializer.Deserialize<NameFile>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException("Name fixture was empty.");
    }
}

[Collection(ApiCollection.Name)]
public sealed class FoodAliasCatalogueSearchTests(ApiFactory factory)
{
    [Fact]
    public async Task Backfill_on_the_pinned_catalogue_is_idempotent_and_keeps_snapshots()
    {
        var file = FoodAliasPlanTests.LoadNames();
        var ids = file.Foods.Select(food => food.Id).ToArray();
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        try
        {
            await Clear(ids);
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var now = DateTimeOffset.UtcNow;
                db.Foods.AddRange(file.Foods.Select(food => new Food
                {
                    Id = Guid.NewGuid(),
                    Source = "mvt",
                    SourceId = food.Id,
                    Name = food.Nb,
                    NameEn = food.En,
                    Basis = "g",
                    NutrientBasis = NutrientBases.Per100,
                    KcalPer100 = food.Id == "06.015" ? 25 : 1,
                    ProteinPer100 = 1,
                    FatPer100 = 1,
                    CarbsPer100 = 1,
                    UpdatedAt = now,
                }));
                await db.SaveChangesAsync();
                var first = await FoodAliasCatalogue.ApplyAsync(db, CancellationToken.None);
                Assert.True(first.Inserted > 4000, first.Inserted.ToString());
                Assert.True(first.Considered >= file.Foods.Count, first.Considered.ToString());
                var second = await FoodAliasCatalogue.ApplyAsync(db, CancellationToken.None);
                Assert.Equal(0, second.Inserted);
                Assert.True(second.AlreadyPresent >= first.Inserted);
            }

            var user = TestData.NewUser("alias-cat");
            var stranger = TestData.NewUser("alias-cat-b");
            using var client = factory.AsUser(user);
            using var other = factory.AsUser(stranger);
            await Setup(client);

            Assert.Equal(["06.015"], await Ids(client, "eggplant"));
            Assert.Equal(["06.015"], await Ids(client, "  Eggplant. "));
            Assert.Contains("03.205", await Ids(client, "kyllingbryst"));
            Assert.Contains("06.213", await Ids(client, "garbanzo"));
            Assert.DoesNotContain("06.817", await Ids(client, "garbanzo"));
            Assert.Contains("01.055", await Ids(client, "brown cheese"));
            Assert.Contains("04.220", await Ids(client, "raw salmon"));
            Assert.DoesNotContain("04.343", await Ids(client, "raw salmon"));
            Assert.Contains("02.001", await Ids(client, "raw egg"));
            Assert.Contains("05.399", await Ids(client, "crispbread"));
            Assert.Contains("08.235", await Ids(client, "canola oil"));
            Assert.DoesNotContain("08.229", await Ids(client, "canola"));
            Assert.Equal(["03.205"], await Ids(client, "raw chicken breast"));
            Assert.DoesNotContain("03.330", await Ids(client, "chicken breast"));

            var found = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=eggplant");
            var rows = found.GetProperty("foods").EnumerateArray().ToList();
            Assert.Single(rows);
            Assert.Equal(25, rows[0].GetProperty("kcalPer100").GetDecimal());
            var foodId = rows[0].GetProperty("id").GetGuid();
            var created = await client.PostAsync("/api/log-entries", Json($$"""
                {"idempotencyKey":"alias-cat-1","localDate":"2026-10-24","timeZone":"UTC","foodId":"{{foodId}}","amount":100,"unit":"g"}
                """));
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
            var entryId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await FoodAliasCatalogue.ApplyAsync(db, CancellationToken.None);
                var food = await db.Foods.SingleAsync(row => row.Source == "mvt" && row.SourceId == "06.015");
                Assert.Equal(25, food.KcalPer100);
                Assert.Equal("Aubergine, rå", food.Name);
                var entry = await db.LogEntries.SingleAsync(row => row.Id == entryId);
                Assert.Equal(25, entry.Kcal);
                food.RetiredAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync();
            }

            Assert.DoesNotContain("06.015", await Ids(client, "eggplant"));

            var custom = await other.PostAsJsonAsync("/api/foods", new
            {
                name = "Aubergine, raw",
                kcalPer100 = 10,
                proteinPer100 = 1,
                fatPer100 = 1,
                carbsPer100 = 1,
            });
            Assert.Equal(HttpStatusCode.Created, custom.StatusCode);
            var privateId = (await custom.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
            Assert.Contains(privateId, await FoodIds(other, "Aubergine"));
            Assert.DoesNotContain(privateId, await FoodIds(client, "eggplant"));
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                Assert.Equal(0, await db.FoodAliases.CountAsync(alias => alias.Source == "custom"));
            }

            var watch = Stopwatch.StartNew();
            await Ids(client, "eggplant");
            await Ids(client, "chicken breast");
            await Ids(client, "raw salmon");
            await Ids(client, "garbanzo");
            await Ids(client, "whole wheat");
            watch.Stop();
            Assert.True(watch.ElapsedMilliseconds < 5000, "searches took " + watch.ElapsedMilliseconds + " ms");
        }
        finally
        {
            await Clear(ids);
        }
    }

    private async Task Clear(string[] ids)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var foodIds = await db.Foods.Where(food => food.Source == "mvt" && ids.Contains(food.SourceId)).Select(food => food.Id).ToListAsync();
        if (foodIds.Count > 0)
        {
            await db.LogEntries.Where(entry => entry.FoodId != null && foodIds.Contains(entry.FoodId.Value)).ExecuteDeleteAsync();
        }

        await db.FoodAliases.Where(alias => alias.Source == "mvt" && ids.Contains(alias.SourceId)).ExecuteDeleteAsync();
        await db.Foods.Where(food => food.Source == "mvt" && ids.Contains(food.SourceId)).ExecuteDeleteAsync();
    }

    private static async Task<List<string>> Ids(HttpClient client, string query)
    {
        var body = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=" + Uri.EscapeDataString(query));
        return body.GetProperty("foods").EnumerateArray().Select(row => row.GetProperty("sourceId").GetString() ?? "").ToList();
    }

    private static async Task<List<Guid>> FoodIds(HttpClient client, string query)
    {
        var body = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=" + Uri.EscapeDataString(query));
        return body.GetProperty("foods").EnumerateArray().Select(row => row.GetProperty("id").GetGuid()).ToList();
    }

    private static async Task Setup(HttpClient client)
    {
        await TestData.PutWeighIn(client, "2026-10-24", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "UTC"));
    }

    private static StringContent Json(string json) => new(json, System.Text.Encoding.UTF8, "application/json");
}

public sealed class NameFile
{
    public string EnSha256 { get; set; } = "";

    public string NbSha256 { get; set; } = "";

    public int FoodCount { get; set; }

    public List<NameFood> Foods { get; set; } = [];
}

public sealed class NameFood
{
    public string Id { get; set; } = "";

    public string Group { get; set; } = "";

    public string En { get; set; } = "";

    public string Nb { get; set; } = "";
}
