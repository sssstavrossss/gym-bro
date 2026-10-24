using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Foods;

public static class FoodCatalog
{
    public const int SearchLimit = 25;

    public static IQueryable<Food> Visible(IQueryable<Food> foods, string userId) =>
        foods.Where(food => food.RetiredAt == null && (food.UserId == null || food.UserId == userId));

    public static async Task<List<Food>> SearchAsync(
        AppDbContext db,
        string userId,
        string query,
        CancellationToken cancellationToken)
    {
        var pattern = ContainsPattern(query);
        var digits = query.All(char.IsAsciiDigit);
        return await Visible(db.Foods.AsNoTracking(), userId)
            .Where(food =>
                EF.Functions.ILike(food.Name, pattern, "\\")
                || (digits && food.Barcode == query))
            .OrderBy(food => food.Name)
            .ThenBy(food => food.Source)
            .Take(SearchLimit)
            .ToListAsync(cancellationToken);
    }

    public static async Task<IReadOnlyDictionary<string, Guid>> UpsertCatalogAsync(
        AppDbContext db,
        IReadOnlyList<ParsedFood> foods,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (foods.Count == 0)
        {
            return new Dictionary<string, Guid>();
        }

        var source = foods[0].Source;
        var ids = foods.Select(food => food.SourceId).Distinct().ToArray();
        var existing = await db.Foods
            .Where(food => food.Source == source && food.UserId == null && ids.Contains(food.SourceId))
            .ToDictionaryAsync(food => food.SourceId, cancellationToken);
        var now = clock.GetUtcNow();
        foreach (var parsed in foods)
        {
            if (parsed.Source != "off" || string.IsNullOrWhiteSpace(parsed.SourceId))
            {
                continue;
            }

            if (!existing.TryGetValue(parsed.SourceId, out var row))
            {
                row = new Food
                {
                    Id = Guid.NewGuid(),
                    Source = "off",
                    SourceId = parsed.SourceId,
                };
                db.Foods.Add(row);
                existing[parsed.SourceId] = row;
            }

            row.UserId = null;
            row.Barcode = parsed.Barcode;
            row.Name = Trim(parsed.Name, 300);
            row.Basis = parsed.Basis == "ml" ? "ml" : "g";
            row.KcalPer100 = parsed.KcalPer100;
            row.ProteinPer100 = parsed.ProteinPer100;
            row.FatPer100 = parsed.FatPer100;
            row.CarbsPer100 = parsed.CarbsPer100;
            row.ServingQuantity = parsed.ServingQuantity;
            row.ServingLabel = TrimOrNull(parsed.ServingLabel, 80);
            row.PieceQuantity = parsed.PieceQuantity;
            row.PieceLabel = TrimOrNull(parsed.PieceLabel, 80);
            row.RetiredAt = null;
            row.UpdatedAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
        return existing.ToDictionary(pair => pair.Key, pair => pair.Value.Id);
    }

    public static string? ValidateQuery(string? query)
    {
        var trimmed = (query ?? "").Trim();
        if (trimmed.Length < 2)
        {
            return "Type at least 2 letters.";
        }

        if (trimmed.Length > 80)
        {
            return "That search is too long.";
        }

        return null;
    }

    public static string ContainsPattern(string query)
    {
        var escaped = query.Trim()
            .Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal);
        return "%" + escaped + "%";
    }

    private static string Trim(string value, int max) =>
        value.Length <= max ? value : value[..max];

    private static string? TrimOrNull(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length <= max ? trimmed : trimmed[..max];
    }
}
