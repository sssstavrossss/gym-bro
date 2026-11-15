namespace GymBro.Api.Foods;

/// <summary>
/// A light base form for one search word, so an inflected word still finds the food:
/// <c>tomater</c> → <c>tomat</c>, <c>hermetiske</c> → <c>hermetisk</c>, <c>tomatoes</c> → <c>tomato</c>.
/// It strips one common Norwegian or English ending. It is only used as an extra way for a word to match;
/// a food that matches the words as typed still ranks first.
/// </summary>
public static class FoodSearchStem
{
    /// <summary>Shortest base form kept. Below this, a stripped word matches too much.</summary>
    public const int MinStem = 3;

    // Longest ending first. "et" needs a longer stem so "filet" is not cut to "fil".
    private static readonly (string Ending, string Replace, int MinStem)[] Endings =
    [
        ("ies", "y", 3),   // berries → berry
        ("oes", "o", 3),   // tomatoes → tomato
        ("ches", "ch", 3), // peaches → peach
        ("shes", "sh", 3), // radishes → radish
        ("ene", "", 3),    // tomatene → tomat, eplene → epl
        ("ane", "", 3),
        ("er", "", 3),     // tomater → tomat, poteter → potet, epler → epl
        ("ar", "", 3),
        ("en", "", 3),     // løken → løk, kyllingen → kylling
        ("et", "", 4),     // kjøttet → kjøtt, brødet → brød
        ("e", "", 4),      // hermetiske → hermetisk, kokte → kokt; "cafe" stays, so it cannot reach "café"
    ];

    /// <summary>The base form, or null when the word has no ending to strip.</summary>
    public static string? Stem(string token)
    {
        if (token.Length <= MinStem || token.Any(char.IsDigit))
        {
            return null;
        }

        foreach (var (ending, replace, minStem) in Endings)
        {
            if (token.EndsWith(ending, StringComparison.Ordinal) && token.Length - ending.Length >= minStem)
            {
                return token[..^ending.Length] + replace;
            }
        }

        // English plural -s, only on longer words so "laks" and "ris" stay as typed.
        if (token.Length >= 6 && token.EndsWith('s') && !token.EndsWith("ss", StringComparison.Ordinal))
        {
            return token[..^1];
        }

        return null;
    }
}
