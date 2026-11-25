namespace GymBro.Api.Data;

/// <summary>
/// One workout done (or skipped), with its sets in order. The app makes the id, so a workout finished
/// offline can be sent again without being saved twice (docs/training.md, Data model).
/// </summary>
public sealed class WorkoutSession
{
    public Guid Id { get; set; }

    public string UserId { get; set; } = "";

    /// <summary>One of <see cref="Training.WorkoutKinds"/>.</summary>
    public string Kind { get; set; } = Training.WorkoutKinds.Strength;

    /// <summary>The day it was done, in the person's time zone.</summary>
    public DateOnly LocalDate { get; set; }

    /// <summary>The person's own name for it, or null for an unnamed free workout.</summary>
    public string? Name { get; set; }

    /// <summary>One of <see cref="Training.WorkoutStatuses"/>.</summary>
    public string Status { get; set; } = Training.WorkoutStatuses.Done;

    public DateTimeOffset? StartedAt { get; set; }

    public DateTimeOffset? EndedAt { get; set; }

    public string? Notes { get; set; }

    /// <summary>The plan workout it came from. Plans arrive in phase 3, so this is null until then.</summary>
    public Guid? PlanWorkoutId { get; set; }

    /// <summary>Its place in the plan's sequence, with <see cref="PlanWorkoutId"/>.</summary>
    public int? SequencePosition { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public List<WorkoutSet> Sets { get; set; } = [];
}
