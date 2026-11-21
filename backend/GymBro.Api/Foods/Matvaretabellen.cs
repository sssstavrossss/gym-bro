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

public sealed class MatvaretabellenImporter(
    FoodTableImporter tables,
    IHttpClientFactory http,
    IOptions<FoodOptions> options,
    ILogger<MatvaretabellenImporter> logger)
{
    public async Task<FoodTableImportResult> ImportOfficialAsync(CancellationToken cancellationToken)
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

    public Task<FoodTableImportResult> ImportAsync(Stream json, CancellationToken cancellationToken) =>
        ImportAsync(json, null, cancellationToken);

    public async Task<FoodTableImportResult> ImportAsync(Stream norwegian, Stream? english, CancellationToken cancellationToken)
    {
        var file = await ReadFileAsync(norwegian, cancellationToken);
        if (english is not null)
        {
            var englishFile = await ReadFileAsync(english, cancellationToken);
            ApplyEnglishNames(file, englishFile);
        }

        var rows = file.Foods.Select(food => Row(food, message =>
            logger.LogWarning("Matvaretabellen {FoodId}: {Message}", food.FoodId, message)));
        return await tables.ImportAsync(FoodSources.Matvaretabellen, rows, cancellationToken);
    }

    /// <summary>A Matvaretabellen food as a <see cref="FoodTableRow"/>, or null when it has no name or no kcal.</summary>
    internal static FoodTableRow? Row(MvtFood food, Action<string>? warn = null)
    {
        var mapped = Map(food);
        if (mapped is null)
        {
            return null;
        }

        var panel = new Food();
        NutrientPanel.ApplyMatvare(panel, Constituents(food), warn);
        var parsed = mapped.Food with { Panel = NutrientPanel.Per100(panel) };
        return new FoodTableRow(parsed, mapped.NameEn, mapped.Portions, [.. food.SearchKeywords ?? [], .. food.SearchKeywordsEn]);
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
            CleanName(food.FoodNameEn),
            Portions(food));
    }

    /// <summary>Every measure with a weight, once per id, in the file's order.</summary>
    internal static IReadOnlyList<FoodPortion> Portions(MvtFood food)
    {
        var portions = new List<FoodPortion>();
        foreach (var portion in food.Portions)
        {
            var id = portion.Id?.Trim();
            if (string.IsNullOrEmpty(id)
                || portions.Any(existing => existing.Id == id)
                || !TryQuantity(portion.Quantity, out var grams)
                || grams <= 0)
            {
                continue;
            }

            var name = string.IsNullOrWhiteSpace(portion.PortionName) ? id : portion.PortionName.Trim();
            var english = string.IsNullOrWhiteSpace(portion.PortionNameEn) ? null : portion.PortionNameEn.Trim();
            portions.Add(new FoodPortion(id, name, english, grams));
        }

        return portions;
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
        var portions = new Dictionary<string, List<MvtPortion>>(StringComparer.Ordinal);
        var keywords = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var food in english.Foods)
        {
            var id = food.FoodId?.Trim();
            var name = CleanName(food.FoodName);
            if (string.IsNullOrEmpty(id) || name is null || names.ContainsKey(id))
            {
                continue;
            }

            names[id] = name;
            portions[id] = food.Portions;
            keywords[id] = food.SearchKeywords ?? [];
        }

        foreach (var food in norwegian.Foods)
        {
            var id = food.FoodId?.Trim();
            if (id is null || !names.TryGetValue(id, out var name))
            {
                continue;
            }

            food.FoodNameEn = name;
            food.SearchKeywordsEn = keywords[id];
            foreach (var portion in food.Portions)
            {
                portion.PortionNameEn = portions[id].FirstOrDefault(other => other.Id == portion.Id)?.PortionName;
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

    internal sealed record MappedFood(ParsedFood Food, string? NameEn, IReadOnlyList<FoodPortion> Portions);

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

        /// <summary>The table's own search words: other spellings (<c>kaffi</c>), synonyms, and group words (<c>fisk</c>).</summary>
        public List<string> SearchKeywords { get; set; } = [];

        /// <summary>The English file's search words for the same food. Not in the Norwegian file.</summary>
        [System.Text.Json.Serialization.JsonIgnore]
        public List<string> SearchKeywordsEn { get; set; } = [];
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

        /// <summary>The English file's name for the same measure. Not in the Norwegian file.</summary>
        public string? PortionNameEn { get; set; }

        public JsonElement Quantity { get; set; }
    }
}
