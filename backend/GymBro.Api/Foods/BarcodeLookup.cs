using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Foods;

/// <summary>How a barcode lookup ended. <c>Food</c> is set only when <see cref="Status"/> is <c>found</c>.</summary>
public sealed record BarcodeOutcome(string Status, Food? Food)
{
    public const string Found = "found";
    public const string NotFound = "not_found";
    public const string RateLimited = "rate_limited";
    public const string Unavailable = "unavailable";
}

/// <summary>
/// Finds the food behind a scanned or typed barcode: the person's own food first, then the catalogue,
/// then Open Food Facts, whose product is stored as a catalogue row so the next scan finds it here.
/// The scanner works the same from a web page or a native app, because the decision is made here.
/// </summary>
public static class BarcodeLookup
{
    /// <summary>EAN-8 is the shortest retail code and GTIN-14 the longest.</summary>
    public const int MinLength = 8;

    public const int MaxLength = 14;

    /// <summary>The code with spaces and dashes taken out, or null when it isn't 8 to 14 digits.</summary>
    public static string? Normalize(string? code)
    {
        var digits = new string((code ?? "").Where(ch => ch is not (' ' or '-')).ToArray());
        return digits.Length is >= MinLength and <= MaxLength && digits.All(char.IsAsciiDigit) ? digits : null;
    }

    /// <summary>
    /// The spellings one product can be stored under. A UPC-A code (12 digits) is the same product as the
    /// EAN-13 with a leading zero, and the imports keep codes as written, so both are tried.
    /// </summary>
    public static IReadOnlyList<string> Candidates(string code)
    {
        List<string> codes = [code];
        if (code.Length == 12)
        {
            codes.Add("0" + code);
        }
        else if (code.Length == 13 && code[0] == '0')
        {
            codes.Add(code[1..]);
        }

        return codes;
    }

    public static async Task<BarcodeOutcome> FindAsync(
        AppDbContext db,
        IOpenFoodFactsClient off,
        TimeProvider clock,
        string userId,
        string code,
        CancellationToken cancellationToken)
    {
        var local = await FindLocalAsync(db, userId, Candidates(code), cancellationToken);
        if (local is not null)
        {
            return new BarcodeOutcome(BarcodeOutcome.Found, local);
        }

        var outcome = await off.GetProductAsync(code, cancellationToken);
        if (outcome.Status == OffStatus.RateLimited)
        {
            return new BarcodeOutcome(BarcodeOutcome.RateLimited, null);
        }

        if (outcome.Status != OffStatus.Ok)
        {
            return new BarcodeOutcome(BarcodeOutcome.Unavailable, null);
        }

        if (outcome.Food is not { } product)
        {
            return new BarcodeOutcome(BarcodeOutcome.NotFound, null);
        }

        var ids = await FoodCatalog.UpsertCatalogAsync(db, [product], clock, cancellationToken);
        var stored = ids.TryGetValue(product.SourceId, out var id)
            ? await db.Foods.AsNoTracking().FirstOrDefaultAsync(food => food.Id == id, cancellationToken)
            : null;
        return stored is null
            ? new BarcodeOutcome(BarcodeOutcome.NotFound, null)
            : new BarcodeOutcome(BarcodeOutcome.Found, stored);
    }

    /// <summary>
    /// One food for the code. The person's own food wins, so a food they made for a product they scanned
    /// before beats the catalogue. Then numbers known to be per 100 g or ml (Open Food Facts) beat a
    /// Kassalapp row whose basis is unconfirmed. Then the newest row, then the name, so the pick is stable.
    /// </summary>
    private static async Task<Food?> FindLocalAsync(
        AppDbContext db,
        string userId,
        IReadOnlyList<string> codes,
        CancellationToken cancellationToken) =>
        await FoodCatalog.Visible(db.Foods.AsNoTracking(), userId)
            .Where(food => food.Barcode != null && codes.Contains(food.Barcode))
            .OrderBy(food => food.UserId == null)
            .ThenBy(food => food.NutrientBasis != NutrientBases.Per100)
            .ThenByDescending(food => food.UpdatedAt)
            .ThenBy(food => food.Name)
            .ThenBy(food => food.Id)
            .FirstOrDefaultAsync(cancellationToken);
}
