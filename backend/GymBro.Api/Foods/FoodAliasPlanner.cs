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

    public ReviewedCatalogue? ReviewedAgainst { get; init; }

    public string[] Limits { get; init; } = [];

    private static readonly Lazy<FoodAliasLexicon> CurrentLexicon = new(Load);

    public static FoodAliasLexicon Current => CurrentLexicon.Value;

    private static FoodAliasLexicon Load()
    {
        var assembly = typeof(FoodAliasLexicon).Assembly;
        var name = assembly.GetManifestResourceNames().Single(resource => resource.EndsWith("food-alias-lexicon.v1.json", StringComparison.Ordinal));
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

    public sealed record PlannedPhrase(string Phrase, string Kind, string RuleId);

    private static readonly Regex HyphenWord = new(@"\p{L}{2,}(?:-\p{L}{2,})+", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static IReadOnlyList<PlannedPhrase> PhrasesFor(string sourceId, string? nameNb, string? nameEn)
    {
        var lexicon = FoodAliasLexicon.Current;
        var planned = new List<PlannedPhrase>();
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

        AddStructural(nameEn, lexicon.PrepEn, planned);
        AddStructural(nameNb, lexicon.PrepNb, planned);
        AddHyphens(nameEn, planned);
        AddHyphens(nameNb, planned);
        return DistinctUsable(planned, nameNb, nameEn);
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

    private static IReadOnlyList<PlannedPhrase> DistinctUsable(List<PlannedPhrase> planned, string? nameNb, string? nameEn)
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

            if (phrase.Kind != KindSeed && SearchableAlready(text, nameNb, nameEn))
            {
                continue;
            }

            kept.Add(phrase with { Phrase = text });
        }

        return kept;
    }

    private static bool SearchableAlready(string phrase, string? nameNb, string? nameEn) =>
        Contains(nameNb, phrase) || Contains(nameEn, phrase);

    private static bool Contains(string? name, string phrase) =>
        !string.IsNullOrEmpty(name) && name.Contains(phrase, StringComparison.OrdinalIgnoreCase);
}
