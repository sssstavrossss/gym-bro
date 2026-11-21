using System.Globalization;
using System.IO.Compression;
using System.Text;

namespace GymBro.Api.Foods;

/// <summary>
/// Fineli, the Finnish food composition database (THL), CC BY 4.0. Read from its open-data package, a zip of
/// semicolon-separated Latin-1 files. The download sits behind a bot check, so the zip is fetched by hand and
/// passed to <c>--import-fineli --file</c>. Use the 74-component package: it has every food and the full panel.
/// </summary>
public static class Fineli
{
    public const string Source = "fineli";

    public const string Citation =
        "Fineli. Finnish food composition database. Release 20. Finnish Institute for Health and Welfare (THL). CC BY 4.0. www.fineli.fi";
}

/// <summary>One value per 100 g edible portion, keyed by its EuroFIR code (<c>PROT</c>, <c>VITD</c>), in the package's unit.</summary>
public sealed record FineliValue(string Code, string Unit, decimal? Value);

/// <summary>A food from the package: Finnish and English names, values, and household measures in grams by unit code.</summary>
public sealed record FineliFood(
    int Id,
    string? Name,
    string? NameEn,
    IReadOnlyList<FineliValue> Values,
    IReadOnlyDictionary<string, decimal> Measures);

public sealed class FineliImporter(FoodTableImporter tables, ILogger<FineliImporter> logger)
{
    /// <summary>The package's measure codes as household measures. The medium portion and piece become the serving and piece.</summary>
    private static readonly IReadOnlyList<(string Code, string Id, string Name, string NameEn)> Measures =
    [
        ("PORTS", "portion_small", "pieni annos", "small portion"),
        ("PORTL", "portion_large", "iso annos", "large portion"),
        ("KPL_S", "piece_small", "pieni (kpl)", "small piece"),
        ("KPL_L", "piece_large", "iso (kpl)", "large piece"),
        ("KPL_VALM", "piece_pack", "valmistaja (kpl)", "piece (pack size)"),
        ("DL", "dl", "desilitra", "decilitre"),
        ("RKL", "tbsp", "ruokalusikka", "tablespoon"),
        ("TL", "tsp", "teelusikka", "teaspoon"),
    ];

    public async Task<FoodTableImportResult> ImportFileAsync(Stream zip, CancellationToken cancellationToken)
    {
        using var archive = new ZipArchive(zip, ZipArchiveMode.Read);
        var foods = Read(archive);
        logger.LogInformation("Fineli package lists {Count} foods.", foods.Count);
        return await tables.ImportAsync(
            FoodSources.Fineli,
            foods.Select(food => Row(food, message => logger.LogWarning("Fineli {Id}: {Message}", food.Id, message))),
            cancellationToken);
    }

    /// <summary>A food as a <see cref="FoodTableRow"/>, or null when it has no name or no energy.</summary>
    public static FoodTableRow? Row(FineliFood food, Action<string>? warn = null)
    {
        var name = Name(food.Name);
        var kilojoules = Value(food, "ENERC", "KJ");
        if (name is null || kilojoules is null)
        {
            return null;
        }

        decimal? Take(string code, string unit)
        {
            var value = Value(food, code, unit);
            if (value is null && food.Values.Any(row => row.Code == code && row.Value is not null))
            {
                warn?.Invoke($"{code} is not in {unit}, so it is left out.");
            }

            return value;
        }

        var panel = new Dictionary<string, decimal?>
        {
            ["monoFat"] = Take("FAMCIS", "G"),
            ["polyFat"] = Take("FAPU", "G"),
            ["omega3"] = Take("FAPUN3", "G"),
            ["omega6"] = Take("FAPUN6", "G"),
            ["transFat"] = Take("FATRN", "G"),
            ["cholesterol"] = Take("CHOLE", "MG"),
            ["sodium"] = Take("NA", "MG"),
            // The panel stores retinol equivalents, Matvaretabellen's unit. Fineli's VITA is retinol activity
            // equivalents, which count beta-carotene at half the weight, so RE is rebuilt as retinol + beta-carotene / 6.
            // Other provitamin carotenoids are left out, which reads slightly low for some vegetables.
            ["vitaminA"] = Sum(Take("RETOL", "UG"), Take("CARTB", "UG") / 6),
            ["vitaminD"] = Take("VITD", "UG"),
            ["vitaminE"] = Take("VITE", "MG"),
            ["thiamin"] = Take("THIA", "MG"),
            ["riboflavin"] = Take("RIBF", "MG"),
            ["niacin"] = Take("NIAEQ", "MG") ?? Take("NIA", "MG"),
            ["vitaminB6"] = Take("VITPYRID", "MG"),
            ["folate"] = Take("FOL", "UG"),
            ["vitaminB12"] = Take("VITB12", "UG"),
            ["vitaminC"] = Take("VITC", "MG"),
            ["calcium"] = Take("CA", "MG"),
            ["iron"] = Take("FE", "MG"),
            ["zinc"] = Take("ZN", "MG"),
            ["magnesium"] = Take("MG", "MG"),
            ["potassium"] = Take("K", "MG"),
            ["phosphorus"] = Take("P", "MG"),
            ["selenium"] = Take("SE", "UG"),
            ["iodine"] = Take("ID", "UG"),
            ["copper"] = Take("CU", "MG"),
            ["starch"] = Take("STARCH", "G"),
            // The package lists single fatty acids in mg.
            ["epaDha"] = Sum(Take("F20D5N3", "MG"), Take("F22D6N3", "MG")) / 1000,
        };

        var serving = food.Measures.GetValueOrDefault("PORTM");
        var piece = food.Measures.GetValueOrDefault("KPL_M");
        var parsed = new ParsedFood(
            Fineli.Source,
            food.Id.ToString(CultureInfo.InvariantCulture),
            null,
            name,
            "g",
            Math.Round(kilojoules.Value / 4.184m, 1),
            Take("PROT", "G") ?? 0,
            Take("FAT", "G") ?? 0,
            // Available carbohydrate, without fibre, as Matvaretabellen and Livsmedelsverket count it.
            Take("CHOAVL", "G") ?? 0,
            serving > 0 ? serving : null,
            serving > 0 ? "portion" : null,
            piece > 0 ? piece : null,
            piece > 0 ? "piece" : null,
            Take("FASAT", "G"),
            Take("SUGAR", "G"),
            Take("FIBC", "G"),
            Take("NACL", "MG") / 1000)
        {
            Panel = panel,
        };

        var portions = Measures
            .Where(measure => food.Measures.GetValueOrDefault(measure.Code) > 0)
            .Select(measure => new FoodPortion(measure.Id, measure.Name, measure.NameEn, food.Measures[measure.Code]))
            .ToList();
        return new FoodTableRow(parsed, Name(food.NameEn), portions, []);
    }

