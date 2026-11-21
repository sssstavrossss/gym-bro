using GymBro.Api.Data;
using GymBro.Api.Endpoints;
using GymBro.Api.Foods;
using GymBro.Api.Logging;

namespace GymBro.Api.Describe;

/// <summary>A food from the text and what it matched. <see cref="Food"/> is null when nothing fit.</summary>
public sealed record DescribedItem(string Phrase, string Name, bool Guessed, Food? Food, decimal Amount, string Unit);

/// <summary>
/// Turns a described meal (words, a photo, or both) into foods to review: the model splits the note, the
/// person's own catalogue is searched for each part, then the model picks a candidate and an amount. A part
/// with nothing that fits is searched once more with the searches the pick suggests, and picked again. A pick
/// in a unit the food can't be logged in falls back to the model's gram estimate, so every match can be
/// logged as shown.
/// </summary>
public sealed class MealDescriber(AppDbContext db, IMealModel model)
{
    public const int TextMax = 500;

    public const int PartsMax = 12;

    public const int SearchesPerPart = 3;

    public const int PerSearch = 6;

    public const int CandidatesMax = 12;

    public const string TextRequired = "Write what you ate, or add a photo.";

    public const string TextTooLong = "That's a long one. Keep it under 500 characters, or split it in two.";

    /// <summary>Why the words can't be sent, or null. With a photo they may be empty.</summary>
    public static string? RejectText(string? text, bool photo = false)
    {
        var trimmed = (text ?? "").Trim();
        if (trimmed.Length == 0)
        {
            return photo ? null : TextRequired;
        }

        return trimmed.Length > TextMax ? TextTooLong : null;
    }

    public async Task<IReadOnlyList<DescribedItem>> DescribeAsync(string userId, MealNote note, MealUsage usage, CancellationToken cancellationToken)
    {
        var parts = (await model.SplitAsync(note, usage, cancellationToken))
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
            found.Add(await SearchAsync(userId, part.Searches.Append(part.Name), cancellationToken));
        }

        var choices = await ChoicesAsync(userId, parts, found, cancellationToken);
        var picks = ByPart(await model.PickAsync(note.ForPick, choices, usage, cancellationToken), choices.Count);
        await RetryAsync(userId, note, found, choices, picks, usage, cancellationToken);

