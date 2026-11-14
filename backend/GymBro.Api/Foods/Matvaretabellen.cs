using System.Globalization;
using System.Net;
using System.Text.Json;
using GymBro.Api.Configuration;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace GymBro.Api.Foods;

public static class Matvaretabellen
{
    public const string Source = "mvt";

    public const string Citation = "Matvaretabellen 2026. Mattilsynet. www.matvaretabellen.no";
}

public sealed record MatvaretabellenImportResult(int Upserted, int Retired, int Skipped, string Coverage);

public sealed class MatvaretabellenImporter(
    AppDbContext db,
    IHttpClientFactory http,
    IOptions<FoodOptions> options,
    TimeProvider clock,
    ILogger<MatvaretabellenImporter> logger)
{
    public async Task<MatvaretabellenImportResult> ImportOfficialAsync(CancellationToken cancellationToken)
    {
        var url = string.IsNullOrWhiteSpace(options.Value.MatvaretabellenUrl)
            ? FoodOptions.DefaultMatvaretabellenUrl
            : options.Value.MatvaretabellenUrl;
        await using var norwegian = await DownloadAsync(url, "Matvaretabellen", cancellationToken);
        Stream? english = null;
        try
        {
            var englishUrl = EnglishUrl(url);
            if (englishUrl is null)
            {
                logger.LogWarning("Matvaretabellen URL has no /nb/ segment, so English names are not downloaded.");
            }
            else
            {
                english = await DownloadAsync(englishUrl, "Matvaretabellen English names", cancellationToken);
            }

            return await ImportAsync(norwegian, english, cancellationToken);
        }
        finally
        {
            if (english is not null)
            {
                await english.DisposeAsync();
            }
        }
    }

    /// <summary><c>https://…/api/nb/foods.json</c> → <c>https://…/api/en/foods.json</c>. Null when the URL has no <c>/nb/</c> segment.</summary>
    public static string? EnglishUrl(string norwegianUrl)
    {
        const string token = "/nb/";
        var index = norwegianUrl.IndexOf(token, StringComparison.OrdinalIgnoreCase);
        if (index < 0)
        {
            return null;
        }

        return string.Concat(norwegianUrl.AsSpan(0, index), "/en/", norwegianUrl.AsSpan(index + token.Length));
    }

    public Task<MatvaretabellenImportResult> ImportAsync(Stream json, CancellationToken cancellationToken) =>
        ImportAsync(json, null, cancellationToken);

    public async Task<MatvaretabellenImportResult> ImportAsync(Stream norwegian, Stream? english, CancellationToken cancellationToken)
    {
        var file = await ReadFileAsync(norwegian, cancellationToken);
        if (english is not null)
        {
            var englishFile = await ReadFileAsync(english, cancellationToken);
            ApplyEnglishNames(file, englishFile);
        }
        var started = clock.GetUtcNow();
        var existing = await db.Foods
            .Where(food => food.Source == Matvaretabellen.Source)
            .ToDictionaryAsync(food => food.SourceId, cancellationToken);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var upserted = 0;
        var skipped = 0;

        foreach (var food in file.Foods)
        {
            var parsed = Map(food);
            if (parsed is null)
            {
                skipped++;
                continue;
            }

            if (!seen.Add(parsed.Food.SourceId))
            {
                skipped++;
                continue;
            }

            if (existing.TryGetValue(parsed.Food.SourceId, out var row))
            {
                Copy(parsed, row);
                NutrientPanel.ApplyMatvare(row, Constituents(food), message =>
                    logger.LogWarning("Matvaretabellen {FoodId}: {Message}", food.FoodId, message));
                row.RetiredAt = null;
                row.UpdatedAt = started;
            }
            else
            {
                row = new Food
                {
                    Id = Guid.NewGuid(),
                    Source = Matvaretabellen.Source,
                    SourceId = parsed.Food.SourceId,
                    UpdatedAt = started,
                };
                Copy(parsed, row);
                NutrientPanel.ApplyMatvare(row, Constituents(food), message =>
                    logger.LogWarning("Matvaretabellen {FoodId}: {Message}", food.FoodId, message));
                db.Foods.Add(row);
                existing[parsed.Food.SourceId] = row;
            }

            upserted++;
        }

        var retired = 0;
        foreach (var row in existing.Values)
        {
            if (row.RetiredAt is null && !seen.Contains(row.SourceId))
            {
                row.RetiredAt = started;
                retired++;
            }
        }

        var credit = await db.FoodSourceCredits.FirstOrDefaultAsync(
            row => row.Source == Matvaretabellen.Source,
            cancellationToken);
        if (credit is null)
        {
            credit = new FoodSourceCredit { Source = Matvaretabellen.Source };
            db.FoodSourceCredits.Add(credit);
        }

        credit.Citation = Matvaretabellen.Citation;
        credit.ImportedAt = started;
        credit.FoodCount = seen.Count;
        await db.SaveChangesAsync(cancellationToken);
        var aliases = await FoodAliasCatalogue.ApplyAsync(db, cancellationToken);
        logger.LogInformation(
            "Food search aliases added {Inserted}, already present {AlreadyPresent}, explicit seeds skipped {Skipped}, catalogue foods checked {Considered}.",
            aliases.Inserted,
            aliases.AlreadyPresent,
            aliases.Skipped,
            aliases.Considered);
        logger.LogInformation(
            "Matvaretabellen import upserted {Upserted}, retired {Retired}, skipped {Skipped}.",
            upserted,
            retired,
            skipped);
        var live = existing.Values.Where(row => row.RetiredAt is null).ToList();
        var coverage = Micronutrients.CoverageLine(
            "Matvaretabellen",
            live.Count,
            live.Count(row => row.SaturatedFatPer100 is not null),
            live.Count(row => row.SugarsPer100 is not null),
            live.Count(row => row.FiberPer100 is not null),
            live.Count(row => row.SaltPer100 is not null))
            + " " + Micronutrients.PanelCoverage(live);
        return new MatvaretabellenImportResult(upserted, retired, skipped, coverage);
    }

    internal static MappedFood? Map(MvtFood food)
    {
        if (string.IsNullOrWhiteSpace(food.FoodId) || string.IsNullOrWhiteSpace(food.FoodName))
        {
            return null;
        }

        if (food.Calories is null || !string.Equals(food.Calories.Unit, "kcal", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (!TryQuantity(food.Calories.Quantity, out var kcal))
        {
            return null;
        }

        var protein = Nutrient(food, "Protein");
        var fat = Nutrient(food, "Fett");
        var carbs = Nutrient(food, "Karbo");
        var micros = Micronutrients.FromMatvare(food.Constituents.Select(constituent =>
            new MatvareConstituent(
                constituent.NutrientId,
                constituent.Unit,
                TryQuantity(constituent.Quantity, out var quantity) ? quantity : null)));
        Portion? serving = null;
        Portion? piece = null;
        foreach (var portion in food.Portions)
        {
            if (serving is null && string.Equals(portion.Id, "porsjon", StringComparison.OrdinalIgnoreCase))
            {
                serving = ToPortion(portion);
            }

            if (piece is null && string.Equals(portion.Id, "stk", StringComparison.OrdinalIgnoreCase))
            {
                piece = ToPortion(portion);
            }
        }

        if (piece is null)
        {
            foreach (var portion in food.Portions)
            {
                if (string.Equals(portion.PortionUnit, "stk", StringComparison.OrdinalIgnoreCase))
                {
                    piece = ToPortion(portion);
                    break;
                }
            }
        }

        return new MappedFood(
            new ParsedFood(
                Matvaretabellen.Source,
                food.FoodId.Trim(),
                null,
                food.FoodName.Trim(),
                "g",
                kcal,
                protein,
                fat,
                carbs,
                serving?.Grams,
                serving?.Label,
                piece?.Grams,
                piece?.Label,
                micros.SaturatedFat,
                micros.Sugars,
                micros.Fiber,
                micros.Salt),
            CleanName(food.FoodNameEn));
    }

    private static IEnumerable<MatvareConstituent> Constituents(MvtFood food) =>
        food.Constituents.Select(constituent => new MatvareConstituent(
            constituent.NutrientId,
            constituent.Unit,
            TryQuantity(constituent.Quantity, out var quantity) ? quantity : null));

    private static decimal Nutrient(MvtFood food, string id)
    {
        foreach (var constituent in food.Constituents)
        {
            if (string.Equals(constituent.NutrientId, id, StringComparison.Ordinal)
                && TryQuantity(constituent.Quantity, out var value))
            {
                return value;
            }
        }

        return 0;
    }

    private static Portion? ToPortion(MvtPortion portion)
    {
        if (!TryQuantity(portion.Quantity, out var grams) || grams <= 0)
        {
            return null;
        }

        var label = string.IsNullOrWhiteSpace(portion.PortionName) ? portion.Id : portion.PortionName.Trim();
        return new Portion(grams, label);
    }

    private static bool TryQuantity(JsonElement element, out decimal value)
    {
        value = 0;
        if (element.ValueKind == JsonValueKind.Number)
        {
            return element.TryGetDecimal(out value);
        }

        if (element.ValueKind == JsonValueKind.String)
        {
            return decimal.TryParse(element.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out value);
        }

        return false;
    }

    private static void Copy(MappedFood mapped, Food row)
    {
        var parsed = mapped.Food;
        row.UserId = null;
        row.Source = Matvaretabellen.Source;
        row.SourceId = parsed.SourceId;
        row.Barcode = parsed.Barcode;
        row.Name = parsed.Name;
        row.NameEn = mapped.NameEn;
        row.Basis = parsed.Basis;
        row.NutrientBasis = NutrientBases.Per100;
        row.KcalPer100 = parsed.KcalPer100;
        row.ProteinPer100 = parsed.ProteinPer100;
        row.FatPer100 = parsed.FatPer100;
        row.CarbsPer100 = parsed.CarbsPer100;
        row.SaturatedFatPer100 = parsed.SaturatedFatPer100;
        row.SugarsPer100 = parsed.SugarsPer100;
        row.FiberPer100 = parsed.FiberPer100;
        row.SaltPer100 = parsed.SaltPer100;
        row.ServingQuantity = parsed.ServingQuantity;
        row.ServingLabel = parsed.ServingLabel;
        row.PieceQuantity = parsed.PieceQuantity;
        row.PieceLabel = parsed.PieceLabel;
    }

    private async Task<Stream> DownloadAsync(string url, string label, CancellationToken cancellationToken)
    {
        var client = http.CreateClient("matvaretabellen");
        using var response = await client.GetAsync(url, cancellationToken);
        if (response.StatusCode != HttpStatusCode.OK)
        {
            throw new InvalidOperationException(
                "Could not download " + label + " (" + (int)response.StatusCode + ").");
        }

        var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        return new MemoryStream(bytes);
    }

    private static async Task<MvtFile> ReadFileAsync(Stream json, CancellationToken cancellationToken)
    {
        return await JsonSerializer.DeserializeAsync<MvtFile>(json, JsonOptions, cancellationToken)
            ?? throw new InvalidOperationException("Matvaretabellen file was empty.");
    }

    internal static void ApplyEnglishNames(MvtFile norwegian, MvtFile english)
    {
        var names = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var food in english.Foods)
        {
            var id = food.FoodId?.Trim();
            var name = CleanName(food.FoodName);
            if (string.IsNullOrEmpty(id) || name is null || names.ContainsKey(id))
            {
                continue;
            }

            names[id] = name;
        }

        foreach (var food in norwegian.Foods)
        {
            var id = food.FoodId?.Trim();
            if (id is not null && names.TryGetValue(id, out var name))
            {
                food.FoodNameEn = name;
            }
        }
    }

    private static string? CleanName(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length <= 300 ? trimmed : trimmed[..300];
    }

    internal sealed record MappedFood(ParsedFood Food, string? NameEn);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private sealed record Portion(decimal Grams, string? Label);

    internal sealed class MvtFile
    {
        public List<MvtFood> Foods { get; set; } = [];
    }

    internal sealed class MvtFood
    {
        public string? FoodId { get; set; }

        public string? FoodName { get; set; }

        public string? FoodNameEn { get; set; }

        public MvtCalories? Calories { get; set; }

        public List<MvtConstituent> Constituents { get; set; } = [];

        public List<MvtPortion> Portions { get; set; } = [];
    }

    internal sealed class MvtCalories
    {
        public JsonElement Quantity { get; set; }

        public string? Unit { get; set; }
    }

    internal sealed class MvtConstituent
    {
        public string? NutrientId { get; set; }

        public JsonElement Quantity { get; set; }

        public string? Unit { get; set; }
    }

    internal sealed class MvtPortion
    {
        public string? Id { get; set; }

        public string? PortionName { get; set; }

        public string? PortionUnit { get; set; }

        public JsonElement Quantity { get; set; }
    }
}
