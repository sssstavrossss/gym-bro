using System.Globalization;
using System.IO.Compression;
using System.Text;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Foods;

public static class OpenFoodFacts
{
    public const string Source = "off";

    public const string DumpUrl = "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz";

    public const string Citation =
        "Contains data from Open Food Facts (https://world.openfoodfacts.org), available under the Open Database License (ODbL). Product text is under the Database Contents License (DbCL).";

    public const string NorwayTag = "en:norway";

    public const decimal KilojoulesPerKilocalorie = 4.184m;

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
    int ConvertedFromKilojoules,
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
        return await ImportGzipAsync(counted, dryRun, cancellationToken);
    }

    public async Task<OffImportReport> ImportGzipAsync(Stream gzip, bool dryRun, CancellationToken cancellationToken)
    {
        await using var decompress = new GZipStream(gzip, CompressionMode.Decompress, leaveOpen: true);
        var report = await ImportCsvAsync(decompress, dryRun, compressedBytes: 0, cancellationToken);
        var bytes = gzip is CountingStream counted ? counted.Total : 0;
        return report with { CompressedBytes = bytes };
    }

    public async Task<OffImportReport> ImportCsvAsync(Stream csv, bool dryRun, long compressedBytes, CancellationToken cancellationToken)
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

        foreach (var required in new[] { "code", "product_name", "brands", "countries_tags", "proteins_100g", "fat_100g", "carbohydrates_100g" })
        {
            if (!index.ContainsKey(required))
            {
                throw new InvalidOperationException("Open Food Facts file is missing the " + required + " column.");
            }
        }

        if (!index.ContainsKey("energy-kcal_100g") && !index.ContainsKey("energy-kj_100g") && !index.ContainsKey("energy_100g"))
        {
            throw new InvalidOperationException("Open Food Facts file has no energy column.");
        }

        var hasBasisColumn = index.ContainsKey("nutrition_data_per");
        var countriesIndex = index["countries_tags"];
        var reasons = new Dictionary<string, int>(StringComparer.Ordinal);
        var accepted = new List<AcceptedOffFood>(BatchSize);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var report = new Counters();
        var complete = true;
        var now = clock.GetUtcNow();

        while (rows.MoveNext())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var row = rows.Current;
            if (row.Incomplete)
            {
                complete = false;
                Count(reasons, "truncated-file");
                break;
            }

            report.RowsRead++;
            if (report.RowsRead % 200_000 == 0)
            {
                Console.WriteLine($"Open Food Facts progress: rows={report.RowsRead} norway={report.NorwayRows} accepted={report.Accepted}.");
            }
            if (row.Fields.Count != header.Count || countriesIndex >= row.Fields.Count)
            {
                Count(reasons, "malformed-row");
                continue;
            }

            if (!HasTag(row.Fields[countriesIndex], OpenFoodFacts.NorwayTag))
            {
                continue;
            }

            var map = Field(row.Fields, index);

            report.NorwayRows++;
            var decision = Decide(map, hasBasisColumn);
            if (decision.Skip is not null)
            {
                Count(reasons, decision.Skip);
                continue;
            }

            var food = decision.Food!;
            if (!seen.Add(food.Barcode))
            {
                Count(reasons, "duplicate-barcode");
                accepted.RemoveAll(item => item.Barcode == food.Barcode);
            }

            accepted.Add(food);
            report.Accepted++;
            if (food.Basis == "ml") report.BasisMillilitres++;
            else report.BasisGrams++;
            if (food.FromKilojoules) report.ConvertedFromKilojoules++;
            else report.LabelKcal++;
            if (food.Oatly) report.OatlyAccepted++;
            if (accepted.Count >= BatchSize)
            {
                await FlushAsync(accepted, dryRun, now, report, cancellationToken);
                accepted.Clear();
            }
        }

        if (accepted.Count > 0)
        {
            await FlushAsync(accepted, dryRun, now, report, cancellationToken);
        }

        if (complete && !dryRun)
        {
            var credit = await db.FoodSourceCredits.FirstOrDefaultAsync(row => row.Source == OpenFoodFacts.Source, cancellationToken);
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
            complete,
            dryRun,
            report.Accepted,
            report.Upserted,
            reasons.Values.Sum());
        return new OffImportReport(
            complete,
            dryRun,
            report.RowsRead,
            report.NorwayRows,
            report.Accepted,
            report.Upserted,
            report.Unchanged,
            report.BasisGrams,
            report.BasisMillilitres,
            report.LabelKcal,
            report.ConvertedFromKilojoules,
            report.OatlyAccepted,
            compressedBytes,
            reasons);
    }

    public static OffDecision Decide(IReadOnlyDictionary<string, string> row, bool hasBasisColumn)
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

        var basis = BasisOf(row, hasBasisColumn);
        if (basis is null)
        {
            return OffDecision.Reject("unknown-basis");
        }

        var kcalSource = "label";
        if (!TryNumber(row, "energy-kcal_100g", out var kcal))
        {
            if (TryNumber(row, "energy-kj_100g", out var kilojoules) || TryNumber(row, "energy_100g", out kilojoules))
            {
                kcal = decimal.Round(kilojoules / OpenFoodFacts.KilojoulesPerKilocalorie, 2, MidpointRounding.AwayFromZero);
                kcalSource = "kj";
            }
            else
            {
                return OffDecision.Reject("missing-kcal");
            }
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

        return OffDecision.Accept(new AcceptedOffFood(code, name, basis, Round(kcal), Round(protein), Round(fat), Round(carbs), modified, oatly, kcalSource == "kj"));
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
            row.NameEn = null;
            row.Basis = item.Basis;
            row.NutrientBasis = NutrientBases.Per100;
            row.KcalPer100 = item.Kcal;
            row.ProteinPer100 = item.Protein;
            row.FatPer100 = item.Fat;
            row.CarbsPer100 = item.Carbs;
            row.ServingQuantity = null;
            row.ServingLabel = null;
            row.PieceQuantity = null;
            row.PieceLabel = null;
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

    private static string? BasisOf(IReadOnlyDictionary<string, string> row, bool hasBasisColumn)
    {
        if (hasBasisColumn)
        {
            var per = (row.GetValueOrDefault("nutrition_data_per") ?? "").Trim();
            if (per.Equals("100g", StringComparison.OrdinalIgnoreCase)) return "g";
            if (per.Equals("100ml", StringComparison.OrdinalIgnoreCase)) return "ml";
            return null;
        }

        var units = UnitsIn((row.GetValueOrDefault("serving_size") ?? "") + " " + (row.GetValueOrDefault("quantity") ?? ""));
        var volume = units.Overlaps(["ml", "cl", "dl", "l"]);
        var mass = units.Overlaps(["mg", "g", "kg"]);
        if (volume && !mass) return "ml";
        if (mass && !volume) return "g";
        return null;
    }

    private static HashSet<string> UnitsIn(string text)
    {
        var found = new HashSet<string>(StringComparer.Ordinal);
        var token = new StringBuilder();
        void Flush()
        {
            if (token.Length == 0)
            {
                return;
            }

            var word = token.ToString();
            if (word is "ml" or "cl" or "dl" or "l" or "mg" or "g" or "kg")
            {
                found.Add(word);
            }

            token.Clear();
        }

        foreach (var ch in text.ToLowerInvariant())
        {
            if (ch is >= 'a' and <= 'z') token.Append(ch);
            else Flush();
        }

        Flush();
        return found;
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
        public int ConvertedFromKilojoules;
        public int OatlyAccepted;
    }
}

public sealed record AcceptedOffFood(
    string Barcode,
    string Name,
    string Basis,
    decimal Kcal,
    decimal Protein,
    decimal Fat,
    decimal Carbs,
    DateTimeOffset? Modified,
    bool Oatly,
    bool FromKilojoules);

public readonly record struct OffDecision(AcceptedOffFood? Food, string? Skip)
{
    public static OffDecision Accept(AcceptedOffFood food) => new(food, null);

    public static OffDecision Reject(string reason) => new(null, reason);
}
