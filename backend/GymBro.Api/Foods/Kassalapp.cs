using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Foods;

public static class Kassalapp
{
    public const string Source = "kassalapp";

    public const string Citation =
        "Product names and nutrition from Kassalapp (https://kassal.app). The API terms describe a free personal non-commercial key at 60 requests a minute and suggest a 6 hour cache. They do not say whether a stored catalogue is allowed. This import does not call the API.";

    public const decimal MaxKcal = 2000m;

    public const decimal MaxMacro = 150m;
}

public sealed record KassalappImportReport(
    bool Complete,
    bool DryRun,
    int RowsRead,
    int Accepted,
    int Upserted,
    int Unchanged,
    int Reconfirm,
    string Sha256,
    IReadOnlyDictionary<string, int> SkipReasons);

public sealed class KassalappImporter(AppDbContext db, TimeProvider clock, ILogger<KassalappImporter> logger)
{
    public const int BatchSize = 200;

    /// <summary>One kept listing per EAN. Past this, stop rather than grow without a bound.</summary>
    public const int MaxEans = 400_000;

    public Task<KassalappImportReport> ImportFileAsync(Stream file, CancellationToken cancellationToken) =>
        ImportFileAsync(file, dryRun: false, cancellationToken);

    public async Task<KassalappImportReport> ImportFileAsync(Stream file, bool dryRun, CancellationToken cancellationToken)
    {
        using var hashing = new HashingStream(file);
        using var reader = new StreamReader(hashing);
        var complete = true;
        var rows = new Dictionary<string, ListingState>(StringComparer.Ordinal);
        var reasons = new Dictionary<string, int>(StringComparer.Ordinal);
        var pending = new StringBuilder();
        var sawLine = false;
        while (true)
        {
            var raw = await reader.ReadLineAsync(cancellationToken);
            if (raw is null)
            {
                break;
            }

            sawLine = true;
            if (pending.Length == 0 && raw.Trim().Length == 0)
            {
                continue;
            }

            pending.Append(raw);
            var chunk = pending.ToString().Trim();
            if (chunk.Length == 0)
            {
                pending.Clear();
                continue;
            }

            try
            {
                using var document = JsonDocument.Parse(chunk);
                ReadDocument(document.RootElement, rows, reasons);
                pending.Clear();
                if (rows.Count > MaxEans)
                {
                    complete = false;
                    Count(reasons, "too-many-eans");
                    break;
                }
            }
            catch (JsonException)
            {
                if (pending.Length > 32 * 1024 * 1024)
                {
                    complete = false;
                    Count(reasons, "truncated-file");
                    break;
                }

                pending.Append('\n');
            }
        }

        if (!sawLine || pending.Length > 0)
        {
            if (!sawLine)
            {
                throw new InvalidOperationException("Kassalapp file was empty.");
            }

            complete = false;
            Count(reasons, "truncated-file");
        }

        var accepted = new List<AcceptedListing>();
        foreach (var state in rows.Values)
        {
            if (state.Conflict)
            {
                Count(reasons, "conflicting-nutrition");
                continue;
            }

            if (state.Chosen is null)
            {
                Count(reasons, "nutrition-incomplete");
                continue;
            }

            accepted.Add(state.Chosen);
        }

        var report = new Counters { RowsRead = reasons.GetValueOrDefault("rows") };
        var now = clock.GetUtcNow();
        if (!dryRun)
        {
            for (var index = 0; index < accepted.Count; index += BatchSize)
            {
                var slice = accepted.Skip(index).Take(BatchSize).ToList();
                await FlushAsync(slice, now, report, cancellationToken);
            }
        }

        if (complete && !dryRun)
        {
            var credit = await db.FoodSourceCredits.FirstOrDefaultAsync(row => row.Source == Kassalapp.Source, cancellationToken);
            if (credit is null)
            {
                credit = new FoodSourceCredit { Source = Kassalapp.Source };
                db.FoodSourceCredits.Add(credit);
            }

            credit.Citation = Kassalapp.Citation;
            credit.ImportedAt = now;
            credit.FoodCount = await db.Foods.CountAsync(
                food => food.Source == Kassalapp.Source && food.RetiredAt == null,
                cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
        }

        logger.LogInformation(
            "Kassalapp import complete={Complete} accepted={Accepted} upserted={Upserted}.",
            complete,
            accepted.Count,
            report.Upserted);
        return new KassalappImportReport(
            complete,
            dryRun,
            report.RowsRead,
            accepted.Count,
            report.Upserted,
            report.Unchanged,
            report.Reconfirm,
            Convert.ToHexString(hashing.Hash()).ToLowerInvariant(),
            reasons);
    }

    public static string Stamp(decimal kcal, decimal protein, decimal fat, decimal carbs) =>
        string.Create(CultureInfo.InvariantCulture, $"{kcal:0.00}|{protein:0.00}|{fat:0.00}|{carbs:0.00}");

    public static string Stamp(Food food) => Stamp(food.KcalPer100, food.ProteinPer100, food.FatPer100, food.CarbsPer100);

    private async Task FlushAsync(List<AcceptedListing> batch, DateTimeOffset now, Counters report, CancellationToken cancellationToken)
    {
        var ids = batch.Select(item => item.Ean).ToArray();
        var existing = await db.Foods
            .Where(food => food.Source == Kassalapp.Source && food.UserId == null && ids.Contains(food.SourceId))
            .ToDictionaryAsync(food => food.SourceId, cancellationToken);
        foreach (var item in batch)
        {
            if (!existing.TryGetValue(item.Ean, out var row))
            {
                row = new Food
                {
                    Id = Guid.NewGuid(),
                    Source = Kassalapp.Source,
                    SourceId = item.Ean,
                    UserId = null,
                };
                db.Foods.Add(row);
                existing[item.Ean] = row;
                report.Upserted++;
            }
            else if (Same(row, item))
            {
                report.Unchanged++;
                continue;
            }
            else
            {
                if (Stamp(row) != item.Stamp)
                {
                    report.Reconfirm++;
                }

                report.Upserted++;
            }

            row.Barcode = item.Ean;
            row.Name = item.Name;
            row.Basis = null;
            row.NutrientBasis = NutrientBases.Unconfirmed;
            row.KcalPer100 = item.Kcal;
            row.ProteinPer100 = item.Protein;
            row.FatPer100 = item.Fat;
            row.CarbsPer100 = item.Carbs;
            row.RetiredAt = null;
            row.UpdatedAt = item.Updated ?? now;
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private static bool Same(Food row, AcceptedListing item) =>
        row.Barcode == item.Ean
        && row.Name == item.Name
        && row.NutrientBasis == NutrientBases.Unconfirmed
        && row.Basis is null
        && row.KcalPer100 == item.Kcal
        && row.ProteinPer100 == item.Protein
        && row.FatPer100 == item.Fat
        && row.CarbsPer100 == item.Carbs
        && row.RetiredAt is null;

    private static void ReadDocument(JsonElement root, Dictionary<string, ListingState> rows, Dictionary<string, int> reasons)
    {
        if (root.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in root.EnumerateArray())
            {
                ReadDocument(item, rows, reasons);
            }

            return;
        }

        if (root.ValueKind != JsonValueKind.Object)
        {
            Count(reasons, "malformed-row");
            return;
        }

        if (root.TryGetProperty("data", out var data))
        {
            ReadDocument(data, rows, reasons);
            return;
        }

        if (root.TryGetProperty("products", out var products) && products.ValueKind == JsonValueKind.Array)
        {
            var ean = Ean(root);
            foreach (var product in products.EnumerateArray())
            {
                Consider(product, ean, rows, reasons);
            }

            return;
        }

        Consider(root, Ean(root), rows, reasons);
    }

    private static void Consider(JsonElement product, string? parentEan, Dictionary<string, ListingState> rows, Dictionary<string, int> reasons)
    {
        if (product.ValueKind != JsonValueKind.Object)
        {
            Count(reasons, "malformed-row");
            return;
        }

        Count(reasons, "rows");
        var ean = Ean(product) ?? parentEan;
        if (ean is null)
        {
            Count(reasons, "bad-barcode");
            return;
        }

        if (!rows.TryGetValue(ean, out var state))
        {
            state = new ListingState();
            rows[ean] = state;
        }

        if (!TryNutrition(product, out var kcal, out var protein, out var fat, out var carbs))
        {
            if (state.Chosen is null && !state.Conflict)
            {
                state.Incomplete = true;
            }

            return;
        }

        var stamp = Stamp(kcal, protein, fat, carbs);
        var updated = Updated(product);
        var name = DisplayName(Text(product, "brand"), Text(product, "name"));
        if (name.Length == 0)
        {
            Count(reasons, "missing-name");
            return;
        }

        var listing = new AcceptedListing(ean, Trim(name), kcal, protein, fat, carbs, stamp, updated);
        if (state.Conflict && (state.ChosenAt is null || updated is null || updated <= state.ChosenAt))
        {
            return;
        }

        if (state.Chosen is null || state.ChosenAt is null || (updated is not null && updated > state.ChosenAt))
        {
            state.Chosen = listing;
            state.ChosenAt = updated;
            state.Conflict = false;
            state.Incomplete = false;
            return;
        }

        if (updated == state.ChosenAt && state.Chosen.Stamp != stamp)
        {
            state.Chosen = null;
            state.Conflict = true;
        }
    }

    private static bool TryNutrition(JsonElement product, out decimal kcal, out decimal protein, out decimal fat, out decimal carbs)
    {
        kcal = protein = fat = carbs = 0;
        if (!product.TryGetProperty("nutrition", out var nutrition) || nutrition.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        decimal? energy = null;
        decimal? proteinValue = null;
        decimal? fatValue = null;
        decimal? carbValue = null;
        foreach (var item in nutrition.EnumerateArray())
        {
            var code = Text(item, "code").ToLowerInvariant();
            var unit = Text(item, "unit").ToLowerInvariant();
            if (!TryAmount(item, out var amount) || amount < 0)
            {
                return false;
            }

            if (code is "energi_kcal" or "energy_kcal")
            {
                if (unit is not ("kcal" or "kalori" or "kalorier"))
                {
                    return false;
                }

                energy = amount;
            }
            else if (code == "protein" && unit == "g")
            {
                proteinValue = amount;
            }
            else if ((code is "fett_totalt" or "fat") && unit == "g")
            {
                fatValue = amount;
            }
            else if ((code is "karbohydrater" or "carbohydrates") && unit == "g")
            {
                carbValue = amount;
            }
        }

        if (energy is null || proteinValue is null || fatValue is null || carbValue is null)
        {
            return false;
        }

        if (energy > Kassalapp.MaxKcal || proteinValue > Kassalapp.MaxMacro || fatValue > Kassalapp.MaxMacro || carbValue > Kassalapp.MaxMacro)
        {
            return false;
        }

        kcal = decimal.Round(energy.Value, 2, MidpointRounding.AwayFromZero);
        protein = decimal.Round(proteinValue.Value, 2, MidpointRounding.AwayFromZero);
        fat = decimal.Round(fatValue.Value, 2, MidpointRounding.AwayFromZero);
        carbs = decimal.Round(carbValue.Value, 2, MidpointRounding.AwayFromZero);
        return true;
    }

    private static bool TryAmount(JsonElement item, out decimal amount)
    {
        amount = 0;
        if (!item.TryGetProperty("amount", out var value))
        {
            return false;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out amount))
        {
            return true;
        }

        return value.ValueKind == JsonValueKind.String
            && decimal.TryParse(value.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out amount);
    }

    private static DateTimeOffset? Updated(JsonElement product)
    {
        foreach (var name in new[] { "updated_at", "updatedAt" })
        {
            if (product.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
                && DateTimeOffset.TryParse(value.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed))
            {
                return parsed;
            }
        }

        if (product.TryGetProperty("current_price", out var price) && price.ValueKind == JsonValueKind.Object
            && price.TryGetProperty("date", out var date) && date.ValueKind == JsonValueKind.String
            && DateTimeOffset.TryParse(date.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var priceDate))
        {
            return priceDate;
        }

        return null;
    }

    private static string? Ean(JsonElement element)
    {
        if (!element.TryGetProperty("ean", out var value) || value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var text = (value.GetString() ?? "").Trim();
        if (text.Length is < 1 or > 32 || text.Any(ch => !char.IsAsciiDigit(ch)))
        {
            return null;
        }

        return text;
    }

    private static string Text(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String)
        {
            return "";
        }

        return (value.GetString() ?? "").Trim();
    }

    private static string DisplayName(string brand, string name)
    {
        if (name.Length == 0)
        {
            return brand;
        }

        if (brand.Length == 0 || name.StartsWith(brand, StringComparison.OrdinalIgnoreCase))
        {
            return name;
        }

        return brand + " " + name;
    }

    private static string Trim(string value) => value.Length <= 300 ? value : value[..300];

    private static void Count(Dictionary<string, int> reasons, string reason)
    {
        reasons[reason] = reasons.GetValueOrDefault(reason) + 1;
    }

    private sealed class HashingStream(Stream inner) : Stream
    {
        private readonly IncrementalHash hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);

        public byte[] Hash() => hash.GetHashAndReset();

        public override bool CanRead => inner.CanRead;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => inner.Length;
        public override long Position { get => inner.Position; set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));

        public override int Read(Span<byte> buffer)
        {
            var read = inner.Read(buffer);
            if (read > 0)
            {
                hash.AppendData(buffer[..read]);
            }

            return read;
        }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            var read = await inner.ReadAsync(buffer, cancellationToken);
            if (read > 0)
            {
                hash.AppendData(buffer.Span[..read]);
            }

            return read;
        }
    }

    private sealed class ListingState
    {
        public AcceptedListing? Chosen;
        public DateTimeOffset? ChosenAt;
        public bool Conflict;
        public bool Incomplete;
    }

    private sealed record AcceptedListing(
        string Ean,
        string Name,
        decimal Kcal,
        decimal Protein,
        decimal Fat,
        decimal Carbs,
        string Stamp,
        DateTimeOffset? Updated);

    private sealed class Counters
    {
        public int RowsRead;
        public int Upserted;
        public int Unchanged;
        public int Reconfirm;
    }
}
