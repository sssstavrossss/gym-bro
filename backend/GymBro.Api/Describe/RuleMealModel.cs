using System.Globalization;
using System.Text.RegularExpressions;

namespace GymBro.Api.Describe;

/// <summary>
/// A stand-in for Claude in Testing and E2e, so tests are free and repeatable. It splits on commas and
/// "and"/"with", reads a leading number ("2 eggs", "200 g rice"), and takes the first candidate.
/// </summary>
public sealed partial class RuleMealModel : IMealModel
{
    public string Name => "rule";

    public Task<IReadOnlyList<MealPart>> SplitAsync(string text, MealUsage usage, CancellationToken cancellationToken)
    {
        usage.Add(0, 0);
        var parts = new List<MealPart>();
        foreach (var raw in Separator().Split(text))
        {
            var phrase = raw.Trim(' ', '.', ';');
            if (phrase.Length == 0)
            {
                continue;
            }

            var amount = Amount().Match(phrase);
            var name = (amount.Success ? phrase[amount.Length..] : phrase).Trim();
            if (name.Length == 0)
            {
                continue;
            }

            var count = amount.Success ? decimal.Parse(amount.Groups["n"].Value, CultureInfo.InvariantCulture) : 1m;
            var grams = amount.Groups["u"].Success ? count : 100m;
            parts.Add(new MealPart(phrase, name, [Singular(name)], grams, !amount.Success));
        }

        return Task.FromResult<IReadOnlyList<MealPart>>(parts);
    }

    public Task<IReadOnlyList<MealPick>> PickAsync(
        string text,
        IReadOnlyList<MealChoice> choices,
        MealUsage usage,
        CancellationToken cancellationToken)
    {
        usage.Add(0, 0);
        var picks = new List<MealPick>();
        foreach (var (choice, index) in choices.Select((choice, index) => (choice, index)))
        {
            if (choice.Candidates.Count == 0)
            {
                picks.Add(new MealPick(index, null, 0, ""));
                continue;
            }

            var units = choice.Candidates[0].Units;
            var amount = Amount().Match(choice.Part.Phrase);
            var counted = amount.Success && !amount.Groups["u"].Success;
            var piece = units.FirstOrDefault(unit => unit.Unit == "piece");
            if (counted && piece is not null)
            {
                picks.Add(new MealPick(index, 0, decimal.Parse(amount.Groups["n"].Value, CultureInfo.InvariantCulture), "piece"));
                continue;
            }

            var first = units[0];
            var quantity = first.Unit is "g" or "ml" ? choice.Part.Grams : 1m;
            picks.Add(new MealPick(index, 0, quantity, first.Unit));
        }

        return Task.FromResult<IReadOnlyList<MealPick>>(picks);
    }

    private static string Singular(string name) =>
        name.EndsWith("s", StringComparison.OrdinalIgnoreCase) && name.Length > 3 ? name[..^1] : name;

    [GeneratedRegex(@",|\band\b|\bwith\b", RegexOptions.IgnoreCase)]
    private static partial Regex Separator();

    [GeneratedRegex(@"^(?<n>\d+(?:\.\d+)?)\s*(?<u>g|ml)?\b\s*", RegexOptions.IgnoreCase)]
    private static partial Regex Amount();
}
