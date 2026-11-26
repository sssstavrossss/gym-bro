using System.Globalization;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Nutrition;

namespace GymBro.Api.Profiles;

/// <summary>
/// What the target history shows when a row is opened. A recalculation keeps how
/// its burn was measured; a profile change keeps which fields changed. Stored as
/// JSON on <see cref="TargetHistory.Details"/>.
/// </summary>
public sealed record TargetDetails(RecalculationDetails? Recalculation, IReadOnlyList<ProfileChange>? Changes)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static string? Serialize(TargetDetails? details) =>
        details is null ? null : JsonSerializer.Serialize(details, Json);

    public static TargetDetails? Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<TargetDetails>(json, Json);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>A second save on the same day keeps the first one's measurement and adds its own changes.</summary>
    public static TargetDetails? Merge(TargetDetails? existing, TargetDetails? added)
    {
        if (existing is null || added is null)
        {
            return added ?? existing;
        }

        var changes = (existing.Changes ?? []).Concat(added.Changes ?? []).ToList();
        return new TargetDetails(added.Recalculation ?? existing.Recalculation, changes.Count == 0 ? null : changes);
    }

    public static TargetDetails From(AdaptiveReview review)
    {
        var window = review.Window;
        var step = review.Step;
        var shown = BurnReadings.Stretches(window.Readings);
        return new(
            new RecalculationDetails(
                review.From,
                review.To,
                review.PeriodDays,
                review.IncludedDays,
                review.LowDays.Count,
                review.LowDays.Count(day => day.Included),
                review.Measured,
                window.WeighIns,
                review.Fit is { } fit ? decimal.Round(fit.RateKgPerWeek, 2, MidpointRounding.AwayFromZero) : null,
                review.AverageKcal is decimal eaten ? NutritionMath.Round(eaten) : null,
                Round(window.Burn),
                Round(window.Sd),
                step is null ? null : NutritionMath.Round(step.Prior),
                step is null ? null : NutritionMath.Round(step.Gain * 100m),
                shown.Count,
                shown.Count(reading => !reading.Sure),
                window.Tier.ToString().ToLowerInvariant(),
                review.Burn,
                review.BurnSdKcal,
                step is null ? null : NutritionMath.Round(step.Cap),
                step?.Capped,
                review.Formula.Tdee,
                review.FarShare is not null),
            null);
    }

    private static int? Round(decimal? value) => value is decimal number ? NutritionMath.Round(number) : null;
}

/// <summary>
/// How a recalculation measured the burn. Rows saved before the rolling readings lack the
/// fields after <see cref="StepPercent"/>; they read as null.
/// </summary>
public sealed record RecalculationDetails(
    DateOnly From,
    DateOnly To,
    int PeriodDays,
    int CountedDays,
    int LowDays,
    int LowCounted,
    bool Measured,
    int WeighIns,
    decimal? RateKgPerWeek,
    int? AverageKcal,
    int? MeasuredBurn,
    int? MeasuredSd,
    int? PriorBurn,
    int? StepPercent,
    int? Readings = null,
    int? LessSure = null,
    string? Tier = null,
    int? Burn = null,
    int? BurnSd = null,
    int? CapKcal = null,
    bool? Capped = null,
    int? FormulaBurn = null,
    bool? Far = null);

/// <summary>One profile field that changed. Values are invariant text in stored units (kg, cm, g/kg, %).</summary>
public sealed record ProfileChange(string Field, string From, string To)
{
    public static IReadOnlyList<ProfileChange> Between(Profile before, NormalizedProfile next)
    {
        var changes = new List<ProfileChange>();
        void Add(string field, string from, string to)
        {
            if (from != to)
            {
                changes.Add(new ProfileChange(field, from, to));
            }
        }

        Add("sex", before.Sex, next.Sex);
        Add("birthYear", Text(before.BirthYear), Text(next.BirthYear));
        Add("heightCm", Text(before.HeightCm), Text(next.HeightCm));
        Add("activity", before.Activity, next.Activity);
        Add("goal", before.Goal, next.Goal);
        Add("rateKgPerWeek", Text(before.RateKgPerWeek ?? 0), Text(next.RateKgPerWeek ?? 0));
        Add("goalWeightKg", Text(before.GoalWeightKg), Text(next.GoalWeightKg));
        Add("proteinGramsPerKg", Text(before.ProteinGramsPerKg), Text(next.ProteinGramsPerKg));
        Add("fatPercent", Text(before.FatPercent), Text(next.FatPercent));
        return changes;
    }

    private static string Text(decimal value) => value.ToString("0.##", CultureInfo.InvariantCulture);

    private static string Text(int value) => value.ToString(CultureInfo.InvariantCulture);
}

/// <summary>The burn a target row stores next to its numbers.</summary>
public sealed record TargetBurn(int FormulaTdee, int BurnSdKcal, TargetDetails? Details)
{
    /// <summary>A plain formula row: the burn is the formula, with the formula's spread.</summary>
    public static TargetBurn Formula(NutritionResult result, TargetDetails? details = null) =>
        new(result.Tdee, NutritionMath.Round(BurnEstimate.FormulaSdKcal), details);
}
