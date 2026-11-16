using GymBro.Api.Data;

namespace GymBro.Api.Foods;

/// <summary>
/// The foods a person has logged that carry the most of one nutrient per 100 g or ml.
/// Only foods with per-100 values take part: a per-serving food has no comparable figure.
/// A food without the nutrient, or with 0, is left out.
/// </summary>
public static class NutrientSources
{
    public const int Limit = 5;

    private static readonly HashSet<string> Keys = NutrientPanel.Per100(new Food()).Keys.ToHashSet(StringComparer.Ordinal);

    public static bool IsKnown(string? key) => key is not null && Keys.Contains(key);

    public static List<NutrientSource> Rank(IEnumerable<Food> foods, string key) => foods
        .Where(food => food.NutrientBasis == NutrientBases.Per100 && food.RetiredAt is null)
        .Select(food => (Food: food, Value: NutrientPanel.Per100(food)[key]))
        .Where(pair => pair.Value is > 0m)
        .OrderByDescending(pair => pair.Value)
        .ThenBy(pair => pair.Food.Name, StringComparer.Ordinal)
        .Take(Limit)
        .Select(pair => new NutrientSource(pair.Food.Id, pair.Food.Name, pair.Food.Brand, pair.Food.Basis ?? "g", pair.Value!.Value))
        .ToList();
}

public sealed record NutrientSource(Guid Id, string Name, string? Brand, string Basis, decimal Per100);