        // A food the model added itself (oil for frying) is dropped when it found none, or when the pick
        // left it out because the dish already holds it; it was never in the note to be "not found".
        return choices
            .Select((choice, index) => Resolve(choice, picks.GetValueOrDefault(index)))
            .Where((item, index) => item.Food is not null || !choices[index].Part.Added)
            .ToList();
    }

    /// <summary>
    /// Once, for the parts the pick found nothing for but suggested other searches: search those, and ask
    /// again about only the parts that turned up new foods. Their choices and picks are replaced in place.
    /// </summary>
    private async Task RetryAsync(
        string userId,
        MealNote note,
        IReadOnlyList<List<Food>> found,
        List<MealChoice> choices,
        Dictionary<int, MealPick> picks,
        MealUsage usage,
        CancellationToken cancellationToken)
    {
        var parts = new List<int>();
        var foods = new List<List<Food>>();
        foreach (var (index, pick) in picks.OrderBy(entry => entry.Key))
        {
            if (pick.Candidate is not null || pick.Retry is not { Count: > 0 } searches)
            {
                continue;
            }

            var seen = found[index].Select(food => food.Id).ToHashSet();
            var fresh = (await SearchAsync(userId, searches, cancellationToken)).Where(food => !seen.Contains(food.Id)).ToList();
            if (fresh.Count > 0)
            {
                parts.Add(index);
                foods.Add(fresh);
            }
        }

        if (parts.Count == 0)
        {
            return;
        }

        var again = await ChoicesAsync(userId, parts.Select(index => choices[index].Part).ToList(), foods, cancellationToken);
        var answers = ByPart(await model.PickAsync(note.ForPick, again, usage, cancellationToken), again.Count);
        foreach (var (index, position) in parts.Select((index, position) => (index, position)))
        {
            choices[index] = again[position];
            if (answers.TryGetValue(position, out var answer))
            {
                picks[index] = answer;
            }
            else
            {
                picks.Remove(index);
            }
        }
    }

    private async Task<List<MealChoice>> ChoicesAsync(string userId, IReadOnlyList<MealPart> parts, IReadOnlyList<List<Food>> found, CancellationToken cancellationToken)
    {
        var servings = await ServingEndpoints.ForFoods(db, userId, found.SelectMany(foods => foods).Select(food => food.Id), cancellationToken);
        return parts
            .Select((part, index) => new MealChoice(
                part,
                found[index].Select(food => new MealCandidate(food, food.UserId == userId, Units(food, servings.GetValueOrDefault(food.Id)))).ToList()))
            .ToList();
    }

    /// <summary>Each part's pick. A pick for a part that doesn't exist, or a second one for a part, is ignored.</summary>
    private static Dictionary<int, MealPick> ByPart(IReadOnlyList<MealPick> picks, int count) =>
        picks
            .Where(pick => pick.Part >= 0 && pick.Part < count)
            .GroupBy(pick => pick.Part)
            .ToDictionary(group => group.Key, group => group.First());

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

        // The table's household measures, each once: a measure the serving or piece already is adds nothing.
        foreach (var portion in FoodPortions.Read(food))
        {
            var label = portion.NameEn ?? portion.Name;
            if (units.Any(unit => string.Equals(unit.Unit, portion.Id, StringComparison.OrdinalIgnoreCase)
                || (unit.Grams == portion.Grams && string.Equals(unit.Label, portion.Name, StringComparison.OrdinalIgnoreCase))))
            {
                continue;
            }

            units.Add(new MealUnit(portion.Id, label, portion.Grams, AsGrams: true));
        }

        return units;
    }

    /// <summary>
    /// How far a pick's weight may be from the first answer's gram estimate before the estimate wins.
    /// It catches a number meant for another unit ("15" grams of honey as 15 tablespoons).
    /// </summary>
    public const decimal EstimateSpread = 3;

    /// <summary>
    /// The model's pick when the food can be logged that way and the weight is near the estimate.
    /// Otherwise its gram estimate, or one serving.
    /// </summary>
    public static DescribedItem Resolve(MealChoice choice, MealPick? pick)
    {
        var part = choice.Part;
        if (pick?.Candidate is not { } number || number < 0 || number >= choice.Candidates.Count)
        {
            return new DescribedItem(part.Phrase, part.Name, part.Guessed, null, 0, "");
        }

        var candidate = choice.Candidates[number];
        var unit = candidate.Units.FirstOrDefault(option => string.Equals(option.Unit, UnitName(pick.Unit), StringComparison.OrdinalIgnoreCase));
        if (unit is { AsGrams: true, Grams: { } each } && NearEstimate(part, Tidy(pick.Amount, unit.Unit), unit))
        {
            var weight = Tidy(Tidy(pick.Amount, unit.Unit) * each, "g");
            var grams = candidate.Units.First(option => option.Unit is "g");
            if (Fits(candidate.Food, weight, grams))
            {
                return new DescribedItem(part.Phrase, part.Name, part.Guessed, candidate.Food, weight, "g");
            }
        }
        else if (unit is not null && Fits(candidate.Food, Tidy(pick.Amount, unit.Unit), unit) && NearEstimate(part, Tidy(pick.Amount, unit.Unit), unit))
        {
            return new DescribedItem(part.Phrase, part.Name, part.Guessed, candidate.Food, Tidy(pick.Amount, unit.Unit), unit.Unit);
        }

        var fallback = candidate.Units.FirstOrDefault(option => option.Unit is "g" or "ml") ?? candidate.Units[0];
        var amount = fallback.Unit is "g" or "ml" ? Tidy(part.Grams, fallback.Unit) : 1m;
        return Fits(candidate.Food, amount, fallback)
            ? new DescribedItem(part.Phrase, part.Name, part.Guessed, candidate.Food, amount, fallback.Unit)
            : new DescribedItem(part.Phrase, part.Name, part.Guessed, null, 0, "");
    }

    /// <summary>The unit as listed, when a reply copies its description too: "piece (1 egg = 60 g)" is "piece".</summary>
    private static string UnitName(string unit)
    {
        var bracket = unit.IndexOf(" (", StringComparison.Ordinal);
        return (bracket > 0 ? unit[..bracket] : unit).Trim();
    }

    /// <summary>Kcal for an item as it would be logged, or null when it can't be.</summary>
    public static decimal? Kcal(Food food, decimal amount, string unit, decimal? unitGrams)
    {
        var snapshot = LogEntryRules.Snapshot(food, amount, unit, unitGrams);
        return snapshot.Error is null ? snapshot.Kcal : null;
    }

    /// <summary>True when the weight can't be known (ml, a per-serving food) or is within <see cref="EstimateSpread"/> of the estimate.</summary>
    private static bool NearEstimate(MealPart part, decimal amount, MealUnit unit)
    {
        if (unit.Grams is not { } grams || part.Grams <= 0)
        {
            return true;
        }

        var weight = amount * grams;
        return weight <= part.Grams * EstimateSpread && weight * EstimateSpread >= part.Grams;
    }

    private static bool Fits(Food food, decimal amount, MealUnit unit) =>
        LogEntryRules.Snapshot(food, amount, unit.Unit, unit.Grams).Error is null;

    /// <summary>Whole grams and millilitres. Counts to the nearest quarter, at least a quarter.</summary>
    private static decimal Tidy(decimal amount, string unit) => unit is "g" or "ml"
        ? Math.Max(1, decimal.Round(amount, 0, MidpointRounding.AwayFromZero))
        : Math.Max(0.25m, decimal.Round(amount * 4, 0, MidpointRounding.AwayFromZero) / 4);

    private static string Label(string? label, string fallback) =>
        string.IsNullOrWhiteSpace(label) ? fallback : label.Trim();

    private async Task<List<Food>> SearchAsync(string userId, IEnumerable<string> searches, CancellationToken cancellationToken)
    {
        var foods = new List<Food>();
        var queries = searches
            .Select(query => query.Trim())
            .Where(query => FoodCatalog.ValidateQuery(query) is null)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(SearchesPerPart);
        foreach (var query in queries)
        {
            // The search sorts each rank by name, so "brød" lists home-made breads first. The person's own foods
            // come first here, then the closest match ("gulost" finds "Gulost, uspesifisert" before "Edamer,
            // gulost"), then the shortest names: in the catalogue those are the everyday ones ("Pizza, kjøpt").
            var hits = HomeOnlyWhenFound(await FoodCatalog.SearchRankedAsync(db, userId, query, FoodSources.DefaultHome, cancellationToken))
                .OrderBy(hit => hit.Food.UserId == userId ? 0 : 1)
                .ThenBy(hit => hit.Rank)
                .ThenBy(hit => hit.Food.Name.Length)
                .Select(hit => hit.Food);
            foods.AddRange(hits.Where(hit => foods.All(food => food.Id != hit.Id)).Take(PerSearch));
            if (foods.Count >= CandidatesMax)
            {
                break;
            }
        }

        return foods.Take(CandidatesMax).ToList();
    }

    /// <summary>
    /// Another country's foods only when the home table (with own foods and Open Food Facts) has nothing for this
    /// search. Offered side by side, the model picks "Hallon" for "bringebær" or a Swedish granola over the
    /// Norwegian one; alone, they fill the gaps the home table has ("kåldolmar", "semla").
    /// </summary>
    public static IEnumerable<RankedFood> HomeOnlyWhenFound(IReadOnlyList<RankedFood> hits) =>
        hits.Any(hit => hit.Tier == 0) ? hits.Where(hit => hit.Tier == 0) : hits;
}
