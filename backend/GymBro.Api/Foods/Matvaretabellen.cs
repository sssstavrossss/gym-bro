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

public sealed record MatvaretabellenImportResult(int Upserted, int Retired, int Skipped);

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
        var client = http.CreateClient("matvaretabellen");
        using var response = await client.GetAsync(url, cancellationToken);
        if (response.StatusCode != HttpStatusCode.OK)
        {
            throw new InvalidOperationException(
                "Could not download Matvaretabellen (" + (int)response.StatusCode + ").");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        return await ImportAsync(stream, cancellationToken);
    }

    public async Task<MatvaretabellenImportResult> ImportAsync(Stream json, CancellationToken cancellationToken)
    {
        var file = await JsonSerializer.DeserializeAsync<MvtFile>(json, JsonOptions, cancellationToken)
            ?? throw new InvalidOperationException("Matvaretabellen file was empty.");
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

            if (!seen.Add(parsed.SourceId))
            {
                skipped++;
                continue;
            }

            if (existing.TryGetValue(parsed.SourceId, out var row))
            {
                Copy(parsed, row);
                row.RetiredAt = null;
                row.UpdatedAt = started;
            }
            else
            {
                row = new Food
                {
                    Id = Guid.NewGuid(),
                    Source = Matvaretabellen.Source,
                    SourceId = parsed.SourceId,
                    UpdatedAt = started,
                };
                Copy(parsed, row);
                db.Foods.Add(row);
                existing[parsed.SourceId] = row;
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
        logger.LogInformation(
            "Matvaretabellen import upserted {Upserted}, retired {Retired}, skipped {Skipped}.",
            upserted,
            retired,
            skipped);
        return new MatvaretabellenImportResult(upserted, retired, skipped);
    }

    internal static ParsedFood? Map(MvtFood food)
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

        return new ParsedFood(
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
            piece?.Label);
    }

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

    private static void Copy(ParsedFood parsed, Food row)
    {
        row.UserId = null;
        row.Source = Matvaretabellen.Source;
        row.SourceId = parsed.SourceId;
        row.Barcode = parsed.Barcode;
        row.Name = parsed.Name;
        row.Basis = parsed.Basis;
        row.KcalPer100 = parsed.KcalPer100;
        row.ProteinPer100 = parsed.ProteinPer100;
        row.FatPer100 = parsed.FatPer100;
        row.CarbsPer100 = parsed.CarbsPer100;
        row.ServingQuantity = parsed.ServingQuantity;
        row.ServingLabel = parsed.ServingLabel;
        row.PieceQuantity = parsed.PieceQuantity;
        row.PieceLabel = parsed.PieceLabel;
    }

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
