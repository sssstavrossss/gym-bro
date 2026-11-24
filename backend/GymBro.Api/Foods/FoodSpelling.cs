using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Foods;

/// <summary>Search results, and the words the search also used when the typed ones found little.</summary>
public sealed record SpelledSearch(List<Food> Foods, string? CorrectedQuery);

/// <summary>
/// Help for a misspelt search. When a search finds few foods, each long word is matched to the catalogue word that
/// looks most like it (pg_trgm trigrams over <c>food_fold</c>, which drops accents and Nordic letters): "kjottdeig"
/// is "kjøttdeig", "brocolli" is "broccoli". The foods found by the corrected words follow the ones found as typed.
/// Describe does not use this: the model writes its own search words.
/// </summary>
public static class FoodSpelling
{
    /// <summary>A search with fewer foods than this also tries the catalogue's spelling.</summary>
    public const int FewResults = 5;

    /// <summary>Shorter words are left as typed. Three letters are too few to tell a typo from another word.</summary>
    public const int MinWordLength = 4;

    /// <summary>How alike (trigram similarity of the folded words, 0 to 1) a catalogue word must be to stand in for a typed one.</summary>
    public const double MinSimilarity = 0.5;

    /// <summary>
    /// Or how alike by edit distance, for a typed word no row has: one letter wrong in five ("bannana", "brocolli").
    /// Less, and "sipsit" (crisps) would be "sipuli" (onion).
    /// </summary>
    public const double MinEditSimilarity = 0.75;

    /// <summary>
    /// A typed word that some rows also have ("chiken" in a product's name) is replaced only by a word this many
    /// times as common.
    /// </summary>
    public const int MoreCommon = 5;

    /// <summary>Trigram threshold for the index lookup. Below <see cref="MinSimilarity"/>, as a word's best extent in a name scores differently.</summary>
    private const string LookupThreshold = "0.4";

    /// <summary>The catalogue words looked at for one typed word, most alike by trigrams first.</summary>
    private const int Candidates = 50;

    public static async Task<SpelledSearch> SearchAsync(
        AppDbContext db,
        string userId,
        string query,
        string home,
        CancellationToken cancellationToken)
    {
        var foods = await FoodCatalog.SearchAsync(db, userId, query, home, cancellationToken);
        if (foods.Count >= FewResults)
        {
            return new SpelledSearch(foods, null);
        }

        var corrected = await CorrectAsync(db, userId, query, home, cancellationToken);
        if (corrected is null)
        {
            return new SpelledSearch(foods, null);
        }

        var more = await FoodCatalog.SearchAsync(db, userId, corrected, home, cancellationToken);
        var added = more
            .Where(food => foods.All(found => found.Id != food.Id))
            .Take(FoodCatalog.SearchLimit - foods.Count)
            .ToList();
        return added.Count == 0 ? new SpelledSearch(foods, null) : new SpelledSearch([.. foods, .. added], corrected);
    }

    /// <summary>The query with each long word spelt the way the catalogue spells it, or null when no word changes.</summary>
    public static async Task<string?> CorrectAsync(
        AppDbContext db,
        string userId,
        string query,
        string home,
        CancellationToken cancellationToken)
    {
        var tokens = FoodAliasCatalogue.Normalize(query).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (tokens.Length > FoodCatalog.MaxSearchTokens)
        {
            return null;
        }

        var changed = false;
        for (var i = 0; i < tokens.Length; i++)
        {
            if (tokens[i].Length < MinWordLength || tokens[i].Any(char.IsDigit))
            {
                continue;
            }

            var candidates = await CandidatesAsync(db, userId, tokens[i], home, cancellationToken);
            if (Pick(tokens[i], candidates) is { } word)
            {
                tokens[i] = word;
                changed = true;
            }
        }

        return changed ? string.Join(' ', tokens) : null;
    }

    /// <summary>
    /// The best catalogue word for a typed one: alike enough, not the word itself, and far more common than it when
    /// some rows have the typed word too. Most alike first, then words the home table uses ("brød" for "brod" in
    /// Norway, "bröd" in Sweden), then common words. None for the start of a longer word ("kyllingbr" of
    /// "kyllingbryst"): the search finds that as typed, and the person is still typing.
    /// <para>
    /// A typed word that no row has is surely misspelt: a word alike by trigrams or by edit distance will do. Edit
    /// distance counts letters swapped or left out, which trigrams score poorly: they put "lasange" closer to
    /// "lange" than to "lasagne". A word that rows do have ("Kesam") is a real word, so the stand-in must be alike
    /// both ways and far more common: "Kesam" does not become "sesam".
    /// </para>
    /// </summary>
    public static string? Pick(string token, IReadOnlyList<SpellingCandidate> candidates)
    {
        if (candidates.Any(candidate => candidate.Word.Length > token.Length && candidate.Word.StartsWith(token, StringComparison.Ordinal)))
        {
            return null;
        }

        var typed = candidates.FirstOrDefault(candidate => candidate.Word == token)?.Count ?? 0;
        var folded = Fold(token);
        return candidates
            .Where(candidate => candidate.Word != token)
            .Select(candidate => (candidate, Edit: EditSimilarity(folded, Fold(candidate.Word))))
            .Where(pair => typed == 0
                ? pair.candidate.Similarity >= MinSimilarity || pair.Edit >= MinEditSimilarity
                : pair.candidate.Similarity >= MinSimilarity && pair.Edit >= MinEditSimilarity
                    && pair.candidate.Count >= MoreCommon * typed)
            .Select(pair => (pair.candidate, Alike: Math.Max(pair.candidate.Similarity, pair.Edit)))
            .OrderByDescending(pair => pair.Alike
                + 0.05 * Math.Log(1 + pair.candidate.HomeCount)
                + 0.02 * Math.Log(1 + pair.candidate.Count))
            .ThenBy(pair => pair.candidate.Word, StringComparer.Ordinal)
            .Select(pair => pair.candidate.Word)
            .FirstOrDefault();
    }

