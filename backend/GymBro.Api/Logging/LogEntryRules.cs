using System.Globalization;
using GymBro.Api.Data;
using GymBro.Api.Nutrition;
using GymBro.Api.Profiles;

namespace GymBro.Api.Logging;

/// <summary>
/// Server-side food-log rules for quick add and later slices.
/// Dates are civil dates. The window is decision 36, checked in the client's
/// IANA zone with a one-day tolerance against the server's UTC date (decision 48).
/// </summary>
public static class LogEntryRules
{
    public const string QuickSource = "quick";

    public const string UnknownZone = "Use a time zone like Europe/Oslo.";

    public const string FutureDate = "That date is in the future.";

    public const string BeforeSetup = "That date is before you set up Gym Bro.";

    public const string NeedProfile = "Save your profile before logging food.";

    public const string BadDate = "Use a date like 2026-10-24.";

    public const string BadNumber = "Enter a number, using a comma or a point.";

    public const string NeedKey = "Add an idempotency key.";

    public const string KcalLimit = "Calories should be from 0 to 10,000.";

    public const string ProteinLimit = "Protein should be from 0 to 1,000 g.";

    public const string FatLimit = "Fat should be from 0 to 1,000 g.";

    public const string CarbsLimit = "Carbs should be from 0 to 1,000 g.";

    public const string GramsLimit = "Enter an amount above 0 and at most 10,000 g.";

    public const string MillilitresLimit = "Enter an amount above 0 and at most 10,000 ml.";

    public const string ServingsLimit = "Enter an amount above 0 and at most 50 servings.";

    public const string PiecesLimit = "Enter an amount above 0 and at most 50 pieces.";

    public const string NeedUnit = "Choose grams, ml, a serving or a piece.";

    public const string BadTime = "Use a time like 08:15.";

    public const int ZoneToleranceDays = 1;

    public const decimal AmountMax = 10_000m;

    public const decimal CountMax = 50m;

    public const decimal KcalMax = 10_000m;

    public const decimal MacroMax = 1_000m;

    public static bool TryDate(string? text, out DateOnly date) =>
        DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    public static bool TryTime(string? text, out TimeOnly time)
    {
        time = default;
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        return TimeOnly.TryParseExact(text.Trim(), "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out time);
    }

    public static bool TryFlexible(System.Text.Json.JsonElement element, out decimal value)
    {
        value = 0;
        if (element.ValueKind == System.Text.Json.JsonValueKind.Number)
        {
            return element.TryGetDecimal(out value);
        }

        if (element.ValueKind == System.Text.Json.JsonValueKind.String)
        {
            return DecimalInput.TryParse(element.GetString(), out value);
        }

        return false;
    }

    /// <summary>
    /// Latest civil date the client may log. The client's today is accepted even
    /// when it is one day after the server's UTC date. Two days after is not.
    /// </summary>
    public static string? RejectZone(string? timeZoneId, TimeProvider clock, out TimeZoneInfo zone, out DateOnly clientToday, out DateOnly serverToday)
    {
        serverToday = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        if (!LocalDates.TryZone(timeZoneId, out zone))
        {
            clientToday = default;
            return UnknownZone;
        }

        var local = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone);
        clientToday = DateOnly.FromDateTime(local.DateTime);
        if (Math.Abs(clientToday.DayNumber - serverToday.DayNumber) > ZoneToleranceDays)
        {
            return UnknownZone;
        }

        return null;
    }

    public static string? RejectDate(DateOnly localDate, DateOnly setupDate, DateOnly clientToday, DateOnly serverToday)
    {
        if (localDate > clientToday || localDate.DayNumber - serverToday.DayNumber > ZoneToleranceDays)
        {
            return FutureDate;
        }

        if (localDate < setupDate)
        {
            return BeforeSetup;
        }

        return null;
    }

    public static DateOnly SetupDate(DateTimeOffset createdAt, TimeZoneInfo zone)
    {
        var local = TimeZoneInfo.ConvertTime(createdAt, zone);
        return DateOnly.FromDateTime(local.DateTime);
    }

    public static string? RejectNutrients(decimal kcal, decimal protein, decimal fat, decimal carbs)
    {
        if (kcal < 0 || kcal > KcalMax)
        {
            return KcalLimit;
        }

        if (protein < 0 || protein > MacroMax)
        {
            return ProteinLimit;
        }

        if (fat < 0 || fat > MacroMax)
        {
            return FatLimit;
        }

        if (carbs < 0 || carbs > MacroMax)
        {
            return CarbsLimit;
        }

        return null;
    }

    public static string? RejectAmount(decimal amount, string unit)
    {
        var kind = NormalizeUnit(unit);
        if (kind is null)
        {
            return NeedUnit;
        }

        var max = kind is "serving" or "piece" ? CountMax : AmountMax;
        if (amount <= 0 || amount > max)
        {
            return kind switch
            {
                "ml" => MillilitresLimit,
                "serving" => ServingsLimit,
                "piece" => PiecesLimit,
                _ => GramsLimit,
            };
        }

        return null;
    }

    /// <summary><c>g</c>, <c>ml</c>, <c>serving</c>, <c>piece</c>, or null when the unit is unknown.</summary>
    public static string? NormalizeUnit(string? unit)
    {
        var text = (unit ?? "").Trim().ToLowerInvariant();
        return text switch
        {
            "g" or "gram" or "grams" => "g",
            "ml" or "millilitre" or "millilitres" or "milliliter" or "milliliters" => "ml",
            "serving" or "servings" => "serving",
            "piece" or "pieces" => "piece",
            _ => null,
        };
    }

    public static decimal Round2(decimal value) =>
        decimal.Round(value, 2, MidpointRounding.AwayFromZero);

    /// <summary>
    /// Quick add has no gram weight (decision 29). A per-serving food doesn't either.
    /// Grams and ml store the amount. A serving or piece uses the gram size stored
    /// on the food, and stays null when that food has no gram weight.
    /// </summary>
    public static decimal? GramsFor(string? source, string unit, decimal amount, Food? food)
    {
        if (source == QuickSource || food?.NutrientBasis == NutrientBases.PerServing)
        {
            return null;
        }

        var kind = NormalizeUnit(unit);
        if (kind is "g" or "ml")
        {
            return Round2(amount);
        }

        if (food is null || kind is null)
        {
            return null;
        }

        var each = kind == "piece" ? food.PieceQuantity : food.ServingQuantity;
        if (each is not > 0)
        {
            return null;
        }

        return Round2(amount * each.Value);
    }

    public static DateTime LocalTimestamp(DateOnly date, TimeOnly time) =>
        DateTime.SpecifyKind(date.ToDateTime(time), DateTimeKind.Unspecified);

    public static TimeOnly NowIn(TimeZoneInfo zone, TimeProvider clock)
    {
        var local = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime;
        return new TimeOnly(local.Hour, local.Minute);
    }
}
