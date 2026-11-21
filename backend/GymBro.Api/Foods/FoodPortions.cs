using System.Text.Json;
using GymBro.Api.Data;

namespace GymBro.Api.Foods;

/// <summary>
/// A household measure from Matvaretabellen with its weight: a slice, a tablespoon, a glass, a decilitre.
/// <see cref="Id"/> is the table's own key (<c>skive</c>, <c>pr_skive</c>, <c>glass_stort</c>).
/// <see cref="NameEn"/> is the English file's name for it ("slice", "for a slice of bread").
/// </summary>
public sealed record FoodPortion(string Id, string Name, string? NameEn, decimal Grams);

/// <summary>
/// Reads and writes <see cref="Food.Portions"/>, a JSON list kept on Matvaretabellen rows. Describe a meal
/// offers these as amounts ("3 skiver" of cheese is 3 × 10 g, not 3 × the 20 g on a slice of bread) and logs
/// them as grams. Other foods have none.
/// </summary>
public static class FoodPortions
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    public static IReadOnlyList<FoodPortion> Read(Food food)
    {
        if (string.IsNullOrEmpty(food.Portions))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<FoodPortion>>(food.Portions, Options) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>Null for an empty list, so a food without portions keeps a null column.</summary>
    public static string? Write(IReadOnlyList<FoodPortion> portions) =>
        portions.Count == 0 ? null : JsonSerializer.Serialize(portions, Options);
}
