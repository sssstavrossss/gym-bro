using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace GymBro.Api.Foods;

/// <summary>
/// USDA FoodData Central, SR Legacy (the last Standard Reference release, April 2018), public domain (CC0 1.0).
/// The United States' table: home there, after the home table and its neighbours everywhere else. Read from the
/// SR Legacy JSON zip, passed to <c>--import-usda --file</c>. Foundation Foods is not read: its foods are mostly
/// new analyses of SR Legacy's common foods, so search would list them twice.
/// </summary>
public static class Usda
{
    public const string Source = "usda";

    public const string Citation =
        "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central: SR Legacy, April 2018. CC0 1.0. fdc.nal.usda.gov";

    /// <summary>The package's foods for infants. Not foods anyone here logs, and they crowd search ("Babyfood, …").</summary>
    public const string BabyFoods = "Baby Foods";
}

/// <summary>A household measure as the package lists it: <see cref="Amount"/> × <see cref="Modifier"/> weighs <see cref="Grams"/>.</summary>
public sealed record UsdaPortion(decimal Amount, string? Modifier, decimal Grams);

/// <summary>A food from the package: its FDC id, description, category, values per 100 g by nutrient id, and measures.</summary>
public sealed record UsdaFood(
    int Id,
    string? Name,
    string? Category,
    IReadOnlyDictionary<int, decimal> Nutrients,
    IReadOnlyList<UsdaPortion> Portions);

public sealed class UsdaImporter(FoodTableImporter tables, ILogger<UsdaImporter> logger)
{
    /// <summary>A food keeps this many household measures besides its serving and piece, in the package's order.</summary>
    public const int MaxPortions = 8;

    // FoodData Central nutrient ids.
    private const int Energy = 1008;
    private const int Protein = 1003;
    private const int Fat = 1004;
    private const int CarbohydrateByDifference = 1005;
    private const int Fiber = 1079;
    private const int Sugars = 2000;
    private const int Starch = 1009;
    private const int SaturatedFat = 1258;
    private const int MonoFat = 1292;
    private const int PolyFat = 1293;
    private const int TransFat = 1257;
    private const int Cholesterol = 1253;
    private const int Sodium = 1093;
    private const int Retinol = 1105;
    private const int BetaCarotene = 1107;
    private const int AlphaCarotene = 1108;
    private const int BetaCryptoxanthin = 1120;
    private const int VitaminD = 1114;
    private const int VitaminE = 1109;
    private const int Thiamin = 1165;
    private const int Riboflavin = 1166;
    private const int Niacin = 1167;
    private const int VitaminB6 = 1175;
    private const int FolateTotal = 1177;
    private const int VitaminB12 = 1178;
    private const int VitaminC = 1162;
    private const int Calcium = 1087;
    private const int Iron = 1089;
    private const int Zinc = 1095;
    private const int Magnesium = 1090;
    private const int Potassium = 1092;
    private const int Phosphorus = 1091;
    private const int Selenium = 1103;
    private const int Copper = 1098;
    private const int Linoleic = 1269;
    private const int LinoleicN6 = 1316;
    private const int Linolenic = 1270;
    private const int AlphaLinolenic = 1404;
    private const int Arachidonic = 1271;
    private const int ArachidonicN6 = 1408;
    private const int Epa = 1278;
    private const int Dpa = 1280;
    private const int Dha = 1272;

    /// <summary>
    /// Measures that name one whole thing, for the food's piece when it has no medium size: "large" (an egg),
    /// "muffin", "piece, large" (jerky), "breast" (a chicken breast). Slices and cups stay household measures.
    /// </summary>
    private static readonly IReadOnlySet<string> Whole = new HashSet<string>(StringComparer.Ordinal)
    {
        "piece", "item", "each", "whole", "fruit", "large", "bagel", "muffin", "biscuit", "roll", "bun", "cookie",
        "cracker", "bar", "patty", "link", "egg", "pancake", "waffle", "doughnut", "tortilla", "sandwich", "burrito",
        "taco", "steak", "fillet", "chop", "breast", "thigh", "drumstick", "wing", "leg", "potato", "ear", "sausage",
        "frank",
    };

