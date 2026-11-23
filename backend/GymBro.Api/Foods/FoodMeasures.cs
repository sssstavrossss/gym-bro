using System.Text.Json;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Foods;

/// <summary>
/// Household measures for rows of a table that publishes none (Livsmedelsverket), from the embedded
/// <c>food-measures.v1.json</c>: a piece, sometimes a serving, and other sizes, each copied from the same food in
/// Matvaretabellen and reviewed by hand. Describe a meal then counts "2 boiled eggs" as 2 × 56 g instead of guessing.
/// </summary>
public static class FoodMeasures
{
    public const string PieceLabel = "piece";

    public const string ServingLabel = "portion";

    /// <summary>The tables these measures are for. A table with measures of its own keeps them.</summary>
    public static readonly IReadOnlySet<string> Sources = new HashSet<string>(StringComparer.Ordinal) { Livsmedelsverket.Source };

    /// <summary>The measures a row can list, with their Swedish and English names.</summary>
    public static readonly IReadOnlyDictionary<string, (string Name, string NameEn)> Kinds = new Dictionary<string, (string, string)>(StringComparer.Ordinal)
    {
        ["piece_small"] = ("liten (st)", "small piece"),
        ["piece_large"] = ("stor (st)", "large piece"),
        ["slice"] = ("skiva", "slice"),
        ["wedge"] = ("klyfta", "wedge"),
        ["dl"] = ("dl", "decilitre"),
    };

    private static readonly Lazy<FoodMeasureFile> CurrentFile = new(Load);

    public static FoodMeasureFile Current => CurrentFile.Value;

    /// <summary>An entry's measures as the row stores them: the piece, the serving, and the other sizes in file order.</summary>
    public static FoodMeasureSet Set(FoodMeasureEntry entry) => new(
        entry.Piece,
        entry.Serving,
        (entry.Measures ?? [])
            .Select(measure => new FoodPortion(measure.Key, Kinds[measure.Key].Name, Kinds[measure.Key].NameEn, measure.Value))
            .ToList());

    /// <summary>
    /// Gives each listed row of <paramref name="source"/> (or of every listed table) its measures. A row whose name
    /// is no longer the reviewed one is left as it is and counted as renamed; a retired or absent row is missing.
    /// </summary>
    public static async Task<FoodMeasureResult> ApplyAsync(AppDbContext db, string? source, CancellationToken cancellationToken)
    {
        var entries = Current.Foods.Where(entry => source is null || entry.Source == source).ToList();
        if (entries.Count == 0)
        {
            return new FoodMeasureResult(0, 0, 0, 0);
        }

        var sources = entries.Select(entry => entry.Source).Distinct().ToList();
        var ids = entries.Select(entry => entry.Id).Distinct().ToList();
        var foods = (await db.Foods
                .Where(food => food.UserId == null && food.RetiredAt == null && sources.Contains(food.Source) && ids.Contains(food.SourceId))
                .ToListAsync(cancellationToken))
            .ToDictionary(food => (food.Source, food.SourceId));

        int updated = 0, present = 0, renamed = 0, missing = 0;
        foreach (var entry in entries)
        {
            if (!foods.TryGetValue((entry.Source, entry.Id), out var food))
            {
                missing++;
                continue;
            }

            if (food.Name != entry.Name)
            {
                renamed++;
                continue;
            }

            var set = Set(entry);
            if (Has(food, set))
            {
                present++;
                continue;
            }

            food.PieceQuantity = set.Piece;
            food.PieceLabel = PieceLabel;
            food.ServingQuantity = set.Serving;
            food.ServingLabel = set.Serving is null ? null : ServingLabel;
            food.Portions = FoodPortions.Write(set.Portions);
            updated++;
        }

        await db.SaveChangesAsync(cancellationToken);
        return new FoodMeasureResult(updated, present, renamed, missing);
    }

    private static bool Has(Food food, FoodMeasureSet set) =>
        food.PieceQuantity == set.Piece
        && food.PieceLabel == PieceLabel
        && food.ServingQuantity == set.Serving
        && food.ServingLabel == (set.Serving is null ? null : ServingLabel)
        && FoodPortions.Read(food).SequenceEqual(set.Portions);

    private static FoodMeasureFile Load()
    {
        var assembly = typeof(FoodMeasureFile).Assembly;
        var name = assembly.GetManifestResourceNames().Single(resource => resource.EndsWith("food-measures.v1.json", StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(name) ?? throw new InvalidOperationException("Food measures are missing.");
        return JsonSerializer.Deserialize<FoodMeasureFile>(stream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException("Food measures were empty.");
    }
}

public sealed class FoodMeasureFile
{
    public int Version { get; init; }

    public string[] About { get; init; } = [];

    public FoodMeasureEntry[] Foods { get; init; } = [];
}

/// <param name="From">The Matvaretabellen row the weights were copied from: its id and name.</param>
/// <param name="Measures">Other sizes by <see cref="FoodMeasures.Kinds"/> id, in grams.</param>
public sealed record FoodMeasureEntry(
    string Source,
    string Id,
    string Name,
    string From,
    decimal Piece,
    decimal? Serving,
    Dictionary<string, decimal>? Measures);

public sealed record FoodMeasureSet(decimal Piece, decimal? Serving, IReadOnlyList<FoodPortion> Portions);

public sealed record FoodMeasureResult(int Updated, int AlreadyPresent, int Renamed, int Missing);
