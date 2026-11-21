using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace GymBro.Api.Foods;

/// <summary>
/// The Swedish Food Agency's food composition database (Livsmedelsdatabasen), CC BY 4.0. Read from its open API:
/// one list per language and one request per food for the nutrient values. No household measures.
/// </summary>
public static class Livsmedelsverket
{
    public const string Source = "slv";

    public const string Citation =
        "Livsmedelsdatabasen. Livsmedelsverket (Swedish Food Agency). CC BY 4.0. www.livsmedelsverket.se";

    public const string ApiUrl = "https://dataportal.livsmedelsverket.se/livsmedel/api/v1/";
}

/// <summary>One nutrient value per 100 g edible portion, keyed by its EuroFIR code (<c>PROT</c>, <c>VITD</c>).</summary>
public sealed record SlvNutrient(string? Code, string? Unit, decimal? Value);

public sealed record SlvFood(int Number, string? Name, string? NameEn, IReadOnlyList<SlvNutrient> Nutrients);

public sealed class LivsmedelsverketImporter(
    FoodTableImporter tables,
    IHttpClientFactory http,
    ILogger<LivsmedelsverketImporter> logger)
{
    /// <summary>The API refuses or drops some connections under load. Three at a time, each retried, finishes in a few minutes.</summary>
    private const int Parallel = 3;

    private const int Attempts = 5;

    public async Task<FoodTableImportResult> ImportOfficialAsync(CancellationToken cancellationToken)
    {
        var foods = await DownloadAsync(cancellationToken);
        return await ImportAsync(foods, cancellationToken);
    }

    public Task<FoodTableImportResult> ImportAsync(IReadOnlyList<SlvFood> foods, CancellationToken cancellationToken) =>
        tables.ImportAsync(
            FoodSources.Livsmedelsverket,
            foods.Select(food => Row(food, message =>
                logger.LogWarning("Livsmedelsverket {Number}: {Message}", food.Number, message))),
            cancellationToken);

    /// <summary>A food as a <see cref="FoodTableRow"/>, or null when it has no name or no kcal.</summary>
    public static FoodTableRow? Row(SlvFood food, Action<string>? warn = null)
    {
        var name = Clean(food.Name);
        var kcal = Value(food, "ENERC", "kcal");
        if (name is null || kcal is null)
        {
            return null;
        }

        decimal? Take(string code, string unit)
        {
            var value = Value(food, code, unit);
            if (value is null && food.Nutrients.Any(row => row.Code == code && row.Value is not null))
            {
                warn?.Invoke($"{code} is not in {unit}, so it is left out.");
            }

            return value;
        }

        var panel = new Dictionary<string, decimal?>
        {
            ["monoFat"] = Take("FAMS", "g"),
            ["polyFat"] = Take("FAPU", "g"),
            // The table lists single fatty acids, not omega-3 and omega-6 totals. These are the n-3 (ALA, EPA,
            // DPA, DHA) and n-6 (linoleic, arachidonic) acids it has. A missing part makes the total unknown.
            ["omega3"] = Sum(Take("F18:3", "g"), Take("F20:5", "g"), Take("F22:5", "g"), Take("F22:6", "g")),
            ["omega6"] = Sum(Take("F18:2", "g"), Take("F20:4", "g")),
            ["cholesterol"] = Take("CHORL", "mg"),
            ["addedSugars"] = Take("SUGAD", "g"),
            ["sodium"] = Take("NA", "mg"),
            // Retinol equivalents, the same unit as Matvaretabellen's "Vit A RE".
            ["vitaminA"] = Take("VITA", "RE/ug"),
            ["vitaminD"] = Take("VITD", "ug"),
            ["vitaminE"] = Take("VITE", "mg"),
            ["thiamin"] = Take("THIACLHCL", "mg"),
            ["riboflavin"] = Take("RIBF", "mg"),
            ["niacin"] = Take("NIAEQ", "NE/mg") ?? Take("NIA", "mg"),
            ["vitaminB6"] = Take("VITB6", "mg"),
            ["folate"] = Take("FOL", "ug"),
            ["vitaminB12"] = Take("VITB12", "ug"),
            ["vitaminC"] = Take("VITC", "mg"),
            ["calcium"] = Take("CA", "mg"),
            ["iron"] = Take("FE", "mg"),
            ["zinc"] = Take("ZN", "mg"),
            ["magnesium"] = Take("MG", "mg"),
            ["potassium"] = Take("K", "mg"),
            ["phosphorus"] = Take("P", "mg"),
            ["selenium"] = Take("SE", "ug"),
            ["iodine"] = Take("ID", "ug"),
            ["epaDha"] = Sum(Take("F20:5", "g"), Take("F22:6", "g")),
        };

        var parsed = new ParsedFood(
            Livsmedelsverket.Source,
            food.Number.ToString(System.Globalization.CultureInfo.InvariantCulture),
            null,
            name,
            "g",
            kcal.Value,
            Take("PROT", "g") ?? 0,
            Take("FAT", "g") ?? 0,
            Take("CHO", "g") ?? 0,
            null,
            null,
            null,
            null,
            Take("FASAT", "g"),
            Take("SUGAR", "g"),
            Take("FIBT", "g"),
            Take("NACL", "g"))
        {
            Panel = panel,
        };
        return new FoodTableRow(parsed, Clean(food.NameEn), [], []);
    }

    private static decimal? Value(SlvFood food, string code, string unit)
    {
        foreach (var row in food.Nutrients)
        {
            if (row.Code == code && string.Equals(Unit(row.Unit), unit, StringComparison.OrdinalIgnoreCase))
            {
                return row.Value is >= 0 ? row.Value : null;
            }
        }

        return null;
    }

    /// <summary>"µg" may be written with the micro sign or the Greek letter mu. Both become <c>ug</c>.</summary>
    private static string Unit(string? unit) =>
        (unit ?? "").Trim().Replace('µ', 'u').Replace('μ', 'u');

    private static decimal? Sum(params decimal?[] parts) =>
        parts.Any(part => part is null) ? null : parts.Sum(part => part!.Value);

    private static string? Clean(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length <= 300 ? trimmed : trimmed[..300];
    }

    private async Task<IReadOnlyList<SlvFood>> DownloadAsync(CancellationToken cancellationToken)
    {
        var client = http.CreateClient("livsmedelsverket");
        var swedish = await ListAsync(client, 1, cancellationToken);
        var english = (await ListAsync(client, 2, cancellationToken))
            .GroupBy(item => item.Nummer)
            .ToDictionary(group => group.Key, group => group.First().Namn);
        logger.LogInformation("Livsmedelsverket lists {Count} foods. Reading their nutrient values.", swedish.Count);

        var foods = new SlvFood[swedish.Count];
        using var gate = new SemaphoreSlim(Parallel);
        await Task.WhenAll(swedish.Select(async (item, index) =>
        {
            await gate.WaitAsync(cancellationToken);
            try
            {
                var values = await GetAsync<List<SlvValueJson>>(client, $"livsmedel/{item.Nummer}/naringsvarden?sprak=2", cancellationToken);
                foods[index] = new SlvFood(
                    item.Nummer,
                    item.Namn,
                    english.GetValueOrDefault(item.Nummer),
                    values.Select(value => new SlvNutrient(value.EuroFirKod?.Trim(), value.Enhet, value.Varde)).ToList());
            }
            finally
            {
                gate.Release();
            }
        }));
        return foods;
    }

    /// <summary><paramref name="language"/> 1 is Swedish, 2 is English.</summary>
    private async Task<List<SlvListItemJson>> ListAsync(HttpClient client, int language, CancellationToken cancellationToken)
    {
        const int page = 1000;
        var items = new List<SlvListItemJson>();
        while (true)
        {
            var list = await GetAsync<SlvListJson>(client, $"livsmedel?offset={items.Count}&limit={page}&sprak={language}", cancellationToken);
            items.AddRange(list.Livsmedel);
            if (list.Livsmedel.Count == 0 || items.Count >= list.Meta.TotalRecords)
            {
                return items;
            }
        }
    }

    private async Task<T> GetAsync<T>(HttpClient client, string path, CancellationToken cancellationToken)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                using var response = await client.GetAsync(path, cancellationToken);
                if (response.StatusCode == HttpStatusCode.OK)
                {
                    return await response.Content.ReadFromJsonAsync<T>(cancellationToken)
                        ?? throw new InvalidOperationException("Livsmedelsverket sent an empty answer for " + path + ".");
                }

                if (attempt >= Attempts || ((int)response.StatusCode < 500 && response.StatusCode != HttpStatusCode.TooManyRequests))
                {
                    throw new InvalidOperationException($"Could not download Livsmedelsverket {path} ({(int)response.StatusCode}).");
                }
            }
            catch (Exception ex) when ((ex is HttpRequestException or TaskCanceledException) && !cancellationToken.IsCancellationRequested && attempt < Attempts)
            {
                logger.LogDebug(ex, "Livsmedelsverket {Path} failed, try {Attempt}.", path, attempt);
            }

            await Task.Delay(TimeSpan.FromSeconds(2 * attempt), cancellationToken);
        }
    }

    private sealed class SlvListJson
    {
        [JsonPropertyName("_meta")]
        public SlvMetaJson Meta { get; set; } = new();

        public List<SlvListItemJson> Livsmedel { get; set; } = [];
    }

    private sealed class SlvMetaJson
    {
        public int TotalRecords { get; set; }
    }

    private sealed class SlvListItemJson
    {
        public int Nummer { get; set; }

        public string? Namn { get; set; }
    }

    private sealed class SlvValueJson
    {
        [JsonPropertyName("euroFIRkod")]
        public string? EuroFirKod { get; set; }

        public string? Enhet { get; set; }

        public decimal? Varde { get; set; }
    }
}
