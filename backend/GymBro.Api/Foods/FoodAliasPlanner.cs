using System.Text.Json;
using System.Text.RegularExpressions;

namespace GymBro.Api.Foods;

public sealed class FoodAliasLexicon
{
    public int Version { get; init; }

    public string[] PrepEn { get; init; } = [];

    public string[] PrepNb { get; init; } = [];

    public string[] PrepTail { get; init; } = [];

    public AliasRule[] Rules { get; init; } = [];

    /// <summary>The tables the lexicon covers, by source id, and the language of each one's own names: nb, sv or fi.</summary>
    public Dictionary<string, string> Languages { get; init; } = [];

    /// <summary>Endings of a compound that names a dish made with a food (<c>keitto</c>, <c>gryta</c>), not the food.</summary>
    public string[] DishEnds { get; init; } = [];

    public FoodWord[] Words { get; init; } = [];

    public ReviewedCatalogue? ReviewedAgainst { get; init; }

    public string[] Limits { get; init; } = [];

    private static readonly Lazy<FoodAliasLexicon> CurrentLexicon = new(Load);

    public static FoodAliasLexicon Current => CurrentLexicon.Value;

    private static FoodAliasLexicon Load()
    {
        var assembly = typeof(FoodAliasLexicon).Assembly;
        var name = assembly.GetManifestResourceNames().Single(resource => resource.EndsWith("food-alias-lexicon.v2.json", StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(name) ?? throw new InvalidOperationException("Food alias lexicon is missing.");
        return JsonSerializer.Deserialize<FoodAliasLexicon>(stream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException("Food alias lexicon was empty.");
    }
}

public sealed class ReviewedCatalogue
{
    public string EnSha256 { get; init; } = "";

    public string NbSha256 { get; init; } = "";

    public int FoodCount { get; init; }

    public int SlvFoodCount { get; init; }

    public int FineliFoodCount { get; init; }
}

/// <summary>
/// One food in Norwegian, Swedish and Finnish. A row whose own name starts with one of its words in that table's
/// language gets the other languages' words as search phrases. A word ending in <c>*</c> also matches a compound that
/// starts with it, unless the compound ends in a dish word; one starting with <c>*</c> matches a compound ending in it.
/// </summary>
public sealed class FoodWord
{
    public string Id { get; init; } = "";

    public string[] Nb { get; init; } = [];

    public string[] Sv { get; init; } = [];

    public string[] Fi { get; init; } = [];

    /// <summary>More forms that match, by language, but are not added as phrases (a genitive, a fat level).</summary>
    public Dictionary<string, string[]> Also { get; init; } = [];

    /// <summary>First words that look like a match but are another food (<c>grissini</c>).</summary>
    public string[] Unless { get; init; } = [];

    /// <summary>Whole words anywhere in the name that rule the row out (a plant-based substitute).</summary>
    public string[] UnlessWords { get; init; } = [];

    public string[] In(string language) => language switch
    {
        "nb" => Nb,
        "sv" => Sv,
        "fi" => Fi,
        _ => [],
    };
}

public sealed class AliasRule
{
    public string Id { get; init; } = "";

    public string[] Add { get; init; } = [];

    public AliasWhen[] When { get; init; } = [];

    public string[] UnlessWords { get; init; } = [];
}

public sealed class AliasWhen
{
    public string Name { get; init; } = "";

    public string Op { get; init; } = "";

    public string[] Text { get; init; } = [];
}

public static class FoodAliasPlanner
{
    public const string KindSeed = "seed";
    public const string KindLexical = "lexical";
    public const string KindStructural = "structural";
    public const string KindHyphen = "hyphen";
    public const string KindWord = "word";

    private static readonly string[] Languages = ["nb", "sv", "fi"];

    public sealed record PlannedPhrase(string Phrase, string Kind, string RuleId);

    private static readonly Regex HyphenWord = new(@"\p{L}{2,}(?:-\p{L}{2,})+", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    /// <summary>
    /// The search phrases for one catalogue row. <paramref name="name"/> is the row's own name, in the table's
    /// language (<see cref="FoodAliasLexicon.Languages"/>). The English rules apply to every table; the Norwegian
    /// rules, seeds, word order and hyphen phrases to Matvaretabellen, as in v1. Words apply to every table.
    /// </summary>
    public static IReadOnlyList<PlannedPhrase> PhrasesFor(string source, string sourceId, string? name, string? nameEn)
    {
        var lexicon = FoodAliasLexicon.Current;
        if (!lexicon.Languages.TryGetValue(source, out var language))
        {
            return [];
        }

        var norwegian = language == "nb";
        var nameNb = norwegian ? name : null;
        var planned = new List<PlannedPhrase>();
        if (source == FoodAliasCatalogue.Source)
        {
            foreach (var seed in FoodAliasCatalogue.Seeds)
            {
                if (!string.Equals(seed.SourceId, sourceId, StringComparison.Ordinal) || nameEn != seed.ExpectedNameEn)
                {
                    continue;
                }

                foreach (var phrase in seed.Phrases)
                {
                    planned.Add(new PlannedPhrase(phrase, KindSeed, "preserved-seed"));
                }
            }
        }

        foreach (var rule in lexicon.Rules)
        {
            if (!Matches(rule, nameNb, nameEn))
            {
                continue;
            }

            var preps = Preps(nameEn, lexicon.PrepEn).Concat(Preps(nameNb, lexicon.PrepNb)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            foreach (var phrase in rule.Add)
            {
                planned.Add(new PlannedPhrase(phrase, KindLexical, rule.Id));
                foreach (var prep in preps)
                {
                    if (FoodAliasCatalogue.Normalize(phrase).StartsWith(FoodAliasCatalogue.Normalize(prep) + " ", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    planned.Add(new PlannedPhrase(prep + " " + phrase, KindLexical, rule.Id));
                }
            }
        }

        if (norwegian)
        {
            AddStructural(nameEn, lexicon.PrepEn, planned);
            AddStructural(nameNb, lexicon.PrepNb, planned);
            AddHyphens(nameEn, planned);
            AddHyphens(nameNb, planned);
        }

        foreach (var word in lexicon.Words)
        {
            if (!WordMatches(word, language, name))
            {
                continue;
            }

            // A word the row's own language shares (Norwegian and Swedish "tomater") is the row's own word, not a translation.
            var own = word.In(language).Concat(word.Also.GetValueOrDefault(language) ?? []).Select(Plain).ToHashSet(StringComparer.Ordinal);
            foreach (var other in Languages.Where(other => other != language))
            {
                foreach (var text in word.In(other).Select(Plain).Where(text => !own.Contains(text)))
                {
                    planned.Add(new PlannedPhrase(text, KindWord, word.Id));
                }
            }
        }

        return DistinctUsable(planned, name, nameEn);
    }

    /// <summary>Whether a row's own name, in <paramref name="language"/>, names this word's food.</summary>
    public static bool WordMatches(FoodWord word, string language, string? name)
    {
        var head = Head(name);
        if (head.Length == 0 || word.Unless.Any(pattern => PatternMatches(pattern, head, name)))
        {
            return false;
        }

        if (word.UnlessWords.Any(text => HasWord(name, text)))
        {
            return false;
        }

        var also = word.Also.GetValueOrDefault(language) ?? [];
        return word.In(language).Concat(also).Any(pattern => PatternMatches(pattern, head, name));
    }

    /// <summary>The first word of a name, lower-case: up to the first space, comma, bracket or slash. Hyphens stay.</summary>
    internal static string Head(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return "";
        }

        var text = name.Trim().Normalize(System.Text.NormalizationForm.FormC);
        var end = text.IndexOfAny([' ', '\t', ',', '(', '/']);
        return (end < 0 ? text : text[..end]).ToLowerInvariant();
    }

    private static string Plain(string pattern) => pattern.Trim().Trim('*').Normalize(System.Text.NormalizationForm.FormC).ToLowerInvariant();

    private static bool PatternMatches(string pattern, string head, string? name)
    {
        var text = pattern.Trim().Normalize(System.Text.NormalizationForm.FormC).ToLowerInvariant();
        if (text.StartsWith('*'))
        {
            return head.EndsWith(text[1..], StringComparison.Ordinal);
        }

        if (text.EndsWith('*'))
        {
            var start = text[..^1];
            return head.StartsWith(start, StringComparison.Ordinal)
                && (head.Length == start.Length || !FoodAliasLexicon.Current.DishEnds.Any(end => head.EndsWith(end, StringComparison.Ordinal)));
        }

        // A phrase of more than one word ("svarta vinbär") matches the start of the whole name.
        return text.Contains(' ') ? NameStarts(name, text) : head == text;
    }

    public static bool NameStarts(string? name, string prefix)
    {
        var normalized = FoodAliasCatalogue.Normalize(name);
        var start = FoodAliasCatalogue.Normalize(prefix);
        return start.Length > 0 && (normalized.Equals(start, StringComparison.Ordinal) || normalized.StartsWith(start + " ", StringComparison.Ordinal));
    }

    public static bool HasWord(string? name, string word)
    {
        var needle = " " + FoodAliasCatalogue.Normalize(word) + " ";
        if (needle.Length <= 2)
        {
            return false;
        }

        return (" " + FoodAliasCatalogue.Normalize(name) + " ").Contains(needle, StringComparison.Ordinal);
    }

    private static bool Matches(AliasRule rule, string? nameNb, string? nameEn)
    {
        if (rule.When.Length == 0)
        {
            return false;
        }

        if (rule.UnlessWords.Any(word => HasWord(nameEn, word) || HasWord(nameNb, word)))
        {
            return false;
        }

        foreach (var clause in rule.When)
        {
            var name = clause.Name switch
            {
                "nb" => nameNb,
                "en" => nameEn,
                _ => (nameEn ?? "") + "\n" + (nameNb ?? ""),
            };
            var ok = clause.Op switch
            {
                "startsAny" => clause.Text.Any(text => NameStarts(name, text)),
                "hasAll" => clause.Text.Length > 0 && clause.Text.All(text => HasWord(name, text)),
                _ => false,
            };
            if (!ok)
            {
                return false;
            }
        }

        return true;
    }

    private static void AddStructural(string? name, string[] preps, List<PlannedPhrase> planned)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return;
        }

        var parts = name.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length >= 2)
        {
            planned.Add(new PlannedPhrase(parts[0] + " " + parts[1], KindStructural, "comma-join"));
        }

        foreach (var prep in Preps(name, preps))
        {
            if (parts.Length == 0)
            {
                continue;
            }

            planned.Add(new PlannedPhrase(prep + " " + parts[0], KindStructural, "word-order"));
        }
    }

    private static IEnumerable<string> Preps(string? name, string[] preps)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            yield break;
        }

        var tails = FoodAliasLexicon.Current.PrepTail.Select(FoodAliasCatalogue.Normalize).ToHashSet(StringComparer.Ordinal);
        foreach (var part in name.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            var segment = FoodAliasCatalogue.Normalize(part);
            foreach (var prep in preps)
            {
                var normalized = FoodAliasCatalogue.Normalize(prep);
                if (segment.Equals(normalized, StringComparison.Ordinal))
                {
                    yield return prep;
                    break;
                }

                if (!segment.StartsWith(normalized + " ", StringComparison.Ordinal))
                {
                    continue;
                }

                var rest = segment[(normalized.Length + 1)..];
                if (tails.Contains(rest))
                {
                    yield return prep;
                }

                break;
            }
        }
    }

    private static void AddHyphens(string? name, List<PlannedPhrase> planned)
    {
        if (string.IsNullOrEmpty(name))
        {
            return;
        }

        foreach (Match match in HyphenWord.Matches(name))
        {
            planned.Add(new PlannedPhrase(match.Value.Replace('-', ' '), KindHyphen, "hyphen"));
        }
    }

    private static IReadOnlyList<PlannedPhrase> DistinctUsable(List<PlannedPhrase> planned, string? name, string? nameEn)
    {
        var kept = new List<PlannedPhrase>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var phrase in planned)
        {
            var text = phrase.Phrase.Trim();
            var normalized = FoodAliasCatalogue.Normalize(text);
            if (normalized.Length < 2 || normalized.Length > 80 || text.Length > 80 || normalized.Split(' ').Length > 8)
            {
                continue;
            }

            if (!seen.Add(normalized))
            {
                continue;
            }

            if (phrase.Kind != KindSeed && SearchableAlready(text, name, nameEn))
            {
                continue;
            }

            kept.Add(phrase with { Phrase = text });
        }

        return kept;
    }

    private static bool SearchableAlready(string phrase, string? name, string? nameEn) =>
        Contains(name, phrase) || Contains(nameEn, phrase);

    private static bool Contains(string? name, string phrase) =>
        !string.IsNullOrEmpty(name) && name.Contains(phrase, StringComparison.OrdinalIgnoreCase);
}
