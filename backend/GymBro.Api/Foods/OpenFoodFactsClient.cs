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
        var endpoint = string.IsNullOrWhiteSpace(options.Value.OpenFoodFactsSearchUrl)
            ? FoodOptions.DefaultSearchUrl
            : options.Value.OpenFoodFactsSearchUrl;
        var address = endpoint
            + "?search_terms=" + Uri.EscapeDataString(query)
            + "&search_simple=1&action=process&json=1&page_size=10"
            + "&fields=code,product_name,product_name_en,nutriments,serving_quantity,serving_size,nutrition_data_per";
        var fetched = await FetchJson(address, cancellationToken);
        if (fetched.Status != OffStatus.Ok || fetched.Json is null)
        {
            return new OffSearchOutcome(fetched.Status, []);
        }

        using (fetched.Json)
        {
            var report = OpenFoodFactsParser.ReadReport(fetched.Json.RootElement);
            return new OffSearchOutcome(OffStatus.Ok, report.Foods, report.MissingKcal);
        }
    }

    public async Task<OffProductOutcome> GetProductAsync(string code, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            return new OffProductOutcome(OffStatus.Unavailable, null);
        }

        var root = string.IsNullOrWhiteSpace(options.Value.OpenFoodFactsProductUrl)
            ? FoodOptions.DefaultProductUrl
            : options.Value.OpenFoodFactsProductUrl;
        var address = root.TrimEnd('/')
            + "/"
            + Uri.EscapeDataString(code.Trim())
            + ".json?fields=code,product_name,product_name_en,nutriments,serving_quantity,serving_size,nutrition_data_per";
        var fetched = await FetchJson(address, cancellationToken);
        if (fetched.Status != OffStatus.Ok || fetched.Json is null)
        {
            return new OffProductOutcome(fetched.Status, null);
        }

        using (fetched.Json)
        {
            var report = OpenFoodFactsParser.ReadProductDocument(fetched.Json.RootElement);
            return new OffProductOutcome(OffStatus.Ok, report.Foods.Count == 0 ? null : report.Foods[0]);
        }
    }

    private async Task<(OffStatus Status, JsonDocument? Json)> FetchJson(string address, CancellationToken cancellationToken)
    {
        if (!gate.TryEnter())
        {
            return (OffStatus.RateLimited, null);
        }

        try
        {
            // Headers first, so a huge body is never buffered before the cap is applied.
            using var response = await http.GetAsync(address, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            var code = (int)response.StatusCode;
            if (code is >= 300 and < 400)
            {
                return (OffStatus.Unavailable, null);
            }

            if (response.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
            {
                return (OffStatus.RateLimited, null);
            }

            if (!response.IsSuccessStatusCode)
            {
                return (OffStatus.Unavailable, null);
            }

            if (response.Content.Headers.ContentLength is long advertised && advertised > MaxResponseBytes)
            {
                return (OffStatus.Unavailable, null);
            }

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            await using var capped = new CappedReadStream(stream, MaxResponseBytes);
            var document = await JsonDocument.ParseAsync(capped, cancellationToken: cancellationToken);
            return (OffStatus.Ok, document);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or IOException)
        {
            return (OffStatus.Unavailable, null);
        }
    }

    /// <summary>2 MiB. Larger Open Food Facts bodies are treated as unavailable.</summary>
    public const int MaxResponseBytes = 2_097_152;

    /// <summary>
    /// The handler the app and the tests share. Redirects are not followed:
    /// a 3xx is <see cref="OffStatus.Unavailable"/> and the Location is never requested.
    /// </summary>
    public static SocketsHttpHandler CreateHandler() => new()
    {
        AllowAutoRedirect = false,
        PooledConnectionLifetime = TimeSpan.FromMinutes(2),
    };

    private sealed class CappedReadStream(Stream inner, int max) : Stream
    {
        private int _total;

        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override void Flush()
        {
        }

        public override int Read(byte[] buffer, int offset, int count) => Count(inner.Read(buffer, offset, count));

        public override int Read(Span<byte> buffer) => Count(inner.Read(buffer));

        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            return ReadLimitedAsync(buffer, cancellationToken);
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        private async ValueTask<int> ReadLimitedAsync(Memory<byte> buffer, CancellationToken cancellationToken)
        {
            var read = await inner.ReadAsync(buffer, cancellationToken);
            return Count(read);
        }

        private int Count(int read)
        {
            if (read <= 0)
            {
                return read;
            }

            _total += read;
            if (_total > max)
            {
                throw new IOException("Open Food Facts response exceeded the size cap.");
            }

            return read;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                inner.Dispose();
            }

            base.Dispose(disposing);
        }
    }
}

public static class OpenFoodFactsParser
{
    public static IReadOnlyList<ParsedFood> Read(Stream json) => ReadReport(json).Foods;

    public static IReadOnlyList<ParsedFood> Read(string json) => ReadReport(json).Foods;

    public static OffParse ReadReport(Stream json)
    {
        using var document = JsonDocument.Parse(json);
        return ReadReport(document.RootElement);
    }

    public static OffParse ReadReport(string json)
    {
        using var document = JsonDocument.Parse(json);
        return ReadReport(document.RootElement);
    }

    public static OffParse ReadReport(JsonElement root)
    {
        if (!root.TryGetProperty("products", out var products) || products.ValueKind != JsonValueKind.Array)
        {
            return new OffParse([], 0);
        }

        var foods = new List<ParsedFood>();
        var missing = 0;
        foreach (var product in products.EnumerateArray())
        {
            if (MissingLabelKcal(product))
            {
                missing++;
            }

            var parsed = ReadProduct(product);
            if (parsed is not null)
            {
                foods.Add(parsed);
            }
        }

        return new OffParse(foods, missing);
    }

    public static OffParse ReadProductDocument(JsonElement root)
    {
        if (!root.TryGetProperty("product", out var product) || product.ValueKind != JsonValueKind.Object)
        {
            return new OffParse([], 0);
        }

        var parsed = ReadProduct(product);
        var missing = parsed is null && MissingLabelKcal(product) ? 1 : 0;
        return new OffParse(parsed is null ? [] : [parsed], missing);
    }

    /// <summary>
    /// A named product with no label kilocalories. Those stay out of the catalogue.
    /// Calories are never filled in from protein, fat, and carbs.
    /// </summary>
    private static bool MissingLabelKcal(JsonElement product)
    {
        var code = Text(product, "code");
        var name = Text(product, "product_name");
        if (string.IsNullOrWhiteSpace(name))
        {
            name = Text(product, "product_name_en");
        }

        if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(name))
        {
            return false;
        }

        if (!product.TryGetProperty("nutriments", out var nutriments) || nutriments.ValueKind != JsonValueKind.Object)
        {
            return true;
        }

        return !TryDecimal(nutriments, "energy-kcal_100g", out _);
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
