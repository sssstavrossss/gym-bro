namespace GymBro.Api.Describe;

/// <summary>
/// Reads the nutrition table in a photo of a food's packaging, so New food can fill its fields. The model only
/// copies what is printed; the person checks every number before the food is saved.
/// </summary>
public interface ILabelModel
{
    string Name { get; }

    /// <remarks>Adds what the call cost to <paramref name="usage"/>, even when it then fails.</remarks>
    Task<LabelReading> ReadAsync(MealPhoto photo, MealUsage usage, CancellationToken cancellationToken);
}

/// <summary>
/// What a label says, as printed. <see cref="PerServing"/> is false when the numbers are per 100 g (or per 100 ml),
/// which labels print whenever they have room. kJ is kept apart so a label that prints only kJ can still be read.
/// A value the label doesn't show is null.
/// </summary>
public sealed record LabelReading(
    bool Table,
    string Name,
    string Brand,
    bool PerServing,
    string ServingName,
    decimal? ServingGrams,
    decimal? Kcal,
    decimal? Kj,
    decimal? Protein,
    decimal? Fat,
    decimal? Carbs,
    decimal? SaturatedFat,
    decimal? Sugars,
    decimal? Fiber,
    decimal? Salt);

/// <summary>A label as New food takes it: per 100 g unless only a serving was printed, kcal always, and no impossible number.</summary>
public sealed record LabelFill(
    string Name,
    string Brand,
    string Basis,
    string ServingName,
    decimal? ServingGrams,
    decimal Kcal,
    decimal? Protein,
    decimal? Fat,
    decimal? Carbs,
    decimal? SaturatedFat,
    decimal? Sugars,
    decimal? Fiber,
    decimal? Salt);

public static class LabelRules
{
    public const decimal KjPerKcal = 4.184m;

    /// <summary>The most energy 100 g can hold (pure fat, about 900 kcal), with room for rounding on the label.</summary>
    public const decimal MaxKcalPer100 = 950m;

    /// <summary>A serving larger than this is not a serving the editor can use.</summary>
    public const decimal MaxServingGrams = 5000m;

    /// <summary>
    /// The fields to fill, or null when the photo has no nutrition table or no energy. kcal comes from kJ when
    /// only kJ is printed. A grams value that can't fit in its basis (more than 100 g in 100 g, or more than the
    /// serving) is dropped, so the field stays empty rather than wrong.
    /// </summary>
    public static LabelFill? Fill(LabelReading reading)
    {
        if (!reading.Table)
        {
            return null;
        }

        var kcal = Positive(reading.Kcal) ?? (Positive(reading.Kj) is { } kj ? kj / KjPerKcal : null);
        var serving = Positive(reading.ServingGrams) is { } grams && grams <= MaxServingGrams ? grams : (decimal?)null;
        var perServing = reading.PerServing;
        var limit = perServing ? serving ?? decimal.MaxValue : 100m;
        var maxKcal = perServing ? (serving is { } size ? MaxKcalPer100 * size / 100m : decimal.MaxValue) : MaxKcalPer100;
        if (kcal is not { } energy || energy > maxKcal)
        {
            return null;
        }

        return new LabelFill(
            Clip(reading.Name, 200),
            Clip(reading.Brand, 80),
            perServing ? "serving" : "100g",
            Clip(reading.ServingName, 40),
            serving is { } servingGrams ? Round(servingGrams) : null,
            Round(energy, 0),
            Grams(reading.Protein, limit),
            Grams(reading.Fat, limit),
            Grams(reading.Carbs, limit),
            Grams(reading.SaturatedFat, limit),
            Grams(reading.Sugars, limit),
            Grams(reading.Fiber, limit),
            Grams(reading.Salt, limit));
    }

    private static decimal? Positive(decimal? value) => value is { } number && number > 0 ? number : null;

    private static decimal? Grams(decimal? value, decimal limit) =>
        value is { } grams && grams >= 0 && grams <= limit ? Round(grams) : null;

    private static decimal Round(decimal value, int places = 1) => Math.Round(value, places, MidpointRounding.AwayFromZero);

    private static string Clip(string value, int max)
    {
        var trimmed = (value ?? "").Trim();
        return trimmed.Length <= max ? trimmed : trimmed[..max].TrimEnd();
    }
}
