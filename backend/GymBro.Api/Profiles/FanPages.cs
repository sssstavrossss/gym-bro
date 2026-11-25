using System.Text.RegularExpressions;

namespace GymBro.Api.Profiles;

/// <summary>
/// The + fan's pages as the person arranged them: each page is the app's action ids joined by commas,
/// first page first. The server only checks the shape, so a new action needs no server change.
/// An empty list is the app's default layout.
/// </summary>
public static partial class FanPages
{
    public const int MaxPages = 4;
    public const int MaxPerPage = 5;

    public const string Invalid = "The + fan is up to 4 pages of 1 to 5 actions.";

    /// <summary>The pages as given, or null when they aren't up to 4 pages of 1 to 5 short ids, each used once.</summary>
    public static string[]? Clean(IReadOnlyList<string?> pages)
    {
        if (pages.Count > MaxPages)
        {
            return null;
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var page in pages)
        {
            if (page is null)
            {
                return null;
            }

            var ids = page.Split(',');
            if (ids.Length > MaxPerPage || ids.Any(id => !Id().IsMatch(id) || !seen.Add(id)))
            {
                return null;
            }
        }

        return pages.Select(page => page!).ToArray();
    }

    [GeneratedRegex("^[A-Za-z0-9-]{1,32}$")]
    private static partial Regex Id();
}
