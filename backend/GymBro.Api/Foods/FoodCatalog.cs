using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Foods;

public static class FoodCatalog
{
    public const int SearchLimit = 25;

    /// <summary>Enough words for a food name. More than this is rejected so a keystroke cannot build an unbounded predicate.</summary>
    public const int MaxSearchTokens = 8;

    /// <summary>
    /// A word this long may match inside a compound (<c>bryst</c> in <c>kyllingbryst</c>).
    /// Shorter text stays on a word boundary, so <c>br</c> does not match every word that contains those letters.
    /// </summary>
    public const int CompoundTokenLength = 4;

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

        // Names are already folded by the same function as the query, so this does not call lower() or regexp_replace.
        // Every token must hit the same string. Short words stay on a boundary. A longer word may also sit inside a compound.
        var args = new List<object>();
        string Add(object value)
        {
            args.Add(value);
            return "{" + (args.Count - 1) + "}";
        }

        var userParam = Add(userId);
        var queryParam = Add(query);
        var normalizedParam = Add(normalized);
        var prefixParam = Add(LikePrefix(normalized));
        var digitParam = Add(digits);
        var matchParams = tokens.Select((token, index) => Add(MatchPattern(token, index == tokens.Length - 1))).ToArray();
        var lastWholeParam = Add(WholeWordPattern(tokens[^1]));
        var lastPrefixParam = Add(WordPrefixPattern(tokens[^1]));

        // COLLATE "C" keeps the match on the stored letters. A database collation must not treat é as e.
        const string namePad = "(' ' || coalesce(f.search_name, '') || ' ') COLLATE \"C\"";
        const string enPad = "(' ' || coalesce(f.search_name_en, '') || ' ') COLLATE \"C\"";
        const string aliasPad = "(' ' || a.normalized || ' ') COLLATE \"C\"";
        string All(string pad) => string.Join(" AND ", matchParams.Select(param => pad + " LIKE " + param));

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
                OR f.search_name COLLATE "C" = {normalizedParam}
                OR f.search_name_en COLLATE "C" = {normalizedParam}
                OR EXISTS (
                  SELECT 1 FROM food_aliases AS a
                  WHERE a.source = f.source AND a.source_id = f.source_id AND a.expected_name_en = f.name_en
                    AND a.normalized COLLATE "C" = {normalizedParam}
                ) THEN 0
              WHEN f.search_name COLLATE "C" LIKE {prefixParam}
                OR f.search_name_en COLLATE "C" LIKE {prefixParam}
                OR EXISTS (
                  SELECT 1 FROM food_aliases AS a
                  WHERE a.source = f.source AND a.source_id = f.source_id AND a.expected_name_en = f.name_en
                    AND a.normalized COLLATE "C" LIKE {prefixParam}
                ) THEN 1
              WHEN {namePad} LIKE {lastWholeParam}
                OR {enPad} LIKE {lastWholeParam}
                OR EXISTS (
                  SELECT 1 FROM food_aliases AS a
                  WHERE a.source = f.source AND a.source_id = f.source_id AND a.expected_name_en = f.name_en
                    AND {aliasPad} LIKE {lastWholeParam}
                ) THEN 2
              WHEN {namePad} LIKE {lastPrefixParam}
                OR {enPad} LIKE {lastPrefixParam}
                OR EXISTS (
                  SELECT 1 FROM food_aliases AS a
                  WHERE a.source = f.source AND a.source_id = f.source_id AND a.expected_name_en = f.name_en
                    AND {aliasPad} LIKE {lastPrefixParam}
                ) THEN 3
              ELSE 4
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

    /// <summary>How many distinct foods the food sheet lists under Recent. Matches the prototype.</summary>
    public const int RecentLimit = 8;

    /// <summary>
    /// Latest non-deleted log of each food this person logged, newest first.
    /// Another person's rows are not included. A soft-deleted entry is not a recent.
    /// </summary>
    public static async Task<List<Guid>> RecentEntryIdsAsync(
        AppDbContext db,
        string userId,
        CancellationToken cancellationToken)
    {
        FormattableString sql = $"""
            SELECT picked.id AS "Value"
            FROM (
                SELECT DISTINCT ON (le.food_id) le.id, le.logged_at
                FROM log_entries AS le
                INNER JOIN foods AS f ON f.id = le.food_id
                WHERE le.user_id = {userId}
                  AND le.deleted_at IS NULL
                  AND le.food_id IS NOT NULL
                  AND f.retired_at IS NULL
                  AND (f.user_id IS NULL OR f.user_id = {userId})
                ORDER BY le.food_id, le.logged_at DESC, le.id DESC
            ) AS picked
            ORDER BY picked.logged_at DESC, picked.id DESC
            LIMIT {RecentLimit}
            """;
        return await db.Database.SqlQuery<Guid>(sql).ToListAsync(cancellationToken);
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

    private static string MatchPattern(string token, bool last)
    {
        if (token.Length >= CompoundTokenLength)
        {
            return "%" + token + "%";
        }

        return last ? WordPrefixPattern(token) : WholeWordPattern(token);
    }

    private static string WholeWordPattern(string token) => "% " + token + " %";

    private static string WordPrefixPattern(string token) => "% " + token + "%";

    private static string LikePrefix(string normalized) => normalized + "%";

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
