using System.Text.RegularExpressions;

namespace GymBro.Api.Profiles;

/// <summary>
/// Lists of Home cards or card pages the person switched off. The ids are the app's, so the server
/// only checks their shape: a card added later needs no server change.
/// </summary>
public static partial class HiddenIds
{
    public const int MaxCount = 32;

    public const string Invalid = "Hidden cards are a list of up to 32 short ids.";

    /// <summary>A card's page order is the same shape: the app's ids, first page first.</summary>
    public const string OrderInvalid = "A page order is a list of up to 32 short ids.";

    /// <summary>The list in its order without repeats, or null when it isn't a list of short ids.</summary>
    public static string[]? Clean(IReadOnlyList<string?> ids)
    {
        if (ids.Count > MaxCount || ids.Any(id => id is null || !Id().IsMatch(id)))
        {
            return null;
        }

        return ids.Select(id => id!).Distinct(StringComparer.Ordinal).ToArray();
    }

    [GeneratedRegex("^[A-Za-z0-9-]{1,32}$")]
    private static partial Regex Id();
}
