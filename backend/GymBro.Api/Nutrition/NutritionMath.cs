namespace GymBro.Api.Nutrition;

public static class ActivityLevels
{
    public const string Sedentary = "sedentary";
    public const string Light = "light";
    public const string Moderate = "moderate";
    public const string VeryActive = "very_active";
    public const string Athlete = "athlete";
}

public static class Goals
{
    public const string Lose = "lose";
    public const string Maintain = "maintain";
    public const string Gain = "gain";
}

public static class Sexes
{
    public const string Male = "male";
    public const string Female = "female";
}

public static class MacroSettings
{
    public const string Less = "less";
    public const string Normal = "normal";
    public const string More = "more";
    public const string Exact = "exact";
}

public static class TargetReasons
{
    public const string ProfileChange = "profile_change";
    public const string MacroBalanceChange = "macro_balance_change";
    public const string WeeklyRecalculation = "weekly_recalculation";
    public const string FreshStart = "fresh_start";
}

public sealed record NutritionInput(
    string Sex,
    decimal WeightKg,
    decimal HeightCm,
    int Age,
    string Activity,
    string Goal,
    decimal RateKgPerWeek,
    decimal ProteinGramsPerKg,
    decimal FatPercent);

public sealed record NutritionResult(
    int Bmr,
    int Tdee,
    int Kcal,
    int Protein,
    int Fat,
    int Carbs,
    bool FloorApplied);

/// <summary>
/// Mifflin-St Jeor, activity factors, the rate-based calorie target, macro
/// balance, and the calorie floor. Integers use half-away-from-zero rounding.
/// Carbs are whatever kilocalories remain after protein and fat, and never go below 0.
/// </summary>
public static class NutritionMath
{
    public const decimal KcalPerKg = 7700m;

    public const decimal ProteinLess = 1.6m;
    public const decimal ProteinNormal = 2.0m;
    public const decimal ProteinMore = 2.4m;
    public const decimal ProteinExactMin = 1.2m;
    public const decimal ProteinExactMax = 3.0m;
    public const decimal ProteinExactStep = 0.1m;

    public const decimal FatLess = 20m;
    public const decimal FatNormal = 25m;
    public const decimal FatMore = 30m;
    public const decimal FatExactMin = 15m;
    public const decimal FatExactMax = 40m;
    public const decimal FatExactStep = 5m;

    public static readonly IReadOnlyDictionary<string, decimal> ActivityFactors =
        new Dictionary<string, decimal>(StringComparer.Ordinal)
        {
            [ActivityLevels.Sedentary] = 1.2m,
            [ActivityLevels.Light] = 1.375m,
            [ActivityLevels.Moderate] = 1.55m,
            [ActivityLevels.VeryActive] = 1.725m,
            [ActivityLevels.Athlete] = 1.9m,
        };

    public static int Round(decimal value) =>
        (int)decimal.Round(value, 0, MidpointRounding.AwayFromZero);

    public static bool AtMostOneDecimal(decimal value) =>
        value == decimal.Round(value, 1, MidpointRounding.AwayFromZero);

    public static bool IsStep(decimal value, decimal step)
    {
        if (step <= 0)
        {
            return false;
        }

        var scaled = value / step;
        return scaled == decimal.Truncate(scaled);
    }

    public static bool ProteinMatches(string? setting, decimal gramsPerKg) => setting switch
    {
        MacroSettings.Less => gramsPerKg == ProteinLess,
        MacroSettings.Normal => gramsPerKg == ProteinNormal,
        MacroSettings.More => gramsPerKg == ProteinMore,
        MacroSettings.Exact => gramsPerKg >= ProteinExactMin
            && gramsPerKg <= ProteinExactMax
            && IsStep(gramsPerKg, ProteinExactStep),
        _ => false,
    };

    public static bool FatMatches(string? setting, decimal percent) => setting switch
    {
        MacroSettings.Less => percent == FatLess,
        MacroSettings.Normal => percent == FatNormal,
        MacroSettings.More => percent == FatMore,
        MacroSettings.Exact => percent >= FatExactMin
            && percent <= FatExactMax
            && IsStep(percent, FatExactStep),
        _ => false,
    };

    public static NutritionResult Calculate(NutritionInput input)
    {
        if (!ActivityFactors.TryGetValue(input.Activity, out var factor))
        {
            throw new ArgumentException("Unknown activity.", nameof(input));
        }

        var sexOffset = input.Sex == Sexes.Male ? 5m : -161m;
        var bmrExact = 10m * input.WeightKg
            + 6.25m * input.HeightCm
            - 5m * input.Age
            + sexOffset;
        var bmr = Round(bmrExact);
        var tdee = Round(bmr * factor);

        var perDay = input.RateKgPerWeek * KcalPerKg / 7m;
        var delta = input.Goal switch
        {
            Goals.Lose => -perDay,
            Goals.Gain => perDay,
            _ => 0m,
        };
        var raw = tdee + delta;
        var floorApplied = raw < bmr;
        var kcal = floorApplied ? bmr : Round(raw);

        var proteinExact = input.ProteinGramsPerKg * input.WeightKg;
        var protein = Round(proteinExact);
        var fatKcal = kcal * (input.FatPercent / 100m);
        var fat = Round(fatKcal / 9m);
        var carbExact = (kcal - proteinExact * 4m - fatKcal) / 4m;
        var carbs = Math.Max(0, Round(carbExact));

        return new NutritionResult(bmr, tdee, kcal, protein, fat, carbs, floorApplied);
    }
}
