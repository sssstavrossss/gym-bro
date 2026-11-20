using GymBro.Api.Data;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Export;

/// <summary>One table of the export: a CSV file in the zip, and a list (or one object) in the JSON file.</summary>
/// <remarks>Cells are null, string, bool, int, decimal or DateOnly. <see cref="ExportFiles"/> formats them.</remarks>
public sealed record ExportTable(string Name, IReadOnlyList<string> Columns, IReadOnlyList<object?[]> Rows, bool Single = false);

/// <summary>Everything a person has entered, read for one caller only and laid out as tables.</summary>
public static class ExportTables
{
    /// <summary>The micronutrient panel as columns: the panel key and its column, named with the unit.
    /// The units are the app's (frontend/src/lib/nutrients.ts). µg is written ug.</summary>
    public static readonly IReadOnlyList<(string Key, string Column)> Panel =
    [
        ("monoFat", "mono_fat_g"), ("polyFat", "poly_fat_g"), ("transFat", "trans_fat_g"),
        ("omega3", "omega3_g"), ("epaDha", "epa_dha_g"), ("omega6", "omega6_g"),
        ("cholesterol", "cholesterol_mg"), ("addedSugars", "added_sugars_g"), ("starch", "starch_g"),
        ("sodium", "sodium_mg"), ("vitaminA", "vitamin_a_ug"), ("vitaminD", "vitamin_d_ug"),
        ("vitaminE", "vitamin_e_mg"), ("vitaminC", "vitamin_c_mg"), ("thiamin", "thiamin_mg"),
        ("riboflavin", "riboflavin_mg"), ("niacin", "niacin_mg"), ("vitaminB6", "vitamin_b6_mg"),
        ("folate", "folate_ug"), ("vitaminB12", "vitamin_b12_ug"), ("calcium", "calcium_mg"),
        ("iron", "iron_mg"), ("zinc", "zinc_mg"), ("magnesium", "magnesium_mg"),
        ("potassium", "potassium_mg"), ("phosphorus", "phosphorus_mg"), ("selenium", "selenium_ug"),
        ("iodine", "iodine_ug"), ("copper", "copper_mg"),
    ];

    private static readonly string[] Macros = ["kcal", "protein_g", "fat_g", "carbs_g", "saturated_fat_g", "sugars_g", "fiber_g", "salt_g"];

    public static async Task<IReadOnlyList<ExportTable>> ReadAsync(AppDbContext db, string userId, CancellationToken cancellationToken)
    {
        var profile = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(row => row.UserId == userId, cancellationToken);
        var weighIns = await db.WeighIns.AsNoTracking().Where(row => row.UserId == userId).OrderBy(row => row.LocalDate).ToListAsync(cancellationToken);
        var targets = await db.TargetHistories.AsNoTracking().Where(row => row.UserId == userId).OrderBy(row => row.EffectiveDate).ToListAsync(cancellationToken);
        var entries = await db.LogEntries.AsNoTracking()
            .Where(row => row.UserId == userId && row.DeletedAt == null)
            .OrderBy(row => row.LocalDate).ThenBy(row => row.LoggedAt)
            .ToListAsync(cancellationToken);
        var fasting = await db.DayStatuses.AsNoTracking().Where(row => row.UserId == userId && row.Fasting).OrderBy(row => row.LocalDate).ToListAsync(cancellationToken);
        var foods = await db.Foods.AsNoTracking().Where(row => row.UserId == userId).OrderBy(row => row.Name).ToListAsync(cancellationToken);
        var servings = await db.UserServings.AsNoTracking().Where(row => row.UserId == userId).ToListAsync(cancellationToken);
        var recipes = await db.Recipes.AsNoTracking().Where(row => row.UserId == userId).OrderBy(row => row.Name).ToListAsync(cancellationToken);
        var ingredients = await db.RecipeIngredients.AsNoTracking().Where(row => row.UserId == userId).ToListAsync(cancellationToken);
        var groups = await db.EntryGroups.AsNoTracking().Where(row => row.UserId == userId).OrderBy(row => row.Name).ToListAsync(cancellationToken);
        var items = await db.EntryGroupItems.AsNoTracking().Where(row => row.UserId == userId).ToListAsync(cancellationToken);
        var described = await db.MealDescriptions.AsNoTracking().Where(row => row.UserId == userId).OrderBy(row => row.CreatedAt).ToListAsync(cancellationToken);

        // A serving can be on a catalogue food, so its name is read by id. Only the ids this person used.
        var servingFoodIds = servings.Select(row => row.FoodId).Distinct().ToList();
        var foodNames = await db.Foods.AsNoTracking()
            .Where(row => servingFoodIds.Contains(row.Id) && (row.UserId == null || row.UserId == userId))
            .ToDictionaryAsync(row => row.Id, row => row.Name, cancellationToken);

        return
        [
            Profile(profile),
            WeighIns(weighIns),
            Targets(targets),
            Log(entries),
            new ExportTable("fasting_days", ["date"], [.. fasting.Select(row => new object?[] { row.LocalDate })]),
            Foods(foods),
            Servings(servings, foodNames),
            Recipes(recipes, ingredients),
            Groups(groups, items),
            Descriptions(described),
        ];
    }