    /// <summary>The foods in a Fineli open-data package, in the package's order.</summary>
    public static IReadOnlyList<FineliFood> Read(ZipArchive archive)
    {
        var units = Rows(archive, "component.csv").ToDictionary(row => row[0], row => row[1], StringComparer.Ordinal);
        var english = Rows(archive, "foodname_EN.csv").ToDictionary(row => row[0], row => row[1], StringComparer.Ordinal);
        var values = Rows(archive, "component_value.csv")
            .GroupBy(row => row[0], StringComparer.Ordinal)
            .ToDictionary(
                group => group.Key,
                group => group.Select(row => new FineliValue(row[1], units.GetValueOrDefault(row[1], ""), Number(row[2]))).ToList(),
                StringComparer.Ordinal);
        var measures = Rows(archive, "foodaddunit.csv")
            .Where(row => Number(row[2]) is > 0)
            .GroupBy(row => row[0], StringComparer.Ordinal)
            .ToDictionary(
                group => group.Key,
                group => (IReadOnlyDictionary<string, decimal>)group
                    .GroupBy(row => row[1], StringComparer.Ordinal)
                    .ToDictionary(unit => unit.Key, unit => Number(unit.First()[2])!.Value, StringComparer.Ordinal),
                StringComparer.Ordinal);

        var foods = new List<FineliFood>();
        foreach (var row in Rows(archive, "food.csv"))
        {
            if (!int.TryParse(row[0], NumberStyles.None, CultureInfo.InvariantCulture, out var id))
            {
                continue;
            }

            foods.Add(new FineliFood(
                id,
                row[1],
                english.GetValueOrDefault(row[0]),
                values.GetValueOrDefault(row[0]) ?? [],
                measures.GetValueOrDefault(row[0]) ?? new Dictionary<string, decimal>()));
        }

        return foods;
    }

    /// <summary>A file's rows after the header, split on semicolons. The package has no quoting.</summary>
    private static IEnumerable<string[]> Rows(ZipArchive archive, string file)
    {
        var entry = archive.GetEntry(file)
            ?? throw new InvalidOperationException($"The Fineli package has no {file}. Use the open-data zip with 74 components.");
        using var reader = new StreamReader(entry.Open(), Encoding.Latin1);
        reader.ReadLine();
        while (reader.ReadLine() is { } line)
        {
            if (line.Length > 0)
            {
                yield return line.Split(';');
            }
        }
    }

    /// <summary>Values use a decimal comma ("1698,30"). An empty value is unknown.</summary>
    private static decimal? Number(string text) =>
        decimal.TryParse(text.Replace(',', '.'), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var value)
            ? value
            : null;

    private static decimal? Value(FineliFood food, string code, string unit)
    {
        foreach (var row in food.Values)
        {
            if (row.Code == code && string.Equals(row.Unit, unit, StringComparison.OrdinalIgnoreCase))
            {
                return row.Value;
            }
        }

        return null;
    }

    private static decimal? Sum(decimal? first, decimal? second) => first is null || second is null ? null : first + second;

    /// <summary>
    /// The package writes names in capitals ("RICE, BOILED, SALT"). They are stored in sentence case, the way the
    /// other tables write theirs ("Rice, boiled, salt"). A brand loses its capitals ("Fazer" becomes "fazer").
    /// </summary>
    internal static string? Name(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var lower = value.Trim().ToLower(CultureInfo.InvariantCulture);
        var text = char.ToUpper(lower[0], CultureInfo.InvariantCulture) + lower[1..];
        return text.Length <= 300 ? text : text[..300];
    }
}
