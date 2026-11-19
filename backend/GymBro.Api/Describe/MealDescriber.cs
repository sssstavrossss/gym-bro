using GymBro.Api.Data;
using GymBro.Api.Endpoints;
using GymBro.Api.Foods;
using GymBro.Api.Logging;

namespace GymBro.Api.Describe;

/// <summary>A food from the text and what it matched. <see cref="Food"/> is null when nothing fit.</summary>
public sealed record DescribedItem(string Phrase, string Name, bool Guessed, Food? Food, decimal Amount, string Unit);

/// <summary>
/// Turns a typed meal into foods to review: the model splits the text, the person's own catalogue is
/// searched for each part, then the model picks a candidate and an amount. A pick in a unit the food
/// can't be logged in falls back to the model's gram estimate, so every match can be logged as shown.
/// </summary>
public sealed class MealDescriber(AppDbContext db, IMealModel model)
{
    public const int TextMax = 500;

    public const int PartsMax = 12;

    public const int SearchesPerPart = 3;

    public const int PerSearch = 4;

    public const int CandidatesMax = 8;

    public const string TextRequired = "Write what you ate.";

    public const string TextTooLong = "That's a long one. Keep it under 500 characters, or split it in two.";

    public static string? RejectText(string? text)
    {
        var trimmed = (text ?? "").Trim();
        if (trimmed.Length == 0)
        {
            return TextRequired;
        }

        return trimmed.Length > TextMax ? TextTooLong : null;
    }

    public async Task<IReadOnlyList<DescribedItem>> DescribeAsync(string userId, string text, MealUsage usage, CancellationToken cancellationToken)
    {
        var parts = (await model.SplitAsync(text, usage, cancellationToken))
            .Where(part => !string.IsNullOrWhiteSpace(part.Name))
            .Take(PartsMax)
            .ToList();
        if (parts.Count == 0)
        {
            return [];
        }

        var found = new List<List<Food>>();
        foreach (var part in parts)
        {
            found.Add(await SearchAsync(userId, part, cancellationToken));
        }

        var servings = await ServingEndpoints.ForFoods(db, userId, found.SelectMany(foods => foods).Select(food => food.Id), cancellationToken);
        var choices = parts
            .Select((part, index) => new MealChoice(
                part,
                found[index].Select(food => new MealCandidate(food, food.UserId == userId, Units(food, servings.GetValueOrDefault(food.Id)))).ToList()))
            .ToList();
        var picks = choices.Any(choice => choice.Candidates.Count > 0)
            ? await model.PickAsync(text, choices, usage, cancellationToken)
            : [];
        var byPart = picks
            .Where(pick => pick.Part >= 0 && pick.Part < choices.Count)
            .GroupBy(pick => pick.Part)
            .ToDictionary(group => group.Key, group => group.First());
        return choices.Select((choice, index) => Resolve(choice, byPart.GetValueOrDefault(index))).ToList();
    }

    /// <summary>The units <paramref name="food"/> can be logged in, with one's weight when there is one.</summary>
    public static IReadOnlyList<MealUnit> Units(Food food, IReadOnlyList<UserServing>? servings)
    {
        if (food.NutrientBasis == NutrientBases.PerServing)
        {
            return [new MealUnit("serving", Label(food.ServingLabel, "serving"), null)];
        }

        if (food.NutrientBasis == NutrientBases.Unconfirmed)
        {
            return [new MealUnit("g", "g", 1), new MealUnit("ml", "ml", null)];
        }

        if (food.Basis == "ml")
        {
            return [new MealUnit("ml", "ml", null)];
        }

        var units = new List<MealUnit> { new("g", "g", 1) };
        if (food.ServingQuantity is > 0)
        {
            units.Add(new MealUnit("serving", Label(food.ServingLabel, "serving"), food.ServingQuantity));
        }

        if (food.PieceQuantity is > 0)
        {
            units.Add(new MealUnit("piece", Label(food.PieceLabel, "piece"), food.PieceQuantity));
        }

        foreach (var serving in servings ?? [])
        {
            units.Add(new MealUnit(serving.Name, serving.Name, serving.Grams));
        }

        return units;
    }

    /// <summary>The model's pick when the food can be logged that way. Otherwise its gram estimate, or one serving.</summary>
    public static DescribedItem Resolve(MealChoice choice, MealPick? pick)
    {
        var part = choice.Part;
        if (pick?.Candidate is not { } number || number < 0 || number >= choice.Candidates.Count)
        {
            return new DescribedItem(part.Phrase, part.Name, part.Guessed, null, 0, "");
        }

        var candidate = choice.Candidates[number];
        var unit = candidate.Units.FirstOrDefault(option => string.Equals(option.Unit, pick.Unit.Trim(), StringComparison.OrdinalIgnoreCase));
        if (unit is not null && Fits(candidate.Food, Tidy(pick.Amount, unit.Unit), unit))
        {
            return new DescribedItem(part.Phrase, part.Name, part.Guessed, candidate.Food, Tidy(pick.Amount, unit.Unit), unit.Unit);
        }

        var fallback = candidate.Units.FirstOrDefault(option => option.Unit is "g" or "ml") ?? candidate.Units[0];
        var amount = fallback.Unit is "g" or "ml" ? Tidy(part.Grams, fallback.Unit) : 1m;
        return Fits(candidate.Food, amount, fallback)
            ? new DescribedItem(part.Phrase, part.Name, part.Guessed, candidate.Food, amount, fallback.Unit)
            : new DescribedItem(part.Phrase, part.Name, part.Guessed, null, 0, "");
    }

    /// <summary>Kcal for an item as it would be logged, or null when it can't be.</summary>
    public static decimal? Kcal(Food food, decimal amount, string unit, decimal? unitGrams)
    {
        var snapshot = LogEntryRules.Snapshot(food, amount, unit, unitGrams);
        return snapshot.Error is null ? snapshot.Kcal : null;
    }

    private static bool Fits(Food food, decimal amount, MealUnit unit) =>
        LogEntryRules.Snapshot(food, amount, unit.Unit, unit.Grams).Error is null;

    /// <summary>Whole grams and millilitres. Counts to the nearest quarter, at least a quarter.</summary>
    private static decimal Tidy(decimal amount, string unit) => unit is "g" or "ml"
        ? Math.Max(1, decimal.Round(amount, 0, MidpointRounding.AwayFromZero))
        : Math.Max(0.25m, decimal.Round(amount * 4, 0, MidpointRounding.AwayFromZero) / 4);

    private static string Label(string? label, string fallback) =>
        string.IsNullOrWhiteSpace(label) ? fallback : label.Trim();

    private async Task<List<Food>> SearchAsync(string userId, MealPart part, CancellationToken cancellationToken)
    {
        var foods = new List<Food>();
        var queries = part.Searches.Append(part.Name)
            .Select(query => query.Trim())
            .Where(query => FoodCatalog.ValidateQuery(query) is null)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(SearchesPerPart);
        foreach (var query in queries)
        {
            var hits = await FoodCatalog.SearchAsync(db, userId, query, cancellationToken);
            foods.AddRange(hits.Where(hit => foods.All(food => food.Id != hit.Id)).Take(PerSearch));
            if (foods.Count >= CandidatesMax)
            {
                break;
            }
        }

        return foods.Take(CandidatesMax).ToList();
    }
}
