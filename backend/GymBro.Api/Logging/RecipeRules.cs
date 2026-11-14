using GymBro.Api.Data;
using GymBro.Api.Foods;

namespace GymBro.Api.Logging;

/// <summary>
/// Recipe nutrition is the sum of each ingredient on that food's own basis.
/// Per portion is that sum times one divided by the portion count.
/// Grams logging is that sum times the eaten grams divided by the finished weight.
/// Nothing here converts grams to millilitres or invents a density.
/// </summary>
public static class RecipeRules
{
    public const string Source = "recipe";

    public const string PortionUnit = "portion";

    public const decimal PortionsMax = 1000m;

    public const decimal FinishedMax = 100_000m;

    /// <summary>Largest nutrient value that fits in numeric(8,2).</summary>
    public const decimal NutrientMax = 999_999.99m;

    public const int NameMax = 120;

    public const int MaxIngredients = 100;

    public const string NeedName = "Give the recipe a name.";

    public const string NameLength = "Use a shorter name.";

    public const string PortionsLimit = "Enter portions above 0 and at most 1,000.";

    public const string FinishedLimit = "Enter a finished weight above 0 and at most 100,000 g.";

    public const string NeedIngredient = "Add at least one food.";

    public const string TooMany = "Save up to 100 ingredients.";

    public const string NeedFood = "Choose a food.";

    public const string MissingFood = "No food with that id.";

    public const string FoodRetired = "That food is no longer available.";

    public const string KeepAmount = "That food is no longer available. Remove it, or keep the saved amount and unit.";

    public const string TooLarge = "That recipe is too large to store.";

    public const string LogTooLarge = "That amount is too large to log.";

    public const string NoFinishedWeight = "This recipe has no finished weight, so it can't be logged in grams.";

    public const string PortionAmountLimit = "Enter an amount above 0 and at most 50 portions.";

    public const string NeedUnit = "Choose portions, or grams when the recipe has a finished weight.";

    public const string PickTime = "Pick a time.";

    public const string MissingRecipe = "No recipe with that id.";

    public readonly record struct Totals(
        decimal Kcal,
        decimal Protein,
        decimal Fat,
        decimal Carbs,
        decimal? SaturatedFat = null,
        decimal? Sugars = null,
        decimal? Fiber = null,
        decimal? Salt = null);

    public static string? RejectName(string? raw, out string name)
    {
        name = LogEntryRules.Collapse(raw);
        if (name.Length == 0)
        {
            return NeedName;
        }

        return name.Length > NameMax ? NameLength : null;
    }

    public static string? RejectPortions(decimal portions) =>
        portions <= 0 || portions > PortionsMax ? PortionsLimit : null;

    public static string? RejectFinished(decimal? grams)
    {
        if (grams is null)
        {
            return null;
        }

        return grams is <= 0 or > FinishedMax ? FinishedLimit : null;
    }

    public static Totals? Sum(IEnumerable<Totals> rows)
    {
        decimal kcal = 0;
        decimal protein = 0;
        decimal fat = 0;
        decimal carbs = 0;
        var saturated = new List<decimal?>();
        var sugars = new List<decimal?>();
        var fiber = new List<decimal?>();
        var salt = new List<decimal?>();
        foreach (var row in rows)
        {
            if (!TryAdd(kcal, row.Kcal, out kcal)
                || !TryAdd(protein, row.Protein, out protein)
                || !TryAdd(fat, row.Fat, out fat)
                || !TryAdd(carbs, row.Carbs, out carbs))
            {
                return null;
            }

            saturated.Add(row.SaturatedFat);
            sugars.Add(row.Sugars);
            fiber.Add(row.Fiber);
            salt.Add(row.Salt);
        }

        return new Totals(
            LogEntryRules.Round2(kcal),
            LogEntryRules.Round2(protein),
            LogEntryRules.Round2(fat),
            LogEntryRules.Round2(carbs),
            Micronutrients.CompleteSum(saturated),
            Micronutrients.CompleteSum(sugars),
            Micronutrients.CompleteSum(fiber),
            Micronutrients.CompleteSum(salt));
    }

    /// <summary>One portion of a saved recipe. Same factor the log uses for a single portion.</summary>
    public static Totals PerPortion(Totals total, decimal portions) => Share(total, 1m / portions);

    /// <summary>One gram of finished weight. Null when the recipe has no finished weight.</summary>
    public static Totals? PerGram(Totals total, decimal? finishedGrams)
    {
        if (finishedGrams is not > 0)
        {
            return null;
        }

        return TryShare(total, 1m / finishedGrams.Value, out var shared) ? shared : null;
    }

