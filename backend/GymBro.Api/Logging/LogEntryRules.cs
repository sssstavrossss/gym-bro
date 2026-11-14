using System.Globalization;
using GymBro.Api.Data;
using GymBro.Api.Foods;
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

    public const string PerServingUnit = "A per-serving food is logged in servings.";

    public const string NoServing = "This food has no serving size.";

    public const string NoPiece = "This food has no piece size.";

    public const string MeasuredInGrams = "This food is measured in grams.";

    public const string KeepLoggedUnit = "Keep the unit it was logged in, or change the amount in grams.";

    public const string MeasuredInMillilitres = "This food is measured in millilitres.";

    public const string NoGramBasis = "This food has no gram weight.";

    public const string NeedServingName = "Give the serving a name.";

    public const string ServingNameLength = "Use a shorter serving name.";

    public const string ReservedServingName = "That name is already a unit. Try slice or sandwich.";

    public const string ServingGramsLimit = "Enter a weight above 0 and at most 10,000 g.";

    public const string DuplicateServing = "You already have a serving with that name.";

    public const string BadTime = "Use a time like 08:15.";

    public const int ZoneToleranceDays = 1;

    public const decimal AmountMax = 10_000m;

    public const decimal CountMax = 50m;

    public const decimal KcalMax = 10_000m;

    public const decimal MacroMax = 1_000m;

    /// <summary>A serving name is stored as the log unit, which is 16 characters.</summary>
    public const int ServingNameMax = 16;

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
        var kind = CanonicalUnit(unit);
        if (kind is null)
        {
            return NeedUnit;
        }

        var standard = NormalizeUnit(kind);
        var max = standard is null or "serving" or "piece" ? CountMax : AmountMax;
        if (amount <= 0 || amount > max)
        {
            return standard switch
            {
                "ml" => MillilitresLimit,
                "piece" => PiecesLimit,
                "g" => GramsLimit,
                _ => ServingsLimit,
            };
        }

        return null;
    }

    /// <summary>
    /// A standard unit, or a person's serving name ("slice"). Null when the text is not a unit.
    /// </summary>
    public static string? CanonicalUnit(string? unit) => NormalizeUnit(unit) ?? NormalizeServingName(unit);

    /// <summary>
    /// The serving name to store, or null when it is empty, too long, or already a unit (g, ml, serving, piece).
    /// </summary>
    public static string? NormalizeServingName(string? name)
    {
        var text = Collapse(name);
        if (text.Length is < 1 or > ServingNameMax)
        {
            return null;
        }

        if (NormalizeUnit(text) is not null)
        {
            return null;
        }

        return text;
    }

    public static string Collapse(string? name)
    {
        var text = (name ?? "").Trim();
        if (text.Length == 0)
        {
            return "";
        }

        return string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    }

    public static string MissingServing(string name) => $"No serving called “{name}”.";

    /// <summary>Why a name cannot be saved, or null when <paramref name="cleanName"/> is ready to store.</summary>
    public static string? RejectServingName(string? name, out string cleanName)
    {
        cleanName = Collapse(name);
        if (cleanName.Length == 0)
        {
            return NeedServingName;
        }

        if (cleanName.Length > ServingNameMax)
        {
            return ServingNameLength;
        }

        if (NormalizeUnit(cleanName) is not null)
        {
            return ReservedServingName;
        }

        return null;
    }

    public static string? RejectServingGrams(decimal grams) =>
        grams <= 0 || grams > AmountMax ? ServingGramsLimit : null;

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
    /// Nutrients and grams for a new log of <paramref name="food"/>.
    /// The caller stores these and does not keep the numbers the client sent.
    /// A per-serving food, a millilitre food, and an unconfirmed food logged in millilitres have no gram weight.
    /// </summary>
    public static FoodSnapshot Snapshot(Food food, decimal amount, string? unit, decimal? ownGramsEach = null)
    {
        var standard = NormalizeUnit(unit);
        var custom = standard is null ? NormalizeServingName(unit) : null;
        if (standard is null && custom is null)
        {
            return FoodSnapshot.Fail(NeedUnit);
        }

        var kind = standard ?? custom!;
        var limit = RejectAmount(amount, kind);
        if (limit is not null)
        {
            return FoodSnapshot.Fail(limit);
        }

        if (custom is not null)
        {
            if (food.NutrientBasis == NutrientBases.PerServing)
            {
                return FoodSnapshot.Fail(PerServingUnit);
            }

            if (food.Basis == "ml")
            {
                return FoodSnapshot.Fail(MeasuredInMillilitres);
            }

            if (food.NutrientBasis != NutrientBases.Per100 || food.Basis != "g")
            {
                return FoodSnapshot.Fail(NoGramBasis);
            }

            if (ownGramsEach is not > 0)
            {
                return FoodSnapshot.Fail(MissingServing(custom));
            }

            var ownGrams = Round2(amount * ownGramsEach.Value);
            if (ownGrams is not > 0)
            {
                return FoodSnapshot.Fail(GramsLimit);
            }

            var ownFactor = ownGrams / 100m;
            return new FoodSnapshot(
                custom,
                ownGrams,
                Scale(food.KcalPer100, ownFactor),
                Scale(food.ProteinPer100, ownFactor),
                Scale(food.FatPer100, ownFactor),
                Scale(food.CarbsPer100, ownFactor),
                null).With(food, ownFactor);
        }

        // Kassalapp never stated grams or millilitres. The unit on this entry is the one to scale by.
        if (food.NutrientBasis == NutrientBases.Unconfirmed && kind == "ml")
        {
            var unconfirmedFactor = amount / 100m;
            return new FoodSnapshot(
                kind,
                null,
                Scale(food.KcalPer100, unconfirmedFactor),
                Scale(food.ProteinPer100, unconfirmedFactor),
                Scale(food.FatPer100, unconfirmedFactor),
                Scale(food.CarbsPer100, unconfirmedFactor),
                null).With(food, unconfirmedFactor);
        }

        var basis = food.Basis;
        if (food.NutrientBasis == NutrientBases.PerServing)
        {
            if (kind != "serving")
            {
                return FoodSnapshot.Fail(PerServingUnit);
            }

            return new FoodSnapshot(kind, null, Scale(food.KcalPer100, amount), Scale(food.ProteinPer100, amount), Scale(food.FatPer100, amount), Scale(food.CarbsPer100, amount), null).With(food, amount);
        }

        if (basis == "ml")
        {
            if (kind != "ml")
            {
                return FoodSnapshot.Fail(MeasuredInMillilitres);
            }

            var factor = amount / 100m;
            return new FoodSnapshot(
                kind,
                null,
                Scale(food.KcalPer100, factor),
                Scale(food.ProteinPer100, factor),
                Scale(food.FatPer100, factor),
                Scale(food.CarbsPer100, factor),
                null).With(food, factor);
        }

        if (kind == "ml")
        {
            return FoodSnapshot.Fail(MeasuredInGrams);
        }

        decimal? grams;
        if (kind == "serving")
        {
            if (food.ServingQuantity is not > 0)
            {
                return FoodSnapshot.Fail(NoServing);
            }

            grams = Round2(amount * food.ServingQuantity.Value);
        }
        else if (kind == "piece")
        {
            if (food.PieceQuantity is not > 0)
            {
                return FoodSnapshot.Fail(NoPiece);
            }

            grams = Round2(amount * food.PieceQuantity.Value);
        }
        else
        {
            grams = Round2(amount);
        }

        if (grams is not > 0)
        {
            return FoodSnapshot.Fail(kind == "ml" ? MillilitresLimit : GramsLimit);
        }

        var perGram = grams.Value / 100m;
        return new FoodSnapshot(
            kind,
            grams,
            Scale(food.KcalPer100, perGram),
            Scale(food.ProteinPer100, perGram),
            Scale(food.FatPer100, perGram),
            Scale(food.CarbsPer100, perGram),
            null).With(food, perGram);
    }

    /// <summary>
    /// Amount or unit edit. Scales the entry's stored kcal and grams.
    /// A gram size comes from <see cref="LogEntry.Grams"/> divided by the logged amount, never from the food's current serving.
    /// </summary>
    public static StoredScale ScaleStored(LogEntry entry, decimal newAmount, string? newUnit)
    {
        var kind = CanonicalUnit(newUnit);
        if (kind is null)
        {
            return StoredScale.Fail(NeedUnit);
        }

        var limit = RejectAmount(newAmount, kind);
        if (limit is not null)
        {
            return StoredScale.Fail(limit);
        }

        var oldKind = CanonicalUnit(entry.Unit);
        var standard = NormalizeUnit(kind);
        decimal factor;
        decimal? grams;
        if (entry.Grams is > 0 && standard is "g" or "ml" && !SameUnit(kind, oldKind))
        {
            grams = Round2(newAmount);
            factor = grams.Value / entry.Grams.Value;
        }
        else if (entry.Grams is > 0 && IsCount(kind) && IsMeasure(oldKind))
        {
            return StoredScale.Fail(KeepLoggedUnit);
        }
        else if (entry.Grams is > 0 && IsCount(kind) && IsCount(oldKind) && !SameUnit(kind, oldKind))
        {
            return StoredScale.Fail(KeepLoggedUnit);
        }
        else
        {
            if (entry.Amount == 0)
            {
                return StoredScale.Fail("This entry has no amount to scale.");
            }

            factor = newAmount / entry.Amount;
            grams = entry.Grams is decimal stored ? Round2(stored * factor) : null;
        }

        if (entry.Source == QuickSource)
        {
            grams = null;
        }

        return new StoredScale(
            Round2(entry.Kcal * factor),
            Round2(entry.Protein * factor),
            Round2(entry.Fat * factor),
            Round2(entry.Carbs * factor),
            grams,
            null)
        {
            SaturatedFat = Micronutrients.Scale(entry.SaturatedFat, factor),
            Sugars = Micronutrients.Scale(entry.Sugars, factor),
            Fiber = Micronutrients.Scale(entry.Fiber, factor),
            Salt = Micronutrients.Scale(entry.Salt, factor),
        };
    }

    private static decimal Scale(decimal per, decimal factor) => Round2(per * factor);

    private static bool IsMeasure(string? unit) => unit is "g" or "ml";

    private static bool IsCount(string? unit) =>
        unit is "serving" or "piece" || (unit is not null && NormalizeUnit(unit) is null);

    private static bool SameUnit(string? left, string? right) =>
        string.Equals(left, right, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Quick add has no gram weight (decision 29). A per-serving food doesn't either.
    /// Millilitres are a volume, so the gram weight stays empty. A serving or piece uses the gram size stored
    /// on the food, and stays null when that food has no gram weight.
    /// </summary>
    public static decimal? GramsFor(string? source, string unit, decimal amount, Food? food)
    {
        if (source == QuickSource || food?.NutrientBasis == NutrientBases.PerServing)
        {
            return null;
        }

        var kind = NormalizeUnit(unit);
        if (kind == "ml")
        {
            return null;
        }

        if (kind == "g")
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

public readonly record struct FoodSnapshot(
    string Unit,
    decimal? Grams,
    decimal Kcal,
    decimal Protein,
    decimal Fat,
    decimal Carbs,
    string? Error)
{
    public decimal? SaturatedFat { get; init; }

    public decimal? Sugars { get; init; }

    public decimal? Fiber { get; init; }

    public decimal? Salt { get; init; }

    public static FoodSnapshot Fail(string error) => new("", null, 0, 0, 0, 0, error);

    public FoodSnapshot With(Food food, decimal factor) => this with
    {
        SaturatedFat = Micronutrients.Scale(food.SaturatedFatPer100, factor),
        Sugars = Micronutrients.Scale(food.SugarsPer100, factor),
        Fiber = Micronutrients.Scale(food.FiberPer100, factor),
        Salt = Micronutrients.Scale(food.SaltPer100, factor),
    };
}

public readonly record struct StoredScale(
    decimal Kcal,
    decimal Protein,
    decimal Fat,
    decimal Carbs,
    decimal? Grams,
    string? Error)
{
    public decimal? SaturatedFat { get; init; }

    public decimal? Sugars { get; init; }

    public decimal? Fiber { get; init; }

    public decimal? Salt { get; init; }

    public static StoredScale Fail(string error) => new(0, 0, 0, 0, null, error);
}