    private static ExportTable Profile(Profile? row)
    {
        string[] columns =
        [
            "sex", "birth_year", "height_cm", "activity", "goal", "rate_kg_per_week", "goal_weight_kg",
            "protein_setting", "protein_g_per_kg", "fat_setting", "fat_percent", "time_zone",
            "weight_unit", "height_unit", "food_unit", "fat_limits", "sodium_limit", "created_at",
        ];
        if (row is null)
        {
            return new ExportTable("profile", columns, [], Single: true);
        }

        return new ExportTable("profile", columns,
        [
            [
                row.Sex, row.BirthYear, row.HeightCm, row.Activity, row.Goal, row.RateKgPerWeek, row.GoalWeightKg,
                row.ProteinSetting, row.ProteinGramsPerKg, row.FatSetting, row.FatPercent, row.TimeZone,
                row.WeightUnit, row.HeightUnit, row.FoodUnit, row.FatLimits, row.SodiumLimit, row.CreatedAt.ToString("O"),
            ],
        ], Single: true);
    }

    private static ExportTable WeighIns(List<WeighIn> rows) =>
        new("weigh_ins", ["date", "kg"], [.. rows.Select(row => new object?[] { row.LocalDate, row.Kg })]);

    private static ExportTable Targets(List<TargetHistory> rows) => new(
        "targets",
        ["date", "kcal", "protein_g", "fat_g", "carbs_g", "bmr_kcal", "burn_kcal", "formula_burn_kcal", "weight_kg", "bmr_floor", "reasons"],
        [.. rows.Select(row => new object?[]
        {
            row.EffectiveDate, row.Kcal, row.ProteinGrams, row.FatGrams, row.CarbGrams, row.Bmr, row.Tdee,
            row.FormulaTdee, row.WeightKg, row.FloorApplied, string.Join("; ", row.Reasons),
        })]);

    private static ExportTable Log(List<LogEntry> rows) => new(
        "log",
        ["date", "time", "name", "source", "amount", "unit", "grams", .. Macros, .. Panel.Select(item => item.Column)],
        [.. rows.Select(row =>
        {
            var panel = NutrientPanel.Amount(row);
            object?[] cells =
            [
                row.LocalDate, TimeOnly.FromDateTime(row.LoggedAt).ToString("HH:mm"), row.Name, row.Source, row.Amount, row.Unit, row.Grams,
                row.Kcal, row.Protein, row.Fat, row.Carbs, row.SaturatedFat, row.Sugars, row.Fiber, row.Salt,
                .. Panel.Select(item => (object?)panel[item.Key]),
            ];
            return cells;
        })]);

    private static ExportTable Foods(List<Food> rows) => new(
        "foods",
        ["name", "brand", "barcode", "basis", "nutrient_basis", .. Macros, .. Panel.Select(item => item.Column),
            "serving_label", "serving_quantity", "piece_label", "piece_quantity", "retired"],
        [.. rows.Select(row =>
        {
            var panel = NutrientPanel.Per100(row);
            object?[] cells =
            [
                row.Name, row.Brand, row.Barcode, row.Basis, row.NutrientBasis,
                row.KcalPer100, row.ProteinPer100, row.FatPer100, row.CarbsPer100,
                row.SaturatedFatPer100, row.SugarsPer100, row.FiberPer100, row.SaltPer100,
                .. Panel.Select(item => (object?)panel[item.Key]),
                row.ServingLabel, row.ServingQuantity, row.PieceLabel, row.PieceQuantity, row.RetiredAt is not null,
            ];
            return cells;
        })]);

    private static ExportTable Servings(List<UserServing> rows, Dictionary<Guid, string> foodNames) => new(
        "servings",
        ["food", "serving", "grams"],
        [.. rows
            .Select(row => new object?[] { foodNames.GetValueOrDefault(row.FoodId), row.Name, row.Grams })
            .OrderBy(row => row[0] as string, StringComparer.Ordinal)
            .ThenBy(row => row[1] as string, StringComparer.Ordinal)]);

    private static ExportTable Recipes(List<Recipe> recipes, List<RecipeIngredient> ingredients)
    {
        var byRecipe = ingredients.ToLookup(row => row.RecipeId);
        return new ExportTable(
            "recipes",
            ["recipe", "portions", "finished_grams", "retired", "position", "ingredient", "amount", "unit", "grams", .. Macros],
            [.. recipes.SelectMany(recipe => byRecipe[recipe.Id].OrderBy(row => row.Position).Select(row => new object?[]
            {
                recipe.Name, recipe.Portions, recipe.FinishedGrams, recipe.RetiredAt is not null, row.Position + 1,
                row.Name, row.Amount, row.Unit, row.Grams,
                row.Kcal, row.Protein, row.Fat, row.Carbs, row.SaturatedFat, row.Sugars, row.Fiber, row.Salt,
            }))]);
    }

    private static ExportTable Descriptions(List<MealDescription> rows) => new(
        "descriptions",
        ["created_at", "text", "photo", "outcome", "foods", "kcal", "logged_at", "model", "input_tokens", "output_tokens"],
        [.. rows.Select(row => new object?[]
        {
            row.CreatedAt.ToString("O"), row.Text, row.HasPhoto, row.Outcome, row.FoodCount, row.Kcal, row.LoggedAt?.ToString("O"),
            row.Model, row.InputTokens, row.OutputTokens,
        })]);

    private static ExportTable Groups(List<EntryGroup> groups, List<EntryGroupItem> items)
    {
        var byGroup = items.ToLookup(row => row.GroupId);
        return new ExportTable(
            "groups",
            ["group", "position", "item", "amount", "unit", "grams", .. Macros],
            [.. groups.SelectMany(group => byGroup[group.Id].OrderBy(row => row.Position).Select(row => new object?[]
            {
                group.Name, row.Position + 1, row.Name, row.Amount, row.Unit, row.Grams,
                row.Kcal, row.Protein, row.Fat, row.Carbs, row.SaturatedFat, row.Sugars, row.Fiber, row.Salt,
            }))]);
    }
}
