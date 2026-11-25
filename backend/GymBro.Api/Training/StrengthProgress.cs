namespace GymBro.Api.Training;

/// <summary>One day's best set on a lift.</summary>
public sealed record StrengthPoint(DateOnly Date, decimal EstimatedMax, decimal Kg, int Reps);

/// <summary>A lift's estimated max over a range: a point per day it was done, newest last.</summary>
public sealed record LiftProgress(string ExerciseId, decimal Current, decimal Best, decimal? Change, IReadOnlyList<StrengthPoint> Points);

/// <summary>A set as the strength page reads it.</summary>
public sealed record ScoredSet(DateOnly Date, string ExerciseId, string Type, decimal? Kg, int? Reps, int? Rir);

/// <summary>Progress → Strength: estimated max per lift (<see cref="EstimatedMax"/>), from done workouts in the range.</summary>
public static class StrengthProgress
{
    /// <summary>
    /// Each lift with a scored set, its best set per day, the latest and best estimates, and the change from the
    /// first day to the last (null with one day). Most often done first, then the heaviest.
    /// </summary>
    public static IReadOnlyList<LiftProgress> Lifts(IEnumerable<ScoredSet> sets)
    {
        var scored = sets
            .Select(set => (set, max: EstimatedMax.Of(set.Type, set.Kg, set.Reps, set.Rir)))
            .Where(row => row.max is not null);
        var lifts = new List<LiftProgress>();
        foreach (var lift in scored.GroupBy(row => row.set.ExerciseId))
        {
            var points = lift
                .GroupBy(row => row.set.Date)
                .OrderBy(day => day.Key)
                .Select(day =>
                {
                    var top = day.OrderByDescending(row => row.max).First();
                    return new StrengthPoint(day.Key, top.max!.Value, top.set.Kg!.Value, top.set.Reps!.Value);
                })
                .ToList();
            var current = points[^1].EstimatedMax;
            var change = points.Count > 1 ? current - points[0].EstimatedMax : (decimal?)null;
            lifts.Add(new LiftProgress(lift.Key, current, points.Max(point => point.EstimatedMax), change, points));
        }

        return lifts
            .OrderByDescending(lift => lift.Points.Count)
            .ThenByDescending(lift => lift.Current)
            .ThenBy(lift => lift.ExerciseId, StringComparer.Ordinal)
            .ToList();
    }
}
