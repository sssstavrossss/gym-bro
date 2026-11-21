using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Foods;

/// <summary>
/// A search result, how closely it matched, and how near its country is to home
/// (<see cref="FoodSources.Tier"/>); see <see cref="FoodCatalog.SearchRankedAsync"/>.
/// </summary>
public sealed record RankedFood(Food Food, int Rank, int Tier);

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
        string home,
        CancellationToken cancellationToken) =>
        (await SearchRankedAsync(db, userId, query, home, cancellationToken)).Select(hit => hit.Food).ToList();

    /// <summary>
    /// <see cref="SearchAsync"/> with each food's match rank: 0 for the exact name or phrase, 1 for a name that
    /// starts with the text, 2 for a whole last word, 3 for a last word that starts a word, 4 otherwise. A food
    /// found only by a word's base form ranks 5 to 9 the same way. The order is the rank's band (0–1, 2–3, 4, base forms), then country
    /// tier for <paramref name="home"/>, then rank, then name. A table's category word (<c>fisk</c>) finds a food
    /// but never ranks it above 4.
    /// </summary>
    public static async Task<List<RankedFood>> SearchRankedAsync(
        AppDbContext db,
        string userId,
        string query,
        string home,
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

            return (await Visible(db.Foods.AsNoTracking(), userId)
                .Where(food => food.Barcode == query)
                .OrderBy(food => food.Name)
                .Take(SearchLimit)
                .ToListAsync(cancellationToken))
                .Select(food => new RankedFood(food, 0, FoodSources.Tier(food.Source, home)))
                .ToList();
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
        var digitParam = Add(digits);
        var matchParams = tokens.Select((token, index) => Add(MatchPattern(token, index == tokens.Length - 1))).ToArray();

        // An inflected word may also match by its base form (tomater → tomat). Only the words that have one get the extra pattern.
        var stems = tokens.Select(FoodSearchStem.Stem).ToArray();
        var stemParams = stems.Select(stem => stem is null ? null : Add(StemPattern(stem))).ToArray();
        var anyStem = stemParams.Any(param => param is not null);

        // COLLATE "C" keeps the match on the stored letters. A database collation must not treat é as e.
        const string namePad = "(' ' || coalesce(f.search_name, '') || ' ') COLLATE \"C\"";
        const string enPad = "(' ' || coalesce(f.search_name_en, '') || ' ') COLLATE \"C\"";
        const string aliasPad = "(' ' || a.normalized || ' ') COLLATE \"C\"";
        const string nameBrandPad = "(' ' || coalesce(f.search_name, '') || ' ' || coalesce(f.search_brand, '') || ' ') COLLATE \"C\"";
        const string aliasOfFood = "a.source = f.source AND a.source_id = f.source_id AND a.expected_name_en = f.name_en";
        const string rankingAlias = aliasOfFood + " AND a.kind <> '" + FoodAliasKinds.Category + "'";
        string Strict(string pad) => string.Join(" AND ", matchParams.Select(param => pad + " LIKE " + param));
        string Loose(string pad) => string.Join(" AND ", matchParams.Select((param, index) => stemParams[index] is { } stem
            ? "(" + pad + " LIKE " + param + " OR " + pad + " LIKE " + stem + ")"
            : pad + " LIKE " + param));

        // Every token must hit the same string: the name, name + brand, the English name, or one alias.
        string Matches(Func<string, string> all) => $"""
            ({digitParam} AND f.barcode = {queryParam})
                OR ({all(namePad)})
                OR ({all(nameBrandPad)})
                OR ({all(enPad)})
                OR EXISTS (SELECT 1 FROM food_aliases AS a WHERE {aliasOfFood} AND {all(aliasPad)})
            """;

        // Exact name or phrase, then a name that starts with the text, then a whole last word, then a last word that starts a word.
        string Rank(string text)
        {
            var exact = Add(text);
            var prefix = Add(LikePrefix(text));
            var lastWord = text[(text.LastIndexOf(' ') + 1)..];
            var lastWhole = Add(WholeWordPattern(lastWord));
            var lastPrefix = Add(WordPrefixPattern(lastWord));
            return $"""
                CASE
                  WHEN ({digitParam} AND f.barcode = {queryParam})
                    OR f.search_name COLLATE "C" = {exact}
                    OR f.search_name_en COLLATE "C" = {exact}
                    OR f.search_brand COLLATE "C" = {exact}
                    OR EXISTS (SELECT 1 FROM food_aliases AS a WHERE {rankingAlias} AND a.normalized COLLATE "C" = {exact}) THEN 0
                  WHEN f.search_name COLLATE "C" LIKE {prefix}
                    OR f.search_name_en COLLATE "C" LIKE {prefix}
                    OR EXISTS (SELECT 1 FROM food_aliases AS a WHERE {rankingAlias} AND a.normalized COLLATE "C" LIKE {prefix}) THEN 1
                  WHEN {namePad} LIKE {lastWhole}
                    OR {enPad} LIKE {lastWhole}
                    OR EXISTS (SELECT 1 FROM food_aliases AS a WHERE {rankingAlias} AND {aliasPad} LIKE {lastWhole}) THEN 2
                  WHEN {namePad} LIKE {lastPrefix}
                    OR {enPad} LIKE {lastPrefix}
                    OR EXISTS (SELECT 1 FROM food_aliases AS a WHERE {rankingAlias} AND {aliasPad} LIKE {lastPrefix}) THEN 3
                  ELSE 4
                END
                """;
        }

        // Without a base form the query is the strict one. With one, a food that matches the words as typed
        // still comes first, and base-form matches are ranked among themselves by the base-form text.
        var rank = anyStem
            ? $"CASE WHEN {Matches(Strict)} THEN 0 ELSE 5 END + {Rank(normalized)}"
            : Rank(normalized);
        var stemRank = anyStem ? Rank(string.Join(' ', tokens.Select((token, index) => stems[index] ?? token))) : "0";

        // Home foods come first within a band: tier 0 is home and foods with no country, 1 a neighbour, 2 the rest.
        string Tier()
        {
            var cases = new List<string>();
            foreach (var tier in new[] { 1, 2 })
            {
                var sources = FoodSources.SourcesAtTier(tier, home);
                if (sources.Count > 0)
                {
                    cases.Add($"WHEN f.source IN ({string.Join(", ", sources.Select(source => Add(source)))}) THEN {tier}");
                }
            }

            return cases.Count == 0 ? "0" : $"CASE {string.Join(" ", cases)} ELSE 0 END";
        }

        // Ranks fall into bands: the name or phrase itself or its start (0–1), a last word (2–3), any other match
        // (4), a match by a word's base form only. Within a band, home foods come before a neighbour's and the
        // rest, so "Quinoa" from another country still comes before a home "Salat med quinoa". OFFSET 0 keeps
        // Postgres from inlining the inner select: inlined, it copies each rank's alias lookups into every sort
        // expression that reads it, and "chicken" took 2.6 s instead of 90 ms.
        var sql = $"""
            SELECT s."Id", s."Rank", s."Tier"
            FROM (
                SELECT f.id AS "Id", f.name, f.source, {rank} AS "Rank", {stemRank} AS stem_rank, {Tier()} AS "Tier"
                FROM foods AS f
                WHERE f.retired_at IS NULL
                  AND (f.user_id IS NULL OR f.user_id = {userParam})
                  AND ({Matches(anyStem ? Loose : Strict)})
                OFFSET 0
            ) AS s
            ORDER BY CASE WHEN s."Rank" <= 1 THEN 0 WHEN s."Rank" <= 3 THEN 1 WHEN s."Rank" = 4 THEN 2 ELSE 3 END,
                s."Tier", s."Rank", s.stem_rank, s.name, s.source
            LIMIT {SearchLimit}
            """;

        var hits = await db.Database.SqlQueryRaw<SearchHit>(sql, args.ToArray()).ToListAsync(cancellationToken);
        if (hits.Count == 0)
        {
            return [];
        }

        var ids = hits.Select(hit => hit.Id).ToList();
        var rows = await db.Foods.AsNoTracking().Where(food => ids.Contains(food.Id)).ToListAsync(cancellationToken);
        var byId = rows.ToDictionary(food => food.Id);
        return hits.Where(hit => byId.ContainsKey(hit.Id)).Select(hit => new RankedFood(byId[hit.Id], hit.Rank, hit.Tier)).ToList();
    }

    private sealed class SearchHit
    {
        public Guid Id { get; set; }

        public int Rank { get; set; }

        public int Tier { get; set; }
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

    /// <summary>Private custom foods for one person. Retired rows stay out of the list; their log entries do not.</summary>
    public const int MineLimit = 500;

    public static Task<List<Food>> MineAsync(AppDbContext db, string userId, CancellationToken cancellationToken) =>
        db.Foods.AsNoTracking()
            .Where(food => food.UserId == userId && food.Source == "custom" && food.RetiredAt == null)
            .OrderBy(food => food.Name)
            .ThenBy(food => food.Brand)
            .ThenBy(food => food.Id)
            .Take(MineLimit)
            .ToListAsync(cancellationToken);

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
            row.SaturatedFatPer100 = parsed.SaturatedFatPer100;
            row.SugarsPer100 = parsed.SugarsPer100;
            row.FiberPer100 = parsed.FiberPer100;
            row.SaltPer100 = parsed.SaltPer100;
            NutrientPanel.ApplyDictionary(row, parsed.Panel);
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

    /// <summary>A long base form may sit inside a compound like any long word. A short one must start a word.</summary>
    private static string StemPattern(string stem) =>
        stem.Length >= CompoundTokenLength ? "%" + stem + "%" : WordPrefixPattern(stem);

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
