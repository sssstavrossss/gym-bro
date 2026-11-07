using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Foods;

public static class FoodCatalog
{
    public const int SearchLimit = 25;

    /// <summary>Enough words for a food name. More than this is rejected so a keystroke cannot build an unbounded predicate.</summary>
    public const int MaxSearchTokens = 8;

    public static IQueryable<Food> Visible(IQueryable<Food> foods, string userId) =>
        foods.Where(food => food.RetiredAt == null && (food.UserId == null || food.UserId == userId));

    public static async Task<List<Food>> SearchAsync(
        AppDbContext db,
        string userId,
        string query,
        CancellationToken cancellationToken)
    {
        var normalized = FoodAliasCatalogue.Normalize(query);
        var tokens = normalized.Length == 0
            ? []
            : normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var digits = query.Length > 0 && query.All(char.IsAsciiDigit);
        if (tokens.Length == 0)
        {
            if (!digits)
            {
                return [];
            }

            return await Visible(db.Foods.AsNoTracking(), userId)
                .Where(food => food.Barcode == query)
                .OrderBy(food => food.Name)
                .Take(SearchLimit)
                .ToListAsync(cancellationToken);
        }

        // Every token must hit the same string: the Norwegian name, the English name, or one alias.
        // Earlier tokens are whole words. The last token may be the start of a word, so "chicken br"
        // matches "chicken breast" without also matching every food that contains only one of those words.
        var args = new List<object>();
        string Take() => "{" + (args.Count - 1) + "}";
        string Add(object value)
        {
            args.Add(value);
            return Take();
        }

        var userParam = Add(userId);
        var queryParam = Add(query);
        var normalizedParam = Add(normalized);
        var prefixParam = Add(normalized + "%");
        var digitParam = Add(digits);
        var tokenParams = tokens.Select((token, index) =>
            Add(index == tokens.Length - 1 ? "% " + token + "%" : "% " + token + " %")).ToArray();
        var lastWholeParam = Add("% " + tokens[^1] + " %");

        const string scrub = "' ' || regexp_replace(lower(coalesce({0}, '')), '[^[:alnum:]æøåÆØÅ]+', ' ', 'g') || ' '";
        var namePad = string.Format(scrub, "f.name");
        var enPad = string.Format(scrub, "f.name_en");
        var aliasPad = string.Format(scrub, "a.normalized");
        string All(string pad) => string.Join(" AND ", tokenParams.Select(param => pad + " ILIKE " + param));
        var rankName = "btrim(regexp_replace(lower(coalesce(f.name, '')), '[^[:alnum:]æøåÆØÅ]+', ' ', 'g'))";
        var rankEn = "btrim(regexp_replace(lower(coalesce(f.name_en, '')), '[^[:alnum:]æøåÆØÅ]+', ' ', 'g'))";

        var sql = $"""
            SELECT f.id AS "Value"
            FROM foods AS f
            WHERE f.retired_at IS NULL
              AND (f.user_id IS NULL OR f.user_id = {userParam})
              AND (
                ({digitParam} AND f.barcode = {queryParam})
                OR ({All(namePad)})
                OR ({All(enPad)})
                OR EXISTS (
                  SELECT 1 FROM food_aliases AS a
                  WHERE a.source = f.source
                    AND a.source_id = f.source_id
                    AND a.expected_name_en = f.name_en
                    AND {All(aliasPad)}
                )
              )
            ORDER BY CASE
              WHEN ({digitParam} AND f.barcode = {queryParam})
                OR {rankName} = {normalizedParam}
                OR {rankEn} = {normalizedParam}
                OR EXISTS (
                  SELECT 1 FROM food_aliases AS a
                  WHERE a.source = f.source AND a.source_id = f.source_id AND a.expected_name_en = f.name_en
                    AND a.normalized = {normalizedParam}
                ) THEN 0
              WHEN {rankName} ILIKE {prefixParam}
                OR {rankEn} ILIKE {prefixParam}
                OR EXISTS (
                  SELECT 1 FROM food_aliases AS a
                  WHERE a.source = f.source AND a.source_id = f.source_id AND a.expected_name_en = f.name_en
                    AND a.normalized ILIKE {prefixParam}
                ) THEN 1
              WHEN {namePad} ILIKE {lastWholeParam}
                OR {enPad} ILIKE {lastWholeParam}
                OR EXISTS (
                  SELECT 1 FROM food_aliases AS a
                  WHERE a.source = f.source AND a.source_id = f.source_id AND a.expected_name_en = f.name_en
                    AND {aliasPad} ILIKE {lastWholeParam}
                ) THEN 2
              ELSE 3
            END, f.name, f.source
            LIMIT {SearchLimit}
            """;

        var orderedIds = await db.Database.SqlQueryRaw<Guid>(sql, args.ToArray()).ToListAsync(cancellationToken);
        if (orderedIds.Count == 0)
        {
            return [];
        }

        var rows = await db.Foods.AsNoTracking().Where(food => orderedIds.Contains(food.Id)).ToListAsync(cancellationToken);
        var byId = rows.ToDictionary(food => food.Id);
        return orderedIds.Where(byId.ContainsKey).Select(id => byId[id]).ToList();
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
            row.NutrientBasis = NutrientBases.Per100;
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

        var words = FoodAliasCatalogue.Normalize(trimmed).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (words.Length > MaxSearchTokens)
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
