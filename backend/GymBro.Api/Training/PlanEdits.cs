namespace GymBro.Api.Training;

/// <summary>A plan workout's exercises as the editor sends them (docs/training.md, phase 5).</summary>
public sealed record PlanWorkoutRequest(IReadOnlyList<PlanExerciseRequest>? Exercises);

public sealed record PlanExerciseRequest(string? ExerciseId, int Sets, int? RepMin, int? RepMax, int? Seconds, int RestSeconds);

/// <summary>
/// Editing one workout of a plan by hand: its exercises, in order, with their sets, reps or hold, and rest. The rules
/// keep it something the workout screen can log: known exercises, each once, reps for lifts and seconds for holds.
/// </summary>
public static class PlanEdits
{
    public const int MaxExercises = 15;
    public const int MaxSets = 10;
    public const int MaxReps = 50;
    public const int MinSeconds = 5;
    public const int MaxSeconds = 600;
    public const int MaxRest = 600;

    public const string NoExercises = "A workout needs at least one exercise.";
    public static readonly string TooMany = $"A workout takes up to {MaxExercises} exercises.";
    public const string Unknown = "That exercise isn't in the library.";
    public const string Twice = "Each exercise can be in a workout once.";
    public static readonly string BadSets = $"Sets are 1 to {MaxSets}.";
    public static readonly string BadReps = $"Reps are 1 to {MaxReps}, the low end no more than the high end.";
    public static readonly string BadSeconds = $"A hold is {MinSeconds} to {MaxSeconds} seconds.";
    public static readonly string BadRest = $"Rest is 0 to {MaxRest} seconds.";

    /// <summary>The exercises to store, or what's wrong with them.</summary>
    public static (IReadOnlyList<PlanExercise>? Exercises, string? Error) Check(PlanWorkoutRequest request, ExerciseLibrary library)
    {
        var items = request.Exercises ?? [];
        if (items.Count == 0)
        {
            return (null, NoExercises);
        }

        if (items.Count > MaxExercises)
        {
            return (null, TooMany);
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var exercises = new List<PlanExercise>(items.Count);
        foreach (var item in items)
        {
            var exercise = item.ExerciseId is null ? null : library.Find(item.ExerciseId);
            if (exercise is null)
            {
                return (null, Unknown);
            }

            if (!seen.Add(exercise.Id))
            {
                return (null, Twice);
            }

            if (item.Sets is < 1 or > MaxSets)
            {
                return (null, BadSets);
            }

            if (item.RestSeconds is < 0 or > MaxRest)
            {
                return (null, BadRest);
            }

            // Lifts take a rep range; holds take seconds; cardio and carries take neither.
            var reps = exercise.Measure is ExerciseMeasure.WeightReps or ExerciseMeasure.Reps;
            var hold = exercise.Measure == ExerciseMeasure.Time;
            if (reps ? item.RepMin is not { } low || item.RepMax is not { } high || low < 1 || high > MaxReps || low > high
                     : item.RepMin is not null || item.RepMax is not null)
            {
                return (null, BadReps);
            }

            if (hold ? item.Seconds is not (>= MinSeconds and <= MaxSeconds) : item.Seconds is not null)
            {
                return (null, BadSeconds);
            }

            exercises.Add(new PlanExercise(exercise.Id, item.Sets, item.RepMin, item.RepMax, item.Seconds, item.RestSeconds));
        }

        return (exercises, null);
    }
}