    /// <summary>Weights, which grams already cover.</summary>
    private static readonly IReadOnlySet<string> Weights = new HashSet<string>(StringComparer.Ordinal) { "oz", "lb", "g", "kg" };

    /// <summary>The ids Describe already uses for a food's own units; a measure by that name gets another id.</summary>
    private static readonly IReadOnlySet<string> Taken = new HashSet<string>(StringComparer.Ordinal) { "g", "ml", "serving", "piece" };

    public async Task<FoodTableImportResult> ImportFileAsync(Stream zip, CancellationToken cancellationToken)
    {
        using var archive = new ZipArchive(zip, ZipArchiveMode.Read);
        var foods = Read(archive);
        logger.LogInformation(
            "SR Legacy lists {Count} foods, {Baby} of them baby foods, which are left out.",
            foods.Count,
            foods.Count(food => food.Category == Usda.BabyFoods));
        return await tables.ImportAsync(FoodSources.Usda, foods.Select(Row), cancellationToken);
    }

    /// <summary>
    /// A food as a <see cref="FoodTableRow"/>, or null for a baby food or one without a name or kilocalories.
    /// Values are per 100 g, as published, except carbohydrate and salt (see the README).
    /// </summary>
    public static FoodTableRow? Row(UsdaFood food)
    {
        var name = Name(food.Name);
        if (name is null || food.Category == Usda.BabyFoods || !food.Nutrients.TryGetValue(Energy, out var kcal))
        {
            return null;
        }

        decimal? Take(int id) => food.Nutrients.TryGetValue(id, out var value) ? value : null;

        // Carbohydrate by difference counts fibre. The other tables count available carbohydrate, without it.
        var carbs = Take(CarbohydrateByDifference) ?? 0;
        var fiber = Take(Fiber);
        var available = Math.Max(0, carbs - (fiber ?? 0));

        // The panel stores retinol equivalents: retinol, beta-carotene / 6, and the other provitamin A
        // carotenoids / 12. SR Legacy's "Vitamin A, RAE" halves the carotenoids, so it is not used. Without
        // retinol and beta-carotene the total is unknown.
        var retinol = Take(Retinol);
        var betaCarotene = Take(BetaCarotene);
        decimal? vitaminA = retinol is null || betaCarotene is null
            ? null
            : retinol + betaCarotene / 6 + ((Take(AlphaCarotene) ?? 0) + (Take(BetaCryptoxanthin) ?? 0)) / 12;

        var panel = new Dictionary<string, decimal?>
        {
            ["monoFat"] = Take(MonoFat),
            ["polyFat"] = Take(PolyFat),
            // Single fatty acids, as Livsmedelsverket's are summed: n-3 is 18:3 (ALA when the package splits it),
            // EPA, DPA and DHA; n-6 is 18:2 and 20:4. A missing part makes the total unknown.
            ["omega3"] = Sum(Take(AlphaLinolenic) ?? Take(Linolenic), Take(Epa), Take(Dpa), Take(Dha)),
            ["omega6"] = Sum(Take(LinoleicN6) ?? Take(Linoleic), Take(ArachidonicN6) ?? Take(Arachidonic)),
            ["transFat"] = Take(TransFat),
            ["cholesterol"] = Take(Cholesterol),
            ["sodium"] = Take(Sodium),
            ["vitaminA"] = Round(vitaminA),
            ["vitaminD"] = Take(VitaminD),
            ["vitaminE"] = Take(VitaminE),
            ["thiamin"] = Take(Thiamin),
            ["riboflavin"] = Take(Riboflavin),
            ["niacin"] = Take(Niacin),
            ["vitaminB6"] = Take(VitaminB6),
            ["folate"] = Take(FolateTotal),
            ["vitaminB12"] = Take(VitaminB12),
            ["vitaminC"] = Take(VitaminC),
            ["calcium"] = Take(Calcium),
            ["iron"] = Take(Iron),
            ["zinc"] = Take(Zinc),
            ["magnesium"] = Take(Magnesium),
            ["potassium"] = Take(Potassium),
            ["phosphorus"] = Take(Phosphorus),
            ["selenium"] = Take(Selenium),
            ["copper"] = Take(Copper),
            ["starch"] = Take(Starch),
            ["epaDha"] = Sum(Take(Epa), Take(Dha)),
        };

        var measures = Measures(food.Portions);
        var parsed = new ParsedFood(
            Usda.Source,
            food.Id.ToString(CultureInfo.InvariantCulture),
            null,
            name,
            "g",
            kcal,
            Take(Protein) ?? 0,
            Take(Fat) ?? 0,
            available,
            measures.Serving,
            measures.Serving is null ? null : FoodMeasures.ServingLabel,
            measures.Piece,
            measures.Piece is null ? null : FoodMeasures.PieceLabel,
            Take(SaturatedFat),
            Take(Sugars),
            fiber,
            // The package has sodium only. Salt is sodium × 2.5, as EU labels count it.
            Take(Sodium) * 2.5m / 1000)
        {
            Panel = panel,
        };

        // The description is English; it is the food's own name and its English name.
        return new FoodTableRow(parsed, name, measures.Portions, []);
    }