    /// <summary>The C# twin of the database's <c>food_fold</c> (migration AddFoodSpelling): no accents, no Nordic letters.</summary>
    public static string Fold(string text)
    {
        var builder = new System.Text.StringBuilder(text.Length);
        foreach (var ch in text)
        {
            switch (ch)
            {
                case 'æ':
                    builder.Append("ae");
                    break;
                case 'ß':
                    builder.Append("ss");
                    break;
                default:
                    var at = FoldFrom.IndexOf(ch, StringComparison.Ordinal);
                    builder.Append(at < 0 ? ch : FoldTo[at]);
                    break;
            }
        }

        return builder.ToString();
    }

    private const string FoldFrom = "øåäöüéèêëáàâãíìîïóòôõúùûñçý";

    private const string FoldTo = "oaaoueeeeaaaaiiiioooouuuncy";

    /// <summary>1 minus the edit distance (a swap of two letters is one edit) over the longer word's length.</summary>
    public static double EditSimilarity(string a, string b)
    {
        var longer = Math.Max(a.Length, b.Length);
        return longer == 0 ? 1 : 1 - (double)EditDistance(a, b) / longer;
    }

    private static int EditDistance(string a, string b)
    {
        var d = new int[a.Length + 1, b.Length + 1];
        for (var i = 0; i <= a.Length; i++)
        {
            d[i, 0] = i;
        }

        for (var j = 0; j <= b.Length; j++)
        {
            d[0, j] = j;
        }

        for (var i = 1; i <= a.Length; i++)
        {
            for (var j = 1; j <= b.Length; j++)
            {
                var cost = a[i - 1] == b[j - 1] ? 0 : 1;
                d[i, j] = Math.Min(Math.Min(d[i - 1, j] + 1, d[i, j - 1] + 1), d[i - 1, j - 1] + cost);
                if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1])
                {
                    d[i, j] = Math.Min(d[i, j], d[i - 2, j - 2] + 1);
                }
            }
        }

        return d[a.Length, b.Length];
    }

    /// <summary>
    /// Words of catalogue names, English names and phrases that look like <paramref name="token"/>, with how many
    /// rows have each and how many of those are home foods. Words that start with the token come first, so
    /// <see cref="Pick"/> sees them. The person's own foods count as home; nobody else's are read.
    /// </summary>
    private static async Task<List<SpellingCandidate>> CandidatesAsync(
        AppDbContext db,
        string userId,
        string token,
        string home,
        CancellationToken cancellationToken)
    {
        var away = FoodSources.SourcesAtTier(1, home).Concat(FoodSources.SourcesAtTier(2, home)).ToArray();
        // Both settings last until the transaction ends. The planner does not know what trigram matching costs, and it
        // read the phrase table row by row (80 ms for "soup") rather than through its index (7 ms).
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.Database.ExecuteSqlAsync(
            $"SELECT set_config('pg_trgm.word_similarity_threshold', {LookupThreshold}, true), set_config('enable_seqscan', 'off', true)",
            cancellationToken);
        FormattableString sql = $"""
            SELECT w.word AS "Word", w.n AS "Count", w.n_home AS "HomeCount",
                   similarity(food_fold({token}), food_fold(w.word))::float8 AS "Similarity"
            FROM (
                SELECT x.word, count(*)::int AS n, (count(*) FILTER (WHERE x.home))::int AS n_home
                FROM (
                    SELECT unnest(string_to_array(f.search_name, ' ')) AS word, NOT (f.source = ANY({away})) AS home
                    FROM foods AS f
                    WHERE f.retired_at IS NULL AND f.user_id IS NULL
                      AND food_fold({token}) <% food_fold(f.search_name)
                    UNION ALL
                    SELECT unnest(string_to_array(f.search_name_en, ' ')), NOT (f.source = ANY({away}))
                    FROM foods AS f
                    WHERE f.retired_at IS NULL AND f.user_id IS NULL
                      AND food_fold({token}) <% food_fold(f.search_name_en)
                    UNION ALL
                    SELECT unnest(string_to_array(a.normalized, ' ')), NOT (a.source = ANY({away}))
                    FROM food_aliases AS a
                    WHERE food_fold({token}) <% food_fold(a.normalized)
                    UNION ALL
                    SELECT unnest(string_to_array(coalesce(f.search_name, '') || ' ' || coalesce(f.search_name_en, ''), ' ')), TRUE
                    FROM foods AS f
                    WHERE f.retired_at IS NULL AND f.user_id = {userId}
                ) AS x
                WHERE length(x.word) >= 3
                GROUP BY x.word
            ) AS w
            ORDER BY w.word LIKE {token} || '%' DESC, similarity(food_fold({token}), food_fold(w.word)) DESC, w.word
            LIMIT {Candidates}
            """;
        var candidates = await db.Database.SqlQuery<SpellingCandidate>(sql).ToListAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return candidates;
    }
}

/// <summary>A catalogue word that looks like a typed one; see <see cref="FoodSpelling.Pick"/>.</summary>
public sealed class SpellingCandidate
{
    public string Word { get; set; } = "";

    public int Count { get; set; }

    public int HomeCount { get; set; }

    public double Similarity { get; set; }
}
