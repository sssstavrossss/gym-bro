using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

/// <summary>Spelling help for a search that finds few foods.</summary>
[Collection(ApiCollection.Name)]
public sealed class FoodSpellingTests(ApiFactory factory)
{
    [Fact]
    public void A_misspelt_word_takes_the_most_alike_word_and_the_home_tables_spelling_wins_a_tie()
    {
        // Trigrams score a doubled letter poorly; edit distance (one letter in seven) takes it.
        Assert.Equal("banana", FoodSpelling.Pick("bannana", [Word("banana", 20, 10, 0.45), Word("bannock", 3, 3, 0.4)]));

        // "brod" folds to both. In Norway the Norwegian spelling wins, in Sweden the Swedish one.
        Assert.Equal("brød", FoodSpelling.Pick("brod", [Word("brød", 30, 30, 1), Word("bröd", 40, 0, 1)]));
        Assert.Equal("bröd", FoodSpelling.Pick("brod", [Word("brød", 30, 0, 1), Word("bröd", 40, 40, 1)]));

        // Not alike enough either way: "sipsit" (crisps) is not "sipuli" (onion).
        Assert.Null(FoodSpelling.Pick("sipsit", [Word("sipuli", 50, 50, 0.27)]));
    }

    [Fact]
    public void A_word_the_catalogue_has_stays_unless_a_far_more_common_word_is_alike_both_ways()
    {
        Assert.Null(FoodSpelling.Pick("kesam", [Word("kesam", 2, 2, 1), Word("sesam", 40, 40, 0.33)]));
        Assert.Equal("chicken", FoodSpelling.Pick("chiken", [Word("chiken", 2, 0, 1), Word("chicken", 30, 0, 0.6)]));
        Assert.Null(FoodSpelling.Pick("chiken", [Word("chiken", 2, 0, 1), Word("chicken", 8, 0, 0.6)]));
    }

    [Fact]
    public void The_start_of_a_longer_word_is_left_as_typed()
    {
        Assert.Null(FoodSpelling.Pick("kyllingbr", [Word("kyllingbryst", 5, 5, 0.6), Word("kylling", 50, 50, 0.6)]));
    }

    [Fact]
    public void Edit_similarity_counts_two_swapped_letters_as_one_edit()
    {
        Assert.Equal(1 - 1 / 7.0, FoodSpelling.EditSimilarity("lasange", "lasagne"), 6);
        Assert.Equal(1 - 2 / 7.0, FoodSpelling.EditSimilarity("lasange", "lange"), 6);
        Assert.Equal(1, FoodSpelling.EditSimilarity("", ""));
    }

    [Fact]
    public async Task The_database_folds_letters_as_the_code_does()
    {
        const string text = "kjøttdeig blåbær smör müsli café crème ñandú çà ýß œ";
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var folded = await db.Database.SqlQuery<string>($"SELECT food_fold({text}) AS \"Value\"").SingleAsync();
        Assert.Equal(FoodSpelling.Fold(text), folded);
        Assert.Equal("kjottdeig blabaer smor musli cafe creme nandu ca yss œ", folded);
    }

    [Fact]
    public async Task A_misspelt_search_adds_the_foods_spelt_right_and_never_reads_another_persons_foods()
    {
        var user = TestData.NewUser("spelling-a");
        var stranger = TestData.NewUser("spelling-b");
        using var client = factory.AsUser(user);
        using var other = factory.AsUser(stranger);
        string[] ids = ["spell.raw", "spell.fried", "spell.pork"];
        try
        {
            await Clear(ids);
            await Add("spell.raw", "Zqkjøttdeig, rå", "Zqmince, raw");
            await Add("spell.fried", "Zqkjøttdeig, stekt", "Zqmince, fried");
            await Add("spell.pork", "Zqkjøttdeig av svin", "Zqmince of pork");

            var (found, corrected) = await Search(client, "zqkjottdeig");
            Assert.Equal("zqkjøttdeig", corrected);
            Assert.Equal(["spell.fried", "spell.pork", "spell.raw"], found.Order());

            // Spelt right, the search finds them itself and says nothing.
            (found, corrected) = await Search(client, "Zqkjøttdeig");
            Assert.Null(corrected);
            Assert.Equal(3, found.Count);

            var custom = await other.PostAsJsonAsync("/api/foods", new
            {
                name = "Zqxylofonsuppe",
                kcalPer100 = 10,
                proteinPer100 = 1,
                fatPer100 = 1,
                carbsPer100 = 1,
            });
            Assert.True(custom.IsSuccessStatusCode, await custom.Content.ReadAsStringAsync());

            // The owner's own foods spell words for the owner, and for nobody else.
            var owner = await other.GetFromJsonAsync<JsonElement>("/api/foods/search?q=zqxylofomsuppe");
            Assert.Equal("zqxylofonsuppe", owner.GetProperty("correctedQuery").GetString());
            Assert.Single(owner.GetProperty("foods").EnumerateArray());

            var (strangers, guess) = await Search(client, "zqxylofomsuppe");
            Assert.Null(guess);
            Assert.Empty(strangers);
        }
        finally
        {
            await Clear(ids);
            await using var scope = factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Foods.Where(food => food.UserId == stranger).ExecuteDeleteAsync();
        }
    }

    private static SpellingCandidate Word(string word, int count, int home, double similarity) =>
        new() { Word = word, Count = count, HomeCount = home, Similarity = similarity };

    private static async Task<(List<string> SourceIds, string? Corrected)> Search(HttpClient client, string query)
    {
        var body = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=" + Uri.EscapeDataString(query));
        var ids = body.GetProperty("foods").EnumerateArray().Select(row => row.GetProperty("sourceId").GetString() ?? "").ToList();
        var corrected = body.TryGetProperty("correctedQuery", out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
        return (ids, corrected);
    }

    private async Task Add(string sourceId, string name, string nameEn)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Foods.Add(new Food
        {
            Id = Guid.NewGuid(),
            Source = "mvt",
            SourceId = sourceId,
            Name = name,
            NameEn = nameEn,
            Basis = "g",
            NutrientBasis = NutrientBases.Per100,
            KcalPer100 = 100,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    private async Task Clear(string[] ids)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Foods.Where(food => food.Source == "mvt" && ids.Contains(food.SourceId)).ExecuteDeleteAsync();
    }
}