    /// <summary>
    /// The package's measures as a serving, a piece and household measures. Each is per one of its unit
    /// ("0.5 cup" of 120 g is a cup of 240 g). The serving is the NLEA serving or one that starts with "serving"
    /// ("serving 1/4 cup" of maple syrup). The piece is the medium size, or else the first measure that names one
    /// whole thing (<see cref="Whole"/>). Weights (oz, lb) are dropped, and at most <see cref="MaxPortions"/> others
    /// are kept.
    /// </summary>
    internal static UsdaMeasures Measures(IReadOnlyList<UsdaPortion> portions)
    {
        var usable = new List<(string Label, decimal Grams)>();
        foreach (var portion in portions)
        {
            var label = Label(portion.Modifier);
            if (label is null || portion.Amount <= 0 || portion.Grams <= 0 || Weights.Contains(Head(label)))
            {
                continue;
            }

            var grams = Math.Round(portion.Grams / portion.Amount, 1);
            if (grams > 0 && !usable.Contains((label, grams)))
            {
                usable.Add((label, grams));
            }
        }

        var serving = usable.FindIndex(measure => measure.Label == "NLEA serving" || Head(measure.Label) == "serving" || Head(measure.Label).StartsWith("serving ", StringComparison.Ordinal));
        var piece = usable.FindIndex(measure => Head(measure.Label) == "medium" || Head(measure.Label).StartsWith("medium ", StringComparison.Ordinal));
        if (piece < 0)
        {
            piece = usable.FindIndex(measure => Whole.Contains(Head(measure.Label)));
        }

        var ids = new HashSet<string>(StringComparer.Ordinal);
        var rest = new List<FoodPortion>();
        for (var i = 0; i < usable.Count && rest.Count < MaxPortions; i++)
        {
            if (i == serving || i == piece)
            {
                continue;
            }

            var (label, grams) = usable[i];
            rest.Add(new FoodPortion(Id(label, ids), label, label, grams));
        }

        return new UsdaMeasures(
            serving < 0 ? null : usable[serving].Grams,
            piece < 0 ? null : usable[piece].Grams,
            rest);
    }

    internal sealed record UsdaMeasures(decimal? Serving, decimal? Piece, IReadOnlyList<FoodPortion> Portions);

