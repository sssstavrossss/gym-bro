using GymBro.Api.Data;

namespace GymBro.Api.Logging;

/// <summary>
/// Saved-group rules. A group remembers amount, unit and grams.
/// Re-adding a food uses that food's current values. A quick-add item has no food,
/// so its stored calories and macros are logged again and nothing is invented.
/// A missing own serving falls back to the stored grams only when the food is
/// measured in grams. Millilitres stay millilitres: there is no grams-to-ml conversion.
/// </summary>
public static class GroupRules
{
    public const string NeedEntries = "Choose entries to save.";

    public const string NeedTwo = "Select 2 or more.";

    public const string TooMany = "Save up to 100 items in a group.";

    public const string NameLength = "Use a shorter name.";

    public const string PickTime = "Pick a time.";

    public const string KeyLength = "Use a shorter idempotency key.";

    public const string DefaultName = "My group";

    public const int MaxItems = 100;

    public const int NameMax = 120;

    /// <summary>Room for ":00" on a log entry key, which is 64 characters.</summary>
    public const int KeyMax = 60;

    public static string CleanName(string? raw)
    {
        var text = LogEntryRules.Collapse(raw);
        return text.Length == 0 ? DefaultName : text;
    }

    public static string? RejectName(string? raw, out string name)
    {
        name = CleanName(raw);
        return name.Length > NameMax ? NameLength : null;
    }

    public static string ItemKey(string requestKey, int position) => $"{requestKey}:{position:D2}";

    public static string Skipped(string name) => $"Skipped {name}.";

    public static string SkippedServing(string name, string unit) =>
        $"Skipped {name}. {LogEntryRules.MissingServing(unit)}";

    public static string JoinNotices(IEnumerable<string> notices) =>
        string.Join(' ', notices.Where(notice => notice.Length > 0));

    /// <summary>
    /// What one re-add should write. <paramref name="ownGramsEach"/> is the person's
    /// serving as it is now, or null when that name is gone.
    /// </summary>
    public static PlannedItem Plan(EntryGroupItem item, Food? food, decimal? ownGramsEach)
    {
        if (item.FoodId is null)
        {
            return PlannedItem.Ready(
                item.Name,
                LogEntryRules.QuickSource,
                null,
                null,
                Food.CatalogueOwnerKey,
                item.Amount,
                item.Unit,
                null,
                item.Kcal,
                item.Protein,
                item.Fat,
                item.Carbs,
                item.SaturatedFat,
                item.Sugars,
                item.Fiber,
                item.Salt);
        }

        var label = ItemLabel(item, food);
        if (food is null || food.RetiredAt is not null || (food.UserId is not null && food.UserId != item.UserId))
        {
            return PlannedItem.Skip(label, Skipped(label));
        }

        var name = DisplayName(food);
        var standard = LogEntryRules.NormalizeUnit(item.Unit);
        var named = standard is null && item.Unit.Length > 0 ? item.Unit : null;
        FoodSnapshot snapshot;
        var usedStoredGrams = false;
        if (named is not null)
        {
            if (ownGramsEach is > 0)
            {
                snapshot = LogEntryRules.Snapshot(food, item.Amount, named, ownGramsEach);
            }
            else if (item.Grams is > 0 && AcceptsStoredGrams(food))
            {
                usedStoredGrams = true;
                snapshot = LogEntryRules.Snapshot(food, item.Grams.Value, "g", null);
            }
            else
            {
                return PlannedItem.Skip(label, SkippedServing(label, named));
            }
        }
        else
        {
            snapshot = LogEntryRules.Snapshot(food, item.Amount, item.Unit, null);
            if (snapshot.Error is not null && standard != "ml" && item.Grams is > 0 && AcceptsStoredGrams(food))
            {
                usedStoredGrams = true;
                snapshot = LogEntryRules.Snapshot(food, item.Grams.Value, "g", null);
            }
        }

        if (snapshot.Error is not null)
        {
            return PlannedItem.Skip(label, named is not null ? SkippedServing(label, named) : Skipped(label));
        }

        var amount = usedStoredGrams ? snapshot.Grams ?? item.Grams!.Value : item.Amount;
        return PlannedItem.Ready(
            name,
            food.Source,
            food.SourceId,
            food.Id,
            food.UserId ?? Food.CatalogueOwnerKey,
            amount,
            snapshot.Unit,
            snapshot.Grams,
            snapshot.Kcal,
            snapshot.Protein,
            snapshot.Fat,
            snapshot.Carbs,
            snapshot.SaturatedFat,
            snapshot.Sugars,
            snapshot.Fiber,
            snapshot.Salt);
    }

    /// <summary>A stored gram weight can stand in for a missing serving only on a per-100 g food.</summary>
    public static bool AcceptsStoredGrams(Food food) =>
        food.RetiredAt is null
        && food.NutrientBasis == NutrientBases.Per100
        && food.Basis == "g";

    private static string ItemLabel(EntryGroupItem item, Food? food)
    {
        if (item.Name.Length > 0)
        {
            return item.Name;
        }

        return food is null ? "A food" : DisplayName(food);
    }

    private static string DisplayName(Food food)
    {
        var text = food.Name ?? "";
        return text.Length <= 300 ? text : text[..300];
    }
}

public readonly record struct PlannedItem(
    bool Add,
    string Notice,
    string Name,
    string Source,
    string? SourceId,
    Guid? FoodId,
    string FoodOwnerKey,
    decimal Amount,
    string Unit,
    decimal? Grams,
    decimal Kcal,
    decimal Protein,
    decimal Fat,
    decimal Carbs,
    decimal? SaturatedFat = null,
    decimal? Sugars = null,
    decimal? Fiber = null,
    decimal? Salt = null)
{
    public static PlannedItem Ready(
        string name,
        string source,
        string? sourceId,
        Guid? foodId,
        string foodOwnerKey,
        decimal amount,
        string unit,
        decimal? grams,
        decimal kcal,
        decimal protein,
        decimal fat,
        decimal carbs,
        decimal? saturatedFat = null,
        decimal? sugars = null,
        decimal? fiber = null,
        decimal? salt = null) =>
        new(true, "", name, source, sourceId, foodId, foodOwnerKey, amount, unit, grams, kcal, protein, fat, carbs, saturatedFat, sugars, fiber, salt);

    public static PlannedItem Skip(string name, string notice) =>
        new(false, notice, name, "", null, null, "", 0, "", null, 0, 0, 0, 0);
}
