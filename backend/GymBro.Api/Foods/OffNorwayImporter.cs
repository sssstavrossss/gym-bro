using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Foods;

public static class OpenFoodFacts
{
    public const string Source = "off";

    /// <summary>Nightly product export. Each line is one product and includes <c>nutrition_data_per</c>.</summary>
    public const string DumpUrl = "https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz";

    /// <summary>The CSV export has no <c>nutrition_data_per</c> column. It is not the Norway import.</summary>
    public const string CsvDumpUrl = "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz";

    public const string Citation =
        "Contains data from Open Food Facts (https://world.openfoodfacts.org), available under the Open Database License (ODbL). Product text is under the Database Contents License (DbCL).";

    public const string NorwayTag = "en:norway";

    public const decimal MaxKcalPer100 = 1000m;

    public const decimal MaxMacroPer100Grams = 100m;

    public const decimal MaxMacroPer100Millilitres = 150m;
}

public sealed record OffImportReport(
    bool Complete,
    bool DryRun,
    int RowsRead,
    int NorwayRows,
    int Accepted,
    int Upserted,
    int Unchanged,
    int BasisGrams,
    int BasisMillilitres,
    int LabelKcal,
    int OatlyAccepted,
    long CompressedBytes,
    IReadOnlyDictionary<string, int> SkipReasons);

public sealed class OffNorwayImporter(AppDbContext db, TimeProvider clock, ILogger<OffNorwayImporter> logger, IHttpClientFactory http)
{
    public const int BatchSize = 200;

    public async Task<OffImportReport> ImportOfficialAsync(bool dryRun, CancellationToken cancellationToken)
    {
        var client = http.CreateClient("openfoodfacts-bulk");
        using var response = await client.GetAsync(OpenFoodFacts.DumpUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException("Open Food Facts download failed (" + (int)response.StatusCode + ").");
        }

        await using var network = await response.Content.ReadAsStreamAsync(cancellationToken);
        var counted = new CountingStream(network);
        return await ImportJsonlGzipAsync(counted, dryRun, cancellationToken);
    }

    public async Task<OffImportReport> ImportJsonlGzipAsync(Stream gzip, bool dryRun, CancellationToken cancellationToken)
    {
        await using var decompress = new GZipStream(gzip, CompressionMode.Decompress, leaveOpen: true);
        var report = await ImportJsonlAsync(decompress, dryRun, compressedBytes: 0, cancellationToken);
        var bytes = gzip is CountingStream counted ? counted.Total : 0;
        return report with { CompressedBytes = bytes };
    }

    public async Task<OffImportReport> ImportGzipAsync(Stream gzip, bool dryRun, CancellationToken cancellationToken)
    {
        await using var decompress = new GZipStream(gzip, CompressionMode.Decompress, leaveOpen: true);
        var report = await ImportCsvAsync(decompress, dryRun, compressedBytes: 0, cancellationToken);
        var bytes = gzip is CountingStream counted ? counted.Total : 0;
        return report with { CompressedBytes = bytes };
    }

    public async Task<OffImportReport> ImportJsonlAsync(Stream jsonl, bool dryRun, long compressedBytes, CancellationToken cancellationToken, int batchSize = BatchSize)
    {
        using var reader = new StreamReader(jsonl, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, bufferSize: 1024 * 64, leaveOpen: true);
        var batch = new ImportBatch(this, db, clock, logger, dryRun, batchSize, cancellationToken);
        while (true)
        {
            string? line;
            try
            {
                line = await reader.ReadLineAsync(cancellationToken);
            }
            catch (Exception ex) when (ex is IOException or InvalidDataException)
            {
                batch.Complete = false;
                Count(batch.Reasons, "truncated-file");
                break;
            }

            if (line is null)
            {
                break;
            }

            if (line.Length == 0)
            {
                continue;
            }

            batch.Report.RowsRead++;
            if (batch.Report.RowsRead % 200_000 == 0)
            {
                Console.WriteLine($"Open Food Facts progress: rows={batch.Report.RowsRead} norway={batch.Report.NorwayRows} accepted={batch.KeptCount}.");
            }

            JsonDocument document;
            try
            {
                document = JsonDocument.Parse(line);
            }
            catch (JsonException)
            {
                Count(batch.Reasons, "malformed-row");
                continue;
            }

            using (document)
            {
                var mapped = MapProduct(document.RootElement);
                if (!mapped.Norway)
                {
                    continue;
                }

                batch.Report.NorwayRows++;
                await batch.AddAsync(mapped.Fields);
            }
        }

        return await batch.FinishAsync(compressedBytes);
    }