    /// <summary>The foods in an SR Legacy JSON package, in the package's order.</summary>
    public static IReadOnlyList<UsdaFood> Read(ZipArchive archive)
    {
        var entries = archive.Entries.Where(entry => entry.FullName.EndsWith(".json", StringComparison.OrdinalIgnoreCase)).ToList();
        if (entries.Count != 1)
        {
            throw new InvalidOperationException(
                "The zip should hold one JSON file. Use FoodData Central's SR Legacy JSON package (FoodData_Central_sr_legacy_food_json_2018-04.zip).");
        }

        using var stream = entries[0].Open();
        var package = JsonSerializer.Deserialize<UsdaPackage>(stream, JsonOptions)
            ?? throw new InvalidOperationException("The SR Legacy package was empty.");
        if (package.Foods is null)
        {
            throw new InvalidOperationException(
                "The package has no SRLegacyFoods list. Use FoodData Central's SR Legacy JSON package, not Foundation or Branded.");
        }

        return package.Foods
            .Select(food => new UsdaFood(
                food.FdcId,
                food.Description,
                food.FoodCategory?.Description,
                (food.FoodNutrients ?? [])
                    .Where(value => value.Nutrient is not null && value.Amount is not null)
                    .GroupBy(value => value.Nutrient!.Id)
                    .ToDictionary(group => group.Key, group => group.First().Amount!.Value),
                (food.FoodPortions ?? [])
                    .Select(portion => new UsdaPortion(portion.Amount ?? 0, portion.Modifier, portion.GramWeight ?? 0))
                    .ToList()))
            .ToList();
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>The words before a comma or bracket, lower case: "medium" for "medium (7\" to 7-7/8\" long)".</summary>
    private static string Head(string label)
    {
        var end = label.IndexOfAny([',', '(']);
        return (end < 0 ? label : label[..end]).Trim().ToLowerInvariant();
    }

    private static string? Label(string? modifier)
    {
        if (string.IsNullOrWhiteSpace(modifier))
        {
            return null;
        }

        var text = string.Join(' ', modifier.Split(' ', StringSplitOptions.RemoveEmptyEntries));
        return text.Length <= 80 ? text : text[..80];
    }

    /// <summary>"cup, sliced" becomes <c>cup_sliced</c>; a repeat or one of the food's own unit ids gets a number.</summary>
    private static string Id(string label, HashSet<string> ids)
    {
        var slug = new StringBuilder();
        foreach (var character in label.ToLowerInvariant())
        {
            if (char.IsAsciiLetterOrDigit(character))
            {
                slug.Append(character);
            }
            else if (slug.Length > 0 && slug[^1] != '_')
            {
                slug.Append('_');
            }
        }

        var id = slug.ToString().Trim('_');
        id = id.Length == 0 ? "measure" : id.Length <= 32 ? id : id[..32].TrimEnd('_');
        var candidate = Taken.Contains(id) ? id + "_2" : id;
        for (var n = 3; !ids.Add(candidate); n++)
        {
            candidate = $"{id}_{n}";
        }

        return candidate;
    }

    private static string? Name(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var text = value.Trim();
        return text.Length <= 300 ? text : text[..300];
    }

    private static decimal? Sum(params decimal?[] parts) =>
        parts.Any(part => part is null) ? null : parts.Sum(part => part!.Value);

    private static decimal? Round(decimal? value) => value is null ? null : Math.Round(value.Value, 1, MidpointRounding.AwayFromZero);

    private sealed class UsdaPackage
    {
        [JsonPropertyName("SRLegacyFoods")]
        public List<UsdaJsonFood>? Foods { get; init; }
    }

    private sealed class UsdaJsonFood
    {
        public int FdcId { get; init; }

        public string? Description { get; init; }

        public UsdaJsonCategory? FoodCategory { get; init; }

        public List<UsdaJsonNutrientValue>? FoodNutrients { get; init; }

        public List<UsdaJsonPortion>? FoodPortions { get; init; }
    }

    private sealed class UsdaJsonCategory
    {
        public string? Description { get; init; }
    }

    private sealed class UsdaJsonNutrientValue
    {
        public UsdaJsonNutrient? Nutrient { get; init; }

        public decimal? Amount { get; init; }
    }

    private sealed class UsdaJsonNutrient
    {
        public int Id { get; init; }
    }

    private sealed class UsdaJsonPortion
    {
        public decimal? Amount { get; init; }

        public string? Modifier { get; init; }

        public decimal? GramWeight { get; init; }
    }
}
