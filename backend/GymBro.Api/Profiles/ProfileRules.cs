using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using GymBro.Api.Data;
using GymBro.Api.Nutrition;

namespace GymBro.Api.Profiles;

public sealed record NormalizedProfile(
    string Sex,
    int BirthYear,
    decimal HeightCm,
    string Activity,
    string Goal,
    decimal? RateKgPerWeek,
    decimal GoalWeightKg,
    string ProteinSetting,
    decimal ProteinGramsPerKg,
    string FatSetting,
    decimal FatPercent,
    string TimeZone);

public sealed class ProfileRequest
{
    public string? Sex { get; set; }

    public int BirthYear { get; set; }

    [JsonConverter(typeof(FlexibleDecimalConverter))]
    public decimal HeightCm { get; set; }

    public string? Activity { get; set; }

    public string? Goal { get; set; }

    [JsonConverter(typeof(FlexibleNullableDecimalConverter))]
    public decimal? RateKgPerWeek { get; set; }

    [JsonConverter(typeof(FlexibleDecimalConverter))]
    public decimal GoalWeightKg { get; set; }

    public string? ProteinSetting { get; set; }

    [JsonConverter(typeof(FlexibleDecimalConverter))]
    public decimal ProteinGramsPerKg { get; set; }

    public string? FatSetting { get; set; }

    [JsonConverter(typeof(FlexibleDecimalConverter))]
    public decimal FatPercent { get; set; }

    public string? TimeZone { get; set; }
}

public static class ProfileRules
{
    public const string ProteinError =
        "Protein should be 1.6, 2.0, or 2.4 g/kg, or an exact value from 1.2 to 3.0 in steps of 0.1.";

    public const string FatError =
        "Fat should be 20, 25, or 30 percent, or an exact value from 15 to 40 in steps of 5.";

    public static string? Validate(ProfileRequest request, int year, out NormalizedProfile profile)
    {
        profile = null!;
        var sex = Lower(request.Sex);
        if (sex is not (Sexes.Male or Sexes.Female))
        {
            return "Choose male or female.";
        }

        if (request.BirthYear < year - 100 || request.BirthYear > year - 13)
        {
            return "Enter a birth year that makes you between 13 and 100.";
        }

        if (request.HeightCm == 0)
        {
            return "Enter your height in centimetres.";
        }

        if (!NutritionMath.AtMostOneDecimal(request.HeightCm) || request.HeightCm < 100 || request.HeightCm > 250)
        {
            return "Height should be between 100 and 250 cm, with at most one decimal.";
        }

        var activity = Lower(request.Activity).Replace(' ', '_');
        if (activity == "very")
        {
            activity = ActivityLevels.VeryActive;
        }

        if (!NutritionMath.ActivityFactors.ContainsKey(activity))
        {
            return "Choose an activity level.";
        }

        var goal = Lower(request.Goal);
        if (goal is not (Goals.Lose or Goals.Maintain or Goals.Gain))
        {
            return "Choose lose, maintain, or gain.";
        }

        decimal? rate = null;
        if (goal != Goals.Maintain)
        {
            if (request.RateKgPerWeek is not decimal rawRate)
            {
                return "Choose a rate of 0.25, 0.5, 0.75, or 1.0 kg per week.";
            }

            rate = decimal.Round(rawRate, 2, MidpointRounding.AwayFromZero);
            if (rate is not (0.25m or 0.50m or 0.75m or 1.00m))
            {
                return "Choose a rate of 0.25, 0.5, 0.75, or 1.0 kg per week.";
            }
        }

        if (request.GoalWeightKg == 0)
        {
            return "Enter a goal weight.";
        }

        if (!NutritionMath.AtMostOneDecimal(request.GoalWeightKg) || request.GoalWeightKg < 30 || request.GoalWeightKg > 300)
        {
            return "Goal weight should be between 30 and 300 kg, with one decimal.";
        }

        var proteinSetting = Lower(request.ProteinSetting);
        var protein = request.ProteinGramsPerKg;
        if (proteinSetting.Length == 0 && protein == 0)
        {
            proteinSetting = MacroSettings.Normal;
            protein = NutritionMath.ProteinNormal;
        }

        if (!NutritionMath.ProteinMatches(proteinSetting, protein))
        {
            return ProteinError;
        }

        var fatSetting = Lower(request.FatSetting);
        var fat = request.FatPercent;
        if (fatSetting.Length == 0 && fat == 0)
        {
            fatSetting = MacroSettings.Normal;
            fat = NutritionMath.FatNormal;
        }

        if (!NutritionMath.FatMatches(fatSetting, fat))
        {
            return FatError;
        }

        var timeZone = request.TimeZone?.Trim() ?? "";
        if (!LocalDates.TryZone(timeZone, out _))
        {
            return "Choose a time zone.";
        }

        profile = new NormalizedProfile(
            sex,
            request.BirthYear,
            request.HeightCm,
            activity,
            goal,
            rate,
            request.GoalWeightKg,
            proteinSetting,
            protein,
            fatSetting,
            fat,
            timeZone);
        return null;
    }