    public async Task<OffImportReport> ImportCsvAsync(Stream csv, bool dryRun, long compressedBytes, CancellationToken cancellationToken, int batchSize = BatchSize)
    {
        using var reader = new StreamReader(csv, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, bufferSize: 1024 * 64, leaveOpen: true);
        var rows = QuotedTsv.Read(reader).GetEnumerator();
        if (!rows.MoveNext())
        {
            throw new InvalidOperationException("Open Food Facts file had no header.");
        }

        if (rows.Current.Incomplete)
        {
            throw new InvalidOperationException("Open Food Facts header was cut off.");
        }

        var header = rows.Current.Fields;
        var index = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i < header.Count; i++)
        {
            if (!index.ContainsKey(header[i]))
            {
                index[header[i]] = i;
            }
        }

        foreach (var required in new[] { "code", "product_name", "brands", "countries_tags", "nutrition_data_per", "energy-kcal_100g", "proteins_100g", "fat_100g", "carbohydrates_100g" })
        {
            if (!index.ContainsKey(required))
            {
                throw new InvalidOperationException("Open Food Facts file is missing the " + required + " column.");
            }
        }

        var countriesIndex = index["countries_tags"];
        var batch = new ImportBatch(this, db, clock, logger, dryRun, batchSize, cancellationToken);

        while (rows.MoveNext())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var row = rows.Current;
            if (row.Incomplete)
            {
                batch.Complete = false;
                Count(batch.Reasons, "truncated-file");
                break;
            }

            batch.Report.RowsRead++;
            if (batch.Report.RowsRead % 200_000 == 0)
            {
                Console.WriteLine($"Open Food Facts progress: rows={batch.Report.RowsRead} norway={batch.Report.NorwayRows} accepted={batch.KeptCount}.");
            }
            if (row.Fields.Count != header.Count || countriesIndex >= row.Fields.Count)
            {
                Count(batch.Reasons, "malformed-row");
                continue;
            }

            if (!HasTag(row.Fields[countriesIndex], OpenFoodFacts.NorwayTag))
            {
                continue;
            }

