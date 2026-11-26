namespace GymBro.Api.Data;

/// <summary>
/// A person's training plan: the setup's answers and the workouts made from them, in sequence order
/// (docs/training.md, Data model). One per person; a new plan replaces it.
/// </summary>
public sealed class TrainingPlan
{
    public Guid Id { get; set; }

    public string UserId { get; set; } = "";

    /// <summary>One of <see cref="Training.PlanGoals"/>.</summary>
    public string Goal { get; set; } = Training.PlanGoals.Muscle;

    /// <summary>Days of the week, 0 = Monday. They only date sessions on the calendar.</summary>
    public int[] Weekdays { get; set; } = [];

    public int Minutes { get; set; }

    /// <summary>One of <see cref="Training.Experience"/>.</summary>
    public string Experience { get; set; } = Training.Experience.Some;

    /// <summary><see cref="Training.EquipmentPresets"/> names.</summary>
    public string[] Equipment { get; set; } = [];

    /// <summary><see cref="Training.Joints"/> names. Stored, because the generator uses them.</summary>
    public string[] GoEasy { get; set; } = [];

    public bool EaseIn { get; set; }

    /// <summary>A mobility warm-up before each workout (<see cref="Training.Mobility"/>).</summary>
    public bool WarmUp { get; set; }

    /// <summary>A cool-down of stretches after each workout (<see cref="Training.Mobility"/>).</summary>
    public bool CoolDown { get; set; }

    /// <summary>One of <see cref="Training.Splits"/>.</summary>
    public string Split { get; set; } = Training.Splits.FullBody;

    public int BlockWeeks { get; set; }

    /// <summary>The person's day the plan began, kept when the plan is changed.</summary>
    public DateOnly StartDate { get; set; }

    /// <summary>JSON list of <see cref="Training.PlanWorkout"/>, in sequence order.</summary>
    public string Workouts { get; set; } = "[]";

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
