using GymBro.Api.Data;
using GymBro.Api.Describe;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

/// <summary>The reviewed measures file, checked against the pinned Livsmedelsverket and Matvaretabellen names.</summary>
public sealed class FoodMeasureFileTests
{
    [Fact]
    public void Every_row_names_a_swedish_food_and_the_norwegian_food_it_was_weighed_from()
    {
        var file = FoodMeasures.Current;
        Assert.Equal(1, file.Version);
        Assert.NotEmpty(file.Foods);
        Assert.Equal(file.Foods.Length, file.Foods.Select(entry => (entry.Source, entry.Id)).Distinct().Count());

        var swedish = FoodWordPlanTests.LoadTable("slv").Foods.ToDictionary(food => food.Id, food => food.Name);
        var norwegian = FoodAliasPlanTests.LoadNames().Foods.ToDictionary(food => food.Id, food => food.Nb);
        foreach (var entry in file.Foods)
        {
            // Only for a table without measures of its own, and only while its name is the reviewed one.
            Assert.Contains(entry.Source, FoodMeasures.Sources);
            Assert.True(swedish.TryGetValue(entry.Id, out var name) && name == entry.Name, $"{entry.Id} {entry.Name} is not the pinned name ({name}).");

            // "mvt 02.026 Egg, kokt": that row exists with that name.
            var from = entry.From.Split(' ', 3);
            Assert.True(from.Length == 3 && from[0] == "mvt", entry.From);
            Assert.True(norwegian.TryGetValue(from[1], out var donor) && donor == from[2], $"{entry.Id}: {entry.From} is not the pinned name ({donor}).");

            Assert.InRange(entry.Piece, 1, 1000);
            Assert.True(entry.Serving is null or > 0, entry.Id);
            foreach (var (kind, grams) in entry.Measures ?? [])
            {
                Assert.True(FoodMeasures.Kinds.ContainsKey(kind), $"{entry.Id}: unknown measure {kind}");
                Assert.InRange(grams, 1, 1000);
            }
        }
    }

    [Fact]
    public void An_egg_counts_as_matvaretabellens_egg_and_a_potato_has_its_sizes()
    {
        var egg = Entry("2205");
        Assert.Equal(56, egg.Piece);
        Assert.Equal("mvt 02.026 Egg, kokt", egg.From);
        Assert.Equal(48, Entry("1233").Piece);

        var potato = FoodMeasures.Set(Entry("4458"));
        Assert.Equal((55m, 170m), (potato.Piece, potato.Serving!.Value));
        Assert.Equal(
            [new FoodPortion("piece_small", "liten (st)", "small piece", 30), new FoodPortion("piece_large", "stor (st)", "large piece", 100)],
            potato.Portions);
    }

    private static FoodMeasureEntry Entry(string id) => FoodMeasures.Current.Foods.Single(entry => entry.Source == "slv" && entry.Id == id);
}

/// <summary>The Livsmedelsverket import and the backfill put the reviewed measures on the rows, and Describe offers them.</summary>
[Collection(ApiCollection.Name)]
public sealed class FoodMeasureImportTests(ApiFactory factory)
{
    [Fact]
    public async Task An_imported_swedish_egg_has_a_piece_and_a_renamed_row_has_none()
    {
        await Retire();
        try
        {
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var importer = scope.ServiceProvider.GetRequiredService<LivsmedelsverketImporter>();
                await importer.ImportAsync(
                    [
                        Slv(2205, "Ägg kokt", "Egg boiled", 140),
                        Slv(4458, "Potatis kokt m. salt", "Potato boiled w/ salt", 80),
                        // Renamed since the review: it may be another food now, so it gets nothing.
                        Slv(553, "Banan ekologisk", "Banana organic", 95),
                    ],
                    CancellationToken.None);
            }

            var egg = await Food("2205");
            Assert.Equal((56m, "piece"), (egg.PieceQuantity!.Value, egg.PieceLabel!));
            Assert.Null(egg.ServingQuantity);
            Assert.Contains(MealDescriber.Units(egg, null), unit => unit.Unit == "piece" && unit.Grams == 56);

            var potato = await Food("4458");
            Assert.Equal((170m, "portion"), (potato.ServingQuantity!.Value, potato.ServingLabel!));
            var units = MealDescriber.Units(potato, null);
            Assert.Equal(["g", "serving", "piece", "piece_small", "piece_large"], units.Select(unit => unit.Unit));
            Assert.Equal("small piece", units.Single(unit => unit.Unit == "piece_small").Label);

            var banana = await Food("553");
            Assert.Null(banana.PieceQuantity);
            Assert.Null(banana.Portions);

            // The backfill puts back what is missing, then finds everything in place.
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await db.Foods.Where(food => food.Source == "slv" && food.SourceId == "2205")
                    .ExecuteUpdateAsync(set => set.SetProperty(food => food.PieceQuantity, (decimal?)null).SetProperty(food => food.PieceLabel, (string?)null));
                var first = await FoodMeasures.ApplyAsync(db, null, CancellationToken.None);
                Assert.Equal((1, 1, 1), (first.Updated, first.AlreadyPresent, first.Renamed));
                Assert.Equal(FoodMeasures.Current.Foods.Length - 3, first.Missing);
            }

            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var second = await FoodMeasures.ApplyAsync(db, null, CancellationToken.None);
                Assert.Equal((0, 2, 1), (second.Updated, second.AlreadyPresent, second.Renamed));
            }

            Assert.Equal(56m, (await Food("2205")).PieceQuantity);
        }
        finally
        {
            await Retire();
        }
    }

    private static SlvFood Slv(int number, string name, string nameEn, decimal kcal) =>
        new(number, name, nameEn, [new SlvNutrient("ENERC", "kcal", kcal), new SlvNutrient("PROT", "g", 10)]);

    private async Task<Food> Food(string id)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Foods.AsNoTracking().SingleAsync(food => food.Source == "slv" && food.SourceId == id && food.UserId == null);
    }

    /// <summary>
    /// Takes Livsmedelsverket out of search so other tests' rows are not affected, and deletes this test's rows: their
    /// real names would otherwise get lexicon words in another test's alias backfill.
    /// </summary>
    private async Task Retire()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        string[] ours = ["2205", "4458", "553"];
        await db.FoodAliases.Where(alias => alias.Source == "slv").ExecuteDeleteAsync();
        await db.Foods.Where(food => food.Source == "slv" && food.UserId == null && ours.Contains(food.SourceId)).ExecuteDeleteAsync();
        await db.Foods.Where(food => food.Source == "slv" && food.RetiredAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(food => food.RetiredAt, DateTimeOffset.UtcNow));
    }
}