    public static bool Matches(Profile profile, NormalizedProfile next) =>
        profile.Sex == next.Sex
        && profile.BirthYear == next.BirthYear
        && profile.HeightCm == next.HeightCm
        && profile.Activity == next.Activity
        && profile.Goal == next.Goal
        && profile.RateKgPerWeek == next.RateKgPerWeek
        && profile.GoalWeightKg == next.GoalWeightKg
        && profile.ProteinSetting == next.ProteinSetting
        && profile.ProteinGramsPerKg == next.ProteinGramsPerKg
        && profile.FatSetting == next.FatSetting
        && profile.FatPercent == next.FatPercent
        && profile.TimeZone == next.TimeZone;

    public static string ReasonFor(Profile? before, NormalizedProfile next)
    {
        if (before is null || !MacroOnly(before, next))
        {
            return TargetReasons.ProfileChange;
        }

        return TargetReasons.MacroBalanceChange;
    }

    public static void Apply(Profile profile, NormalizedProfile next)
    {
        profile.Sex = next.Sex;
        profile.BirthYear = next.BirthYear;
        profile.HeightCm = next.HeightCm;
        profile.Activity = next.Activity;
        profile.Goal = next.Goal;
        profile.RateKgPerWeek = next.RateKgPerWeek;
        profile.GoalWeightKg = next.GoalWeightKg;
        profile.ProteinSetting = next.ProteinSetting;
        profile.ProteinGramsPerKg = next.ProteinGramsPerKg;
        profile.FatSetting = next.FatSetting;
        profile.FatPercent = next.FatPercent;
        profile.TimeZone = next.TimeZone;
    }

    public static NutritionInput ToInput(NormalizedProfile profile, decimal weightKg, int year) => new(
        profile.Sex,
        weightKg,
        profile.HeightCm,
        year - profile.BirthYear,
        profile.Activity,
        profile.Goal,
        profile.RateKgPerWeek ?? 0,
        profile.ProteinGramsPerKg,
        profile.FatPercent);

    public static NutritionInput ToInput(Profile profile, decimal weightKg, int year) => new(
        profile.Sex,
        weightKg,
        profile.HeightCm,
        year - profile.BirthYear,
        profile.Activity,
        profile.Goal,
        profile.RateKgPerWeek ?? 0,
        profile.ProteinGramsPerKg,
        profile.FatPercent);

    private static bool MacroOnly(Profile before, NormalizedProfile next)
    {
        var bodySame = before.Sex == next.Sex
            && before.BirthYear == next.BirthYear
            && before.HeightCm == next.HeightCm
            && before.Activity == next.Activity
            && before.Goal == next.Goal
            && before.RateKgPerWeek == next.RateKgPerWeek
            && before.GoalWeightKg == next.GoalWeightKg
            && before.TimeZone == next.TimeZone;
        var macroChanged = before.ProteinSetting != next.ProteinSetting
            || before.ProteinGramsPerKg != next.ProteinGramsPerKg
            || before.FatSetting != next.FatSetting
            || before.FatPercent != next.FatPercent;
        return bodySame && macroChanged;
    }

    private static string Lower(string? value) => (value ?? "").Trim().ToLowerInvariant();
}

public static class DecimalInput
{
    public static bool TryParse(string? text, out decimal value)
    {
        value = 0;
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        var cleaned = text.Trim().Replace(',', '.');
        return decimal.TryParse(cleaned, NumberStyles.Number, CultureInfo.InvariantCulture, out value);
    }
}

public sealed class FlexibleDecimalConverter : JsonConverter<decimal>
{
    public override decimal Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Number && reader.TryGetDecimal(out var number))
        {
            return number;
        }

        if (reader.TokenType == JsonTokenType.String && DecimalInput.TryParse(reader.GetString(), out var parsed))
        {
            return parsed;
        }

        throw new JsonException("Enter a number, using a comma or a point.");
    }

    public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options) =>
        writer.WriteNumberValue(value);
}

public sealed class FlexibleNullableDecimalConverter : JsonConverter<decimal?>
{
    public override decimal? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }

        if (reader.TokenType == JsonTokenType.String)
        {
            var text = reader.GetString();
            if (string.IsNullOrWhiteSpace(text))
            {
                return null;
            }

            if (DecimalInput.TryParse(text, out var parsed))
            {
                return parsed;
            }

            throw new JsonException("Enter a number, using a comma or a point.");
        }

        if (reader.TokenType == JsonTokenType.Number && reader.TryGetDecimal(out var number))
        {
            return number;
        }

        throw new JsonException("Enter a number, using a comma or a point.");
    }

    public override void Write(Utf8JsonWriter writer, decimal? value, JsonSerializerOptions options)
    {
        if (value is null)
        {
            writer.WriteNullValue();
            return;
        }

        writer.WriteNumberValue(value.Value);
    }
}
