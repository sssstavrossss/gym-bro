using System.Globalization;
using System.Text.Json;
using GymBro.Api.Configuration;
using Microsoft.Extensions.Options;

namespace GymBro.Api.Foods;

public sealed class OpenFoodFactsClient(HttpClient http, OpenFoodFactsGate gate, IOptions<FoodOptions> options)
    : IOpenFoodFactsClient
{
    public async Task<OffSearchOutcome> SearchAsync(string query, CancellationToken cancellationToken)
    {
        if (!gate.TryEnter())
        {
            return new OffSearchOutcome(OffStatus.RateLimited, []);
        }

        var endpoint = string.IsNullOrWhiteSpace(options.Value.OpenFoodFactsSearchUrl)
            ? FoodOptions.DefaultSearchUrl
            : options.Value.OpenFoodFactsSearchUrl;
        var address = endpoint
            + "?search_terms=" + Uri.EscapeDataString(query)
            + "&search_simple=1&action=process&json=1&page_size=10"
            + "&fields=code,product_name,product_name_en,nutriments,serving_quantity,serving_size,nutrition_data_per";

        try
        {
            using var response = await http.GetAsync(address, cancellationToken);
            if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
            {
                return new OffSearchOutcome(OffStatus.RateLimited, []);
            }

            if (!response.IsSuccessStatusCode)
            {
                return new OffSearchOutcome(OffStatus.Unavailable, []);
            }

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            var foods = OpenFoodFactsParser.Read(stream);
            return new OffSearchOutcome(OffStatus.Ok, foods);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            return new OffSearchOutcome(OffStatus.Unavailable, []);
        }
    }
}

public static class OpenFoodFactsParser
{
    public static IReadOnlyList<ParsedFood> Read(Stream json)
    {
        using var document = JsonDocument.Parse(json);
        return Read(document.RootElement);
    }

    public static IReadOnlyList<ParsedFood> Read(string json)
    {
        using var document = JsonDocument.Parse(json);
        return Read(document.RootElement);
    }

    private static IReadOnlyList<ParsedFood> Read(JsonElement root)
    {
        if (!root.TryGetProperty("products", out var products) || products.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var foods = new List<ParsedFood>();
        foreach (var product in products.EnumerateArray())
        {
            var parsed = ReadProduct(product);
            if (parsed is not null)
            {
                foods.Add(parsed);
            }
        }

        return foods;
    }

    private static ParsedFood? ReadProduct(JsonElement product)
    {
        var code = Text(product, "code");
        var name = Text(product, "product_name");
        if (string.IsNullOrWhiteSpace(name))
        {
            name = Text(product, "product_name_en");
        }

        if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        if (!product.TryGetProperty("nutriments", out var nutriments))
        {
            return null;
        }

        // Label kilocalories only. Missing kcal is skipped rather than invented from 4/9/4.
        if (!TryDecimal(nutriments, "energy-kcal_100g", out var kcal))
        {
            return null;
        }

        TryDecimal(nutriments, "proteins_100g", out var protein);
        TryDecimal(nutriments, "fat_100g", out var fat);
        TryDecimal(nutriments, "carbohydrates_100g", out var carbs);
        var basis = string.Equals(Text(product, "nutrition_data_per"), "100ml", StringComparison.OrdinalIgnoreCase)
            ? "ml"
            : "g";
        decimal? serving = null;
        if (TryDecimal(product, "serving_quantity", out var servingQuantity) && servingQuantity > 0)
        {
            serving = servingQuantity;
        }

        var servingLabel = Text(product, "serving_size");
        return new ParsedFood(
            "off",
            code.Trim(),
            code.Trim(),
            name.Trim(),
            basis,
            kcal,
            protein,
            fat,
            carbs,
            serving,
            string.IsNullOrWhiteSpace(servingLabel) ? null : servingLabel.Trim(),
            null,
            null);
    }

    private static string? Text(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            _ => null,
        };
    }

    private static bool TryDecimal(JsonElement element, string name, out decimal value)
    {
        value = 0;
        if (!element.TryGetProperty(name, out var raw))
        {
            return false;
        }

        if (raw.ValueKind == JsonValueKind.Number)
        {
            return raw.TryGetDecimal(out value);
        }

        if (raw.ValueKind == JsonValueKind.String)
        {
            return decimal.TryParse(raw.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out value);
        }

        return false;
    }
}
