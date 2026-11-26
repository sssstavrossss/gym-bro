using System.Globalization;
using System.Text.RegularExpressions;
using GymBro.Api.Training;

namespace GymBro.Api.Describe;

/// <summary>
/// A stand-in for Claude in Testing and E2e, so tests are free and repeatable. Parts are split on commas, new lines
/// and "then"; in each, "3x8" is three sets of eight, "60 kg" a weight, "5 km" or "400 m" a distance, "25 min" or
/// "1:30" a time, and the words left are matched to a library id or name ("bench" and a few more are known). A part
/// starting with "+" is a superset with the one before. "decline" makes it decline, "fail" makes it fail.
/// </summary>
public sealed partial class RuleWorkoutModel : IWorkoutModel
{
    private static readonly Dictionary<string, string> Known = new(StringComparer.OrdinalIgnoreCase)
    {
        ["bench"] = "barbell-bench-press-medium-grip",
        ["bench press"] = "barbell-bench-press-medium-grip",
        ["squat"] = "barbell-squat",
        ["squats"] = "barbell-squat",
        ["deadlift"] = "barbell-deadlift",
        ["pull-ups"] = "pullups",
        ["pull ups"] = "pullups",
        ["push-ups"] = "pushups",
        ["push ups"] = "pushups",
        ["row"] = "rowing-stationary",
        ["swings"] = "kettlebell-swing",
    };

    public string Name => "rule";

    public Task<IReadOnlyList<WorkoutPart>> ReadAsync(string text, ExerciseLibrary library, MealUsage usage, CancellationToken cancellationToken)
    {
        usage.Add(0, 0);
        if (text.Contains("decline", StringComparison.OrdinalIgnoreCase))
        {
            throw new MealModelException("Claude declined.", refused: true);
        }

        if (text.Contains("fail", StringComparison.OrdinalIgnoreCase))
        {
            throw new MealModelException("Claude didn't answer.");
        }

        var byName = library.All
            .GroupBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First().Id, StringComparer.OrdinalIgnoreCase);
        var parts = new List<WorkoutPart>();
        foreach (var raw in Splitter().Split(text))
        {
            var part = raw.Trim();
            if (part.Length == 0)
            {
                continue;
            }

            var superset = part.StartsWith('+');
            part = part.TrimStart('+').Trim();
            int? count = null;
            int? reps = null;
            decimal? kg = null;
            decimal? metres = null;
            int? seconds = null;
            part = SetsTimesReps().Replace(part, match =>
            {
                count = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
                reps = int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture);
                return " ";
            });
            part = Kilos().Replace(part, match => { kg = Number(match.Groups[1].Value); return " "; });
            part = Kilometres().Replace(part, match => { metres = Number(match.Groups[1].Value) * 1000; return " "; });
            part = Metres().Replace(part, match => { metres = Number(match.Groups[1].Value); return " "; });
            part = Clock().Replace(part, match =>
            {
                seconds = (int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture) * 60) + int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture);
                return " ";
            });
            part = Minutes().Replace(part, match => { seconds = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture) * 60; return " "; });
            part = Seconds().Replace(part, match => { seconds = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture); return " "; });
            var name = Spaces().Replace(Filler().Replace(part, " "), " ").Trim();
            if (name.Length == 0)
            {
                continue;
            }

            var id = Known.GetValueOrDefault(name)
                ?? (library.Find(ExerciseCatalog.IdFrom(name)) is { } exercise ? exercise.Id : null)
                ?? byName.GetValueOrDefault(name);
            var set = new WorkoutPartSet(kg, reps, seconds, metres);
            IReadOnlyList<WorkoutPartSet> sets = count is { } n
                ? [.. Enumerable.Repeat(set, n)]
                : set is { Kg: null, Reps: null, Seconds: null, Metres: null } ? [] : [set];
            parts.Add(new WorkoutPart(name, id ?? "", superset, sets));
        }

        return Task.FromResult<IReadOnlyList<WorkoutPart>>(parts);
    }

    private static decimal Number(string text) => decimal.Parse(text.Replace(',', '.'), CultureInfo.InvariantCulture);

    [GeneratedRegex(@"\s*(?:[,;\n]|\bthen\b)\s*", RegexOptions.IgnoreCase)]
    private static partial Regex Splitter();

    [GeneratedRegex(@"\b(\d{1,2})\s*[x×]\s*(\d{1,4})\b", RegexOptions.IgnoreCase)]
    private static partial Regex SetsTimesReps();

    [GeneratedRegex(@"(\d+(?:\.\d+)?)\s*kg\b", RegexOptions.IgnoreCase)]
    private static partial Regex Kilos();

    [GeneratedRegex(@"(\d+(?:\.\d+)?)\s*km\b", RegexOptions.IgnoreCase)]
    private static partial Regex Kilometres();

    [GeneratedRegex(@"(\d+)\s*m\b", RegexOptions.IgnoreCase)]
    private static partial Regex Metres();

    [GeneratedRegex(@"\b(\d{1,3}):([0-5]\d)\b")]
    private static partial Regex Clock();

    [GeneratedRegex(@"(\d+)\s*min\b", RegexOptions.IgnoreCase)]
    private static partial Regex Minutes();

    [GeneratedRegex(@"(\d+)\s*(?:s|sec)\b", RegexOptions.IgnoreCase)]
    private static partial Regex Seconds();

    [GeneratedRegex(@"\b(?:in|at|for|of|and|did|some)\b", RegexOptions.IgnoreCase)]
    private static partial Regex Filler();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();
}