    public static Totals Share(Totals total, decimal factor) =>
        new(
            Scale(total.Kcal, factor),
            Scale(total.Protein, factor),
            Scale(total.Fat, factor),
            Scale(total.Carbs, factor),
            Micronutrients.Scale(total.SaturatedFat, factor),
            Micronutrients.Scale(total.Sugars, factor),
            Micronutrients.Scale(total.Fiber, factor),
            Micronutrients.Scale(total.Salt, factor));

    public enum LogMode
    {
        Portion,
        Grams,
    }

    public static bool TryLogUnit(string? unit, out LogMode mode)
    {
        var text = (unit ?? "").Trim().ToLowerInvariant();
        if (text is "portion" or "portions")
        {
            mode = LogMode.Portion;
            return true;
        }

        if (LogEntryRules.NormalizeUnit(text) == "g")
        {
            mode = LogMode.Grams;
            return true;
        }

        mode = default;
        return false;
    }

    public readonly record struct LoggedScale(
        decimal Amount,
        string Unit,
        decimal? Grams,
        Totals Nutrients,
        string? Error)
    {
        public static LoggedScale Fail(string error) => new(0, "", null, default, error);
    }

    public static LoggedScale ScaleLog(Totals totals, decimal portions, decimal? finishedGrams, decimal amount, LogMode mode)
    {
        var rounded = LogEntryRules.Round2(amount);
        if (mode == LogMode.Grams)
        {
            if (finishedGrams is not > 0)
            {
                return LoggedScale.Fail(NoFinishedWeight);
            }

            var limit = LogEntryRules.RejectAmount(rounded, "g");
            if (limit is not null)
            {
                return LoggedScale.Fail(limit);
            }

            if (!TryShare(totals, rounded / finishedGrams.Value, out var byGram))
            {
                return LoggedScale.Fail(LogTooLarge);
            }

            return new LoggedScale(rounded, "g", rounded, byGram, null);
        }

        if (rounded <= 0 || rounded > LogEntryRules.CountMax)
        {
            return LoggedScale.Fail(PortionAmountLimit);
        }

        if (portions <= 0)
        {
            return LoggedScale.Fail(PortionsLimit);
        }

        var factor = rounded / portions;
        if (!TryShare(totals, factor, out var byPortion))
        {
            return LoggedScale.Fail(LogTooLarge);
        }

        decimal? grams = null;
        if (finishedGrams is > 0)
        {
            try
            {
                var weight = LogEntryRules.Round2(finishedGrams.Value * factor);
                if (weight > NutrientMax)
                {
                    return LoggedScale.Fail(LogTooLarge);
                }

                if (weight > 0)
                {
                    grams = weight;
                }
            }
            catch (OverflowException)
            {
                return LoggedScale.Fail(LogTooLarge);
            }
        }

        return new LoggedScale(rounded, PortionUnit, grams, byPortion, null);
    }

    public enum BuildStatus
    {
        Ok,
        NotFound,
        Invalid,
    }

    public readonly record struct BuiltLine(
        BuildStatus Status,
        string? Error,
        string Name,
        Guid FoodId,
        string FoodOwnerKey,
        decimal Amount,
        string Unit,
        decimal? Grams,
        Totals Nutrients)
    {
        public static BuiltLine Missing() => new(BuildStatus.NotFound, MissingFood, "", Guid.Empty, "", 0, "", null, default);

        public static BuiltLine Bad(string error) => new(BuildStatus.Invalid, error, "", Guid.Empty, "", 0, "", null, default);
    }

    public static BuiltLine BuildNew(Food? food, string userId, decimal rawAmount, string? unit, decimal? ownGramsEach)
    {
        if (!Owned(food, userId))
        {
            return BuiltLine.Missing();
        }

        if (food!.RetiredAt is not null)
        {
            return BuiltLine.Bad(FoodRetired);
        }

        return FromFood(food, rawAmount, unit, ownGramsEach);
    }

