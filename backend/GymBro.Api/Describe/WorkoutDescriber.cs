using GymBro.Api.Training;

namespace GymBro.Api.Describe;

/// <summary>An exercise from a description, checked against the library: its sets keep only what it measures.</summary>
public sealed record DescribedExercise(string ExerciseId, bool Superset, IReadOnlyList<WorkoutPartSet> Sets);

/// <summary>
/// Turns a model's reading of a workout into exercises the workout screen can take (README → Describe a workout).
/// An id that isn't in the library is left out and named back. Each set keeps the values its exercise measures
/// (weight and reps, reps, a time, a distance and a time, a weight and a distance), within the workout's limits;
/// a set with none of them goes. The same exercise twice is one, its sets together.
/// </summary>
public static class WorkoutDescriber
{
    public const int MaxText = 500;
    public const int MaxExercises = 15;
    public const int MaxSets = 20;

    public static (IReadOnlyList<DescribedExercise> Exercises, IReadOnlyList<string> Unmatched) Resolve(IReadOnlyList<WorkoutPart> parts, ExerciseLibrary library)
    {
        var exercises = new List<DescribedExercise>();
        var unmatched = new List<string>();
        foreach (var part in parts)
        {
            var exercise = part.ExerciseId is { Length: > 0 } id ? library.Find(id) : null;
            if (exercise is null)
            {
                var name = part.Name.Trim();
                if (name.Length > 0 && !unmatched.Contains(name, StringComparer.OrdinalIgnoreCase))
                {
                    unmatched.Add(name.Length <= 60 ? name : name[..60]);
                }

                continue;
            }

            var sets = part.Sets.Select(set => Keep(set, exercise.Measure)).OfType<WorkoutPartSet>().ToList();
            // Named with no sets ("then some planks"): one empty set to fill in.
            if (sets.Count == 0)
            {
                sets.Add(new WorkoutPartSet(null, null, null, null));
            }

            var at = exercises.FindIndex(item => item.ExerciseId == exercise.Id);
            if (at >= 0)
            {
                exercises[at] = exercises[at] with { Sets = [.. exercises[at].Sets.Concat(sets).Take(MaxSets)] };
                continue;
            }

            if (exercises.Count < MaxExercises)
            {
                exercises.Add(new DescribedExercise(exercise.Id, part.Superset && exercises.Count > 0, [.. sets.Take(MaxSets)]));
            }
        }

        return (exercises, unmatched);
    }

    /// <summary>The values an exercise measures, each within the workout's limits; null when none is left.</summary>
    private static WorkoutPartSet? Keep(WorkoutPartSet set, string measure)
    {
        var weight = measure is ExerciseMeasure.WeightReps or ExerciseMeasure.WeightDistance;
        var reps = measure is ExerciseMeasure.WeightReps or ExerciseMeasure.Reps;
        var time = measure is ExerciseMeasure.Time or ExerciseMeasure.DistanceTime;
        var distance = measure is ExerciseMeasure.DistanceTime or ExerciseMeasure.WeightDistance;
        var kept = new WorkoutPartSet(
            weight && set.Kg is > 0 and <= WorkoutRules.MaxKg ? Math.Round(set.Kg.Value, 2) : null,
            reps && set.Reps is > 0 and <= WorkoutRules.MaxReps ? set.Reps : null,
            time && set.Seconds is > 0 and <= WorkoutRules.MaxSeconds ? set.Seconds : null,
            distance && set.Metres is > 0 and <= WorkoutRules.MaxMetres ? Math.Round(set.Metres.Value, 1) : null);
        return kept is { Kg: null, Reps: null, Seconds: null, Metres: null } ? null : kept;
    }
}
