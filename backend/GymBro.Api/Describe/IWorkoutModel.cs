using GymBro.Api.Training;

namespace GymBro.Api.Describe;

/// <summary>
/// "Describe a workout" (docs/training.md, phase 6): one question to a model, which exercises from the library the
/// words name and the sets done of each. The model copies what the words say and never sets a load: a weight is
/// there only when the person wrote one.
/// </summary>
public interface IWorkoutModel
{
    /// <summary>Kept on each description so cost can be read back per model.</summary>
    string Name { get; }

    /// <remarks>Adds what the call cost to <paramref name="usage"/>, even when it then fails.</remarks>
    Task<IReadOnlyList<WorkoutPart>> ReadAsync(string text, ExerciseLibrary library, MealUsage usage, CancellationToken cancellationToken);
}

/// <summary>One exercise named in the words.</summary>
/// <param name="Name">How the words name it: "bench".</param>
/// <param name="ExerciseId">The library exercise it is, or null when none fits.</param>
/// <param name="Superset">Done as a superset or circuit with the one before.</param>
public sealed record WorkoutPart(string Name, string? ExerciseId, bool Superset, IReadOnlyList<WorkoutPartSet> Sets);

/// <summary>One set as the words give it. Each value is null when the words don't say it.</summary>
public sealed record WorkoutPartSet(decimal? Kg, int? Reps, int? Seconds, decimal? Metres);