    /// <summary>
    /// A retired ingredient keeps its saved nutrients when the amount and unit
    /// are unchanged, and scales those saved nutrients when only the amount changes.
    /// A different unit is rejected. The retired food's current row is not read.
    /// </summary>
    public static BuiltLine BuildEdit(
        Food? food,
        string userId,
        decimal rawAmount,
        string? unit,
        decimal? ownGramsEach,
        RecipeIngredient? kept)
    {
        if (!Owned(food, userId))
        {
            return BuiltLine.Missing();
        }

        if (food!.RetiredAt is null)
        {
            return FromFood(food, rawAmount, unit, ownGramsEach);
        }

        if (kept is null || kept.FoodId != food.Id)
        {
            return BuiltLine.Bad(FoodRetired);
        }

        var kind = LogEntryRules.CanonicalUnit(unit);
        var savedKind = LogEntryRules.CanonicalUnit(kept.Unit);
        if (kind is null || savedKind is null || !string.Equals(kind, savedKind, StringComparison.OrdinalIgnoreCase))
        {
            return BuiltLine.Bad(KeepAmount);
        }

        var amount = LogEntryRules.Round2(rawAmount);
        var limit = LogEntryRules.RejectAmount(amount, savedKind);
        if (limit is not null)
        {
            return BuiltLine.Bad(limit);
        }

        if (amount == kept.Amount)
        {
            return new BuiltLine(
                BuildStatus.Ok,
                null,
                kept.Name,
                kept.FoodId,
                kept.FoodOwnerKey,
                kept.Amount,
                kept.Unit,
                kept.Grams,
                new Totals(kept.Kcal, kept.Protein, kept.Fat, kept.Carbs, kept.SaturatedFat, kept.Sugars, kept.Fiber, kept.Salt));
        }

        if (kept.Amount == 0)
        {
            return BuiltLine.Bad(KeepAmount);
        }

        var factor = amount / kept.Amount;
        if (!TryShare(new Totals(kept.Kcal, kept.Protein, kept.Fat, kept.Carbs, kept.SaturatedFat, kept.Sugars, kept.Fiber, kept.Salt), factor, out var scaled))
        {
            return BuiltLine.Bad(TooLarge);
        }

        decimal? grams = null;
        if (kept.Grams is > 0)
        {
            try
            {
                var weight = LogEntryRules.Round2(kept.Grams.Value * factor);
                if (weight > NutrientMax)
                {
                    return BuiltLine.Bad(TooLarge);
                }

                if (weight > 0)
                {
                    grams = weight;
                }
            }
            catch (OverflowException)
            {
                return BuiltLine.Bad(TooLarge);
            }
        }

        return new BuiltLine(
            BuildStatus.Ok,
            null,
            kept.Name,
            kept.FoodId,
            kept.FoodOwnerKey,
            amount,
            kept.Unit,
            grams,
            scaled);
    }

    public static string RetiredNotice(IEnumerable<string> names)
    {
        var list = names.Where(name => !string.IsNullOrWhiteSpace(name)).Distinct(StringComparer.Ordinal).ToList();
        if (list.Count == 0)
        {
            return "";
        }

        if (list.Count == 1)
        {
            return $"{list[0]} is no longer available. Its saved totals stay until you remove it.";
        }

        return $"{string.Join(", ", list)} are no longer available. Their saved totals stay until you remove them.";
    }

    private static bool Owned(Food? food, string userId) =>
        food is not null && (food.UserId is null || food.UserId == userId);

    private static BuiltLine FromFood(Food food, decimal rawAmount, string? unit, decimal? ownGramsEach)
    {
        var amount = LogEntryRules.Round2(rawAmount);
        var snapshot = LogEntryRules.Snapshot(food, amount, unit, ownGramsEach);
        if (snapshot.Error is not null)
        {
            return BuiltLine.Bad(snapshot.Error);
        }

        var totals = new Totals(snapshot.Kcal, snapshot.Protein, snapshot.Fat, snapshot.Carbs, snapshot.SaturatedFat, snapshot.Sugars, snapshot.Fiber, snapshot.Salt);
        if (!Fits(totals))
        {
            return BuiltLine.Bad(TooLarge);
        }

        var name = LogEntryRules.Collapse(food.Name);
        if (name.Length == 0)
        {
            name = "Food";
        }

        if (name.Length > 300)
        {
            name = name[..300];
        }

        return new BuiltLine(
            BuildStatus.Ok,
            null,
            name,
            food.Id,
            food.UserId ?? Food.CatalogueOwnerKey,
            amount,
            snapshot.Unit,
            snapshot.Grams,
            totals);
    }

    private static bool Fits(Totals totals) =>
        totals.Kcal is >= 0 and <= NutrientMax
        && totals.Protein is >= 0 and <= NutrientMax
        && totals.Fat is >= 0 and <= NutrientMax
        && totals.Carbs is >= 0 and <= NutrientMax
        && FitsOptional(totals.SaturatedFat)
        && FitsOptional(totals.Sugars)
        && FitsOptional(totals.Fiber)
        && FitsOptional(totals.Salt);

    private static bool FitsOptional(decimal? value) => value is null || value is >= 0 and <= NutrientMax;

    private static decimal Scale(decimal value, decimal factor) => LogEntryRules.Round2(value * factor);

    private static bool TryShare(Totals total, decimal factor, out Totals shared)
    {
        shared = default;
        try
        {
            var next = Share(total, factor);
            if (!Fits(next))
            {
                return false;
            }

            shared = next;
            return true;
        }
        catch (OverflowException)
        {
            return false;
        }
    }

    private static bool TryAdd(decimal left, decimal right, out decimal sum)
    {
        sum = 0;
        try
        {
            var value = left + right;
            if (value < 0 || value > NutrientMax)
            {
                return false;
            }

            sum = value;
            return true;
        }
        catch (OverflowException)
        {
            return false;
        }
    }
}
