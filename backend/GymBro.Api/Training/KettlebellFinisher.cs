namespace GymBro.Api.Training;

/// <summary>
/// A kettlebell plan's finisher (docs/training.md, phase 6). When the kit is kettlebells and body weight, with no
/// dumbbells or barbell, each workout ends on the clock: the A workouts with a swing EMOM, the B workouts with an
/// AMRAP of a clean, a press and a squat. It takes its minutes from the workout's time, from 30 minutes up.
/// </summary>
public static class KettlebellFinisher
{
    /// <summary>The shortest workout with a finisher.</summary>
    public const int FromMinutes = 30;

    /// <summary>One way to do a finisher's exercise: the exercise, what it loads, and the reps each round.</summary>
    private sealed record Option(string Id, string[] Loads, int Reps);

    /// <summary>Each exercise's options in order; one that's already in the workout or loads a go-easy area is passed over.</summary>
    private static readonly Option[][] Emom =
    [
        [new("kettlebell-swing", [Joints.LowerBack, Joints.Hips], 15), new("one-arm-kettlebell-swings", [Joints.LowerBack, Joints.Hips], 10), new("goblet-squat", [Joints.Knees], 10)],
        [new("pushups", [Joints.Wrists, Joints.Shoulders], 5), new("bodyweight-squat", [Joints.Knees], 10), new("mountain-climbers", [Joints.Wrists], 20)],
    ];

    private static readonly Option[][] Amrap =
    [
        [new("one-arm-kettlebell-clean", [Joints.LowerBack, Joints.Wrists], 5), new("kettlebell-dead-clean", [Joints.LowerBack], 5), new("kettlebell-swing", [Joints.LowerBack, Joints.Hips], 10)],
        [new("one-arm-kettlebell-push-press", [Joints.Shoulders], 5), new("two-arm-kettlebell-military-press", [Joints.Shoulders], 5), new("pushups", [Joints.Wrists, Joints.Shoulders], 8)],
        [new("goblet-squat", [Joints.Knees], 8), new("kettlebell-one-legged-deadlift", [Joints.Hips], 6), new("bodyweight-squat", [Joints.Knees], 12)],
    ];

    public static bool Applies(IReadOnlySet<string> kit, PlanAnswers answers) =>
        answers.Goal != PlanGoals.Hyrox && answers.Minutes >= FromMinutes
        && kit.Contains(Kit.Kettlebell) && !kit.Contains(Kit.Dumbbell) && !kit.Contains(Kit.Barbell);

    /// <summary>The finisher's minutes: an EMOM of 8, 10 or 12 by experience, an AMRAP of 6, 8 or 10.</summary>
    public static int MinutesFor(int variant, string experience) =>
        (variant % 2 == 0 ? 10 : 8) + experience switch { Experience.New => -2, Experience.Experienced => 2, _ => 0 };

    /// <summary>Its time in the workout: its minutes and the changeover to it.</summary>
    public static int Seconds(int variant, string experience) => MinutesFor(variant, experience) * 60 + PlanGenerator.Changeover;

    /// <summary>
    /// The finisher for a workout: a block of two or three exercises not already in it, the first carrying the
    /// clock and its minutes. An EMOM has a set for each minute (up to the editor's 10; starting it fits the rest);
    /// an AMRAP starts with 3 and adds rounds as they're done.
    /// None when fewer than two exercises fit.
    /// </summary>
    public static IReadOnlyList<PlanExercise> For(int variant, IReadOnlyList<PlanExercise> workout, PlanAnswers answers, ExerciseLibrary library)
    {
        var emom = variant % 2 == 0;
        var minutes = MinutesFor(variant, answers.Experience);
        var picked = new List<PlanExercise>();
        foreach (var options in emom ? Emom : Amrap)
        {
            var option = options.FirstOrDefault(item =>
                !item.Loads.Any(answers.GoEasy.Contains) && library.Find(item.Id) is not null
                && workout.All(done => done.ExerciseId != item.Id) && picked.All(done => done.ExerciseId != item.Id));
            if (option is not null)
            {
                picked.Add(new PlanExercise(option.Id, emom ? Math.Min(minutes, PlanEdits.MaxSets) : 3, option.Reps, option.Reps, null, 0, Superset: picked.Count > 0));
            }
        }

        if (picked.Count < 2)
        {
            return [];
        }

        picked[0] = picked[0] with { Format = emom ? BlockFormats.Emom : BlockFormats.Amrap, Minutes = minutes };
        return picked;
    }
}
