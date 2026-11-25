namespace GymBro.Api.Data;

/// <summary>
/// One set in a workout. Which fields are filled depends on the exercise's measure (weight × reps, reps,
/// time, distance + time, weight × distance); the rest stay null. The user id is copied from the session so
/// "last time on this exercise" is one indexed query.
/// </summary>
public sealed class WorkoutSet
{
    public Guid Id { get; set; }

    public Guid SessionId { get; set; }

    public string UserId { get; set; } = "";

    /// <summary>An id from the exercise library (<see cref="Training.ExerciseLibrary"/>).</summary>
    public string ExerciseId { get; set; } = "";

    /// <summary>Sets with the same block are done together: one exercise's sets, or a superset.</summary>
    public int Block { get; set; }

    /// <summary>The set's place in the workout, from 0.</summary>
    public int Position { get; set; }

    /// <summary>One of <see cref="Training.SetTypes"/>.</summary>
    public string Type { get; set; } = Training.SetTypes.Working;

    public int? Reps { get; set; }

    public decimal? Kg { get; set; }

    /// <summary>Reps in reserve: how many more could have been done.</summary>
    public int? Rir { get; set; }

    public int? Seconds { get; set; }

    public decimal? Metres { get; set; }

    public int? Calories { get; set; }

    /// <summary>When it was ticked off, or null for a set planned but not done.</summary>
    public DateTimeOffset? DoneAt { get; set; }
}