            batch.Report.NorwayRows++;
            await batch.AddAsync(Field(row.Fields, index));
        }

        return await batch.FinishAsync(compressedBytes);
    }

    public static OffDecision Decide(IReadOnlyDictionary<string, string> row)
    {
        var code = (row.GetValueOrDefault("code") ?? "").Trim();
        if (code.Length is < 1 or > 32 || code.Any(ch => !char.IsAsciiDigit(ch)))
        {
            return OffDecision.Reject("bad-barcode");
        }

        var product = (row.GetValueOrDefault("product_name") ?? "").Trim();
        if (product.Length == 0)
        {
            return OffDecision.Reject("missing-name");
        }

        var basis = BasisOf(row);
        if (basis is null)
        {
            return OffDecision.Reject("unknown-basis");
        }

        if (!TryNumber(row, "energy-kcal_100g", out var kcal))
        {
            return OffDecision.Reject("missing-kcal");
        }

        if (!TryNumber(row, "proteins_100g", out var protein)
            || !TryNumber(row, "fat_100g", out var fat)
            || !TryNumber(row, "carbohydrates_100g", out var carbs))
        {
            return OffDecision.Reject("missing-macro");
        }

        if (kcal < 0 || protein < 0 || fat < 0 || carbs < 0)
        {
            return OffDecision.Reject("negative");
        }

        if (kcal > OpenFoodFacts.MaxKcalPer100)
        {
            return OffDecision.Reject("kcal-out-of-range");
        }

        var macroLimit = basis == "ml" ? OpenFoodFacts.MaxMacroPer100Millilitres : OpenFoodFacts.MaxMacroPer100Grams;
        if (protein > macroLimit || fat > macroLimit || carbs > macroLimit)
        {
            return OffDecision.Reject("macro-out-of-range");
        }

        if (basis == "g" && protein + fat + carbs > OpenFoodFacts.MaxMacroPer100Grams + 5)
        {
            return OffDecision.Reject("macros-over-100g");
        }

        var brand = (row.GetValueOrDefault("brands") ?? "").Trim();
        var name = DisplayName(brand, product);
        var oatly = brand.Contains("oatly", StringComparison.OrdinalIgnoreCase)
            || product.Contains("oatly", StringComparison.OrdinalIgnoreCase)
            || (row.GetValueOrDefault("brands_tags") ?? "").Contains("oatly", StringComparison.OrdinalIgnoreCase);
        DateTimeOffset? modified = null;
        if (long.TryParse(row.GetValueOrDefault("last_modified_t"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var unix) && unix > 0)
        {
            modified = DateTimeOffset.FromUnixTimeSeconds(unix);
        }

        return OffDecision.Accept(new AcceptedOffFood(code, name, basis, Round(kcal), Round(protein), Round(fat), Round(carbs), modified, oatly));
    }

    private async Task FlushAsync(List<AcceptedOffFood> batch, bool dryRun, DateTimeOffset now, Counters report, CancellationToken cancellationToken)
    {
        if (dryRun)
        {
            return;
        }

        var ids = batch.Select(item => item.Barcode).ToArray();
        var existing = await db.Foods
            .Where(food => food.Source == OpenFoodFacts.Source && food.UserId == null && ids.Contains(food.SourceId))
            .ToDictionaryAsync(food => food.SourceId, cancellationToken);
        foreach (var item in batch)
        {
            if (!existing.TryGetValue(item.Barcode, out var row))
            {
                row = new Food
                {
                    Id = Guid.NewGuid(),
                    Source = OpenFoodFacts.Source,
                    SourceId = item.Barcode,
                    UserId = null,
                };
                db.Foods.Add(row);
                existing[item.Barcode] = row;
                report.Upserted++;
            }
            else if (Same(row, item))
            {
                report.Unchanged++;
                continue;
            }
            else
            {
                report.Upserted++;
            }

            row.Barcode = item.Barcode;
            row.Name = item.Name;
            row.Basis = item.Basis;
            row.NutrientBasis = NutrientBases.Per100;
            row.KcalPer100 = item.Kcal;
            row.ProteinPer100 = item.Protein;
            row.FatPer100 = item.Fat;
            row.CarbsPer100 = item.Carbs;
            // The bulk feed does not carry the English name or the serving and piece sizes
            // stored by a product lookup. Leave those fields as they are.
            row.RetiredAt = null;
            row.UpdatedAt = item.Modified ?? now;
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private static bool Same(Food row, AcceptedOffFood item) =>
        row.Barcode == item.Barcode
        && row.Name == item.Name
        && row.Basis == item.Basis
        && row.NutrientBasis == NutrientBases.Per100
        && row.KcalPer100 == item.Kcal
        && row.ProteinPer100 == item.Protein
        && row.FatPer100 == item.Fat
        && row.CarbsPer100 == item.Carbs
        && row.RetiredAt is null;

    private static bool HasTag(string tags, string expected)
    {
        foreach (var tag in tags.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            if (string.Equals(tag, expected, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    private static string? BasisOf(IReadOnlyDictionary<string, string> row)
    {
        var per = (row.GetValueOrDefault("nutrition_data_per") ?? "").Trim();
        if (per.Equals("100g", StringComparison.OrdinalIgnoreCase)) return "g";
        if (per.Equals("100ml", StringComparison.OrdinalIgnoreCase)) return "ml";
        return null;
    }

    public static MappedOffProduct MapProduct(JsonElement product)
    {
        var fields = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["code"] = JsonText(product, "code"),
            ["product_name"] = JsonText(product, "product_name"),
            ["brands"] = JsonText(product, "brands"),
            ["brands_tags"] = TagList(product, "brands_tags"),
            ["countries_tags"] = TagList(product, "countries_tags"),
            ["nutrition_data_per"] = JsonText(product, "nutrition_data_per"),
            ["last_modified_t"] = JsonText(product, "last_modified_t"),
        };
        if (product.TryGetProperty("nutriments", out var nutriments) && nutriments.ValueKind == JsonValueKind.Object)
        {
            fields["energy-kcal_100g"] = JsonText(nutriments, "energy-kcal_100g");
            fields["proteins_100g"] = JsonText(nutriments, "proteins_100g");
            fields["fat_100g"] = JsonText(nutriments, "fat_100g");
            fields["carbohydrates_100g"] = JsonText(nutriments, "carbohydrates_100g");
        }

        return new MappedOffProduct(HasTag(fields["countries_tags"], OpenFoodFacts.NorwayTag), fields);
    }

    public static MappedOffProduct MapProduct(string json)
    {
        using var document = JsonDocument.Parse(json);
        return MapProduct(document.RootElement);
    }

    private static string JsonText(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value))
        {
            return "";
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? "",
            JsonValueKind.Number => value.GetRawText(),
            _ => "",
        };
    }

    private static string TagList(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value))
        {
            return "";
        }

        if (value.ValueKind == JsonValueKind.String)
        {
            return value.GetString() ?? "";
        }

        if (value.ValueKind != JsonValueKind.Array)
        {
            return "";
        }

        var tags = new List<string>();
        foreach (var item in value.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && item.GetString() is { Length: > 0 } tag)
            {
                tags.Add(tag);
            }
        }

        return string.Join(',', tags);
    }

    private static bool TryNumber(IReadOnlyDictionary<string, string> row, string name, out decimal value)
    {
        value = 0;
        var text = (row.GetValueOrDefault(name) ?? "").Trim();
        if (text.Length == 0)
        {
            return false;
        }

        return decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out value);
    }

    private static decimal Round(decimal value) => decimal.Round(value, 2, MidpointRounding.AwayFromZero);

    public static string DisplayName(string? brand, string product)
    {
        brand = Collapse(brand);
        product = Collapse(product);
        if (brand.Length == 0)
        {
            return Trim(product);
        }

        if (product.StartsWith(brand, StringComparison.OrdinalIgnoreCase))
        {
            return Trim(product);
        }

        return Trim(brand + " " + product);
    }

    private static string Collapse(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "";
        }

        var parts = value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        return string.Join(' ', parts);
    }

    private static string Trim(string value) => value.Length <= 300 ? value : value[..300];

    private static Dictionary<string, string> Field(IReadOnlyList<string> fields, Dictionary<string, int> index)
    {
        var map = new Dictionary<string, string>(index.Count, StringComparer.Ordinal);
        foreach (var pair in index)
        {
            map[pair.Key] = pair.Value < fields.Count ? fields[pair.Value] : "";
        }

        return map;
    }

    private sealed class CountingStream(Stream inner) : Stream
    {
        public long Total { get; private set; }

        public override bool CanRead => inner.CanRead;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => inner.Length;
        public override long Position { get => Total; set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count)
        {
            var read = inner.Read(buffer, offset, count);
            Total += read;
            return read;
        }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            var read = await inner.ReadAsync(buffer, cancellationToken);
            Total += read;
            return read;
        }
    }

    private static void Count(Dictionary<string, int> reasons, string reason)
    {
        reasons[reason] = reasons.GetValueOrDefault(reason) + 1;
    }

    private sealed class Counters
    {
        public int RowsRead;
        public int NorwayRows;
        public int Accepted;
        public int Upserted;
        public int Unchanged;
        public int BasisGrams;
        public int BasisMillilitres;
        public int LabelKcal;
        public int OatlyAccepted;
    }

    private sealed class ImportBatch(
        OffNorwayImporter importer,
        AppDbContext db,
        TimeProvider clock,
        ILogger logger,
        bool dryRun,
        int batchSize,
        CancellationToken cancellationToken)
    {
        public Counters Report { get; } = new();

        public Dictionary<string, int> Reasons { get; } = new(StringComparer.Ordinal);

        public bool Complete { get; set; } = true;

        public int KeptCount => kept.Count;

        private readonly Dictionary<string, AcceptedOffFood> kept = new(StringComparer.Ordinal);

        private readonly DateTimeOffset now = clock.GetUtcNow();

        public Task AddAsync(IReadOnlyDictionary<string, string> row)
        {
            var decision = Decide(row);
            if (decision.Skip is not null)
            {
                Count(Reasons, decision.Skip);
                return Task.CompletedTask;
            }

            var food = decision.Food!;
            if (!kept.TryAdd(food.Barcode, food))
            {
                Count(Reasons, "duplicate-barcode");
                kept[food.Barcode] = food;
            }

            return Task.CompletedTask;
        }

        public async Task<OffImportReport> FinishAsync(long compressedBytes)
        {
            // One write per barcode, the last copy in the file. Writing each batch as it arrives
            // would store an earlier copy and then replace it, so a repeated run would not stay still.
            var final = kept.Values.ToList();
            for (var index = 0; index < final.Count; index += batchSize)
            {
                var slice = final.Skip(index).Take(batchSize).ToList();
                await importer.FlushAsync(slice, dryRun, now, Report, cancellationToken);
            }

            Report.Accepted = kept.Count;
            Report.BasisGrams = kept.Values.Count(item => item.Basis == "g");
            Report.BasisMillilitres = kept.Values.Count(item => item.Basis == "ml");
            Report.LabelKcal = kept.Count;
            Report.OatlyAccepted = kept.Values.Count(item => item.Oatly);

            if (Complete && !dryRun)
            {
                var credit = await db.FoodSourceCredits.FirstOrDefaultAsync(
                    row => row.Source == OpenFoodFacts.Source,
                    cancellationToken);
                if (credit is null)
                {
                    credit = new FoodSourceCredit { Source = OpenFoodFacts.Source };
                    db.FoodSourceCredits.Add(credit);
                }

                credit.Citation = OpenFoodFacts.Citation;
                credit.ImportedAt = now;
                credit.FoodCount = await db.Foods.CountAsync(
                    food => food.Source == OpenFoodFacts.Source && food.UserId == null && food.RetiredAt == null,
                    cancellationToken);
                await db.SaveChangesAsync(cancellationToken);
            }

            logger.LogInformation(
                "Open Food Facts Norway import complete={Complete} dryRun={DryRun} accepted={Accepted} upserted={Upserted} skippedNorway={Skipped}.",
                Complete,
                dryRun,
                Report.Accepted,
                Report.Upserted,
                Reasons.Values.Sum());
            return new OffImportReport(
                Complete,
                dryRun,
                Report.RowsRead,
                Report.NorwayRows,
                Report.Accepted,
                Report.Upserted,
                Report.Unchanged,
                Report.BasisGrams,
                Report.BasisMillilitres,
                Report.LabelKcal,
                Report.OatlyAccepted,
                compressedBytes,
                Reasons);
        }
    }
}

public readonly record struct MappedOffProduct(bool Norway, Dictionary<string, string> Fields);

public sealed record AcceptedOffFood(
    string Barcode,
    string Name,
    string Basis,
    decimal Kcal,
    decimal Protein,
    decimal Fat,
    decimal Carbs,
    DateTimeOffset? Modified,
    bool Oatly);

public readonly record struct OffDecision(AcceptedOffFood? Food, string? Skip)
{
    public static OffDecision Accept(AcceptedOffFood food) => new(food, null);

    public static OffDecision Reject(string reason) => new(null, reason);
}
