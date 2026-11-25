namespace GymBro.Api.Training;

/// <summary>A movement the generator fills with one exercise: a squat, a hinge, a row and so on.</summary>
public enum Slot
{
    Squat,
    Hinge,
    Lunge,
    HorizontalPush,
    VerticalPush,
    HorizontalPull,
    VerticalPull,
    Glutes,
    QuadIsolation,
    HamstringIsolation,
    Calves,
    ChestIsolation,
    SideDelts,
    RearDelts,
    Biceps,
    Triceps,
    Core,
}

/// <summary>
/// A well-known lift the generator may pick (docs/training.md, decision 5: the <c>core</c> flag).
/// <paramref name="Kit"/> is what it needs, any one of them. <paramref name="Loads"/> are the areas it loads hardest,
/// which "Go easy on" leaves out. <paramref name="Hard"/> keeps it from New plans. <paramref name="StrengthOnly"/>
/// keeps it to strength plans.
/// </summary>
public sealed record CoreExercise(
    string Id,
    Slot Slot,
    string[] Kit,
    string[] Loads,
    bool Hard = false,
    bool StrengthOnly = false);

/// <summary>
/// The core exercises, by slot, in the order the generator prefers them. A plan's second workout of a kind
/// (Upper B after Upper A) takes the next one that fits, so the two differ.
/// </summary>
public static class CoreExercises
{
    private static readonly string[] None = [];

    public static readonly IReadOnlyList<CoreExercise> All =
    [
        new("barbell-squat", Slot.Squat, [Kit.Barbell], [Joints.Knees, Joints.LowerBack]),
        new("hack-squat", Slot.Squat, [Kit.Machine], [Joints.Knees]),
        new("leg-press", Slot.Squat, [Kit.Machine], [Joints.Knees]),
        new("goblet-squat", Slot.Squat, [Kit.Dumbbell, Kit.Kettlebell], [Joints.Knees]),
        new("front-squats-with-two-kettlebells", Slot.Squat, [Kit.Kettlebell], [Joints.Knees, Joints.Wrists]),
        new("bodyweight-squat", Slot.Squat, [Kit.Bodyweight], [Joints.Knees]),

        new("barbell-deadlift", Slot.Hinge, [Kit.Barbell], [Joints.LowerBack, Joints.Hips], StrengthOnly: true),
        new("romanian-deadlift", Slot.Hinge, [Kit.Barbell], [Joints.LowerBack]),
        new("stiff-legged-dumbbell-deadlift", Slot.Hinge, [Kit.Dumbbell], [Joints.LowerBack]),
        new("kettlebell-swing", Slot.Hinge, [Kit.Kettlebell], [Joints.LowerBack, Joints.Hips]),
        new("kettlebell-one-legged-deadlift", Slot.Hinge, [Kit.Kettlebell], [Joints.Hips]),
        new("pull-through", Slot.Hinge, [Kit.Cable], None),
        new("single-leg-glute-bridge", Slot.Hinge, [Kit.Bodyweight], None),

        new("split-squat-with-dumbbells", Slot.Lunge, [Kit.Dumbbell], [Joints.Knees]),
        new("dumbbell-lunges", Slot.Lunge, [Kit.Dumbbell], [Joints.Knees]),
        new("barbell-walking-lunge", Slot.Lunge, [Kit.Barbell], [Joints.Knees]),
        new("dumbbell-step-ups", Slot.Lunge, [Kit.Dumbbell], [Joints.Knees]),
        new("lunge-pass-through", Slot.Lunge, [Kit.Kettlebell], [Joints.Knees]),
        new("bodyweight-walking-lunge", Slot.Lunge, [Kit.Bodyweight], [Joints.Knees]),

        new("barbell-bench-press-medium-grip", Slot.HorizontalPush, [Kit.Barbell], [Joints.Shoulders]),
        new("dumbbell-bench-press", Slot.HorizontalPush, [Kit.Dumbbell], [Joints.Shoulders]),
        new("incline-dumbbell-press", Slot.HorizontalPush, [Kit.Dumbbell], [Joints.Shoulders]),
        new("leverage-chest-press", Slot.HorizontalPush, [Kit.Machine], None),
        new("one-arm-kettlebell-floor-press", Slot.HorizontalPush, [Kit.Kettlebell], None),
        new("pushups", Slot.HorizontalPush, [Kit.Bodyweight], [Joints.Wrists]),

        new("standing-military-press", Slot.VerticalPush, [Kit.Barbell], [Joints.Shoulders, Joints.LowerBack]),
        new("seated-dumbbell-press", Slot.VerticalPush, [Kit.Dumbbell], [Joints.Shoulders]),
        new("machine-shoulder-military-press", Slot.VerticalPush, [Kit.Machine], [Joints.Shoulders]),
        new("two-arm-kettlebell-military-press", Slot.VerticalPush, [Kit.Kettlebell], [Joints.Shoulders]),

        new("bent-over-barbell-row", Slot.HorizontalPull, [Kit.Barbell], [Joints.LowerBack]),
        new("seated-cable-rows", Slot.HorizontalPull, [Kit.Cable], None),
        new("one-arm-dumbbell-row", Slot.HorizontalPull, [Kit.Dumbbell], None),
        new("one-arm-kettlebell-row", Slot.HorizontalPull, [Kit.Kettlebell], None),
        new("inverted-row", Slot.HorizontalPull, [Kit.Bodyweight], None),

        new("wide-grip-lat-pulldown", Slot.VerticalPull, [Kit.Cable], None),
        new("pullups", Slot.VerticalPull, [Kit.Bar], [Joints.Shoulders, Joints.Elbows], Hard: true),
        new("chin-up", Slot.VerticalPull, [Kit.Bar], [Joints.Elbows, Joints.Wrists], Hard: true),
        new("straight-arm-dumbbell-pullover", Slot.VerticalPull, [Kit.Dumbbell], [Joints.Shoulders]),

        new("barbell-hip-thrust", Slot.Glutes, [Kit.Barbell], None),
        new("barbell-glute-bridge", Slot.Glutes, [Kit.Barbell], None),
        new("single-leg-glute-bridge", Slot.Glutes, [Kit.Bodyweight], None),

        new("leg-extensions", Slot.QuadIsolation, [Kit.Machine], [Joints.Knees]),
        new("lying-leg-curls", Slot.HamstringIsolation, [Kit.Machine], None),
        new("seated-leg-curl", Slot.HamstringIsolation, [Kit.Machine], None),

        new("standing-calf-raises", Slot.Calves, [Kit.Machine], [Joints.Ankles]),
        new("seated-calf-raise", Slot.Calves, [Kit.Machine], [Joints.Ankles]),
        new("standing-dumbbell-calf-raise", Slot.Calves, [Kit.Dumbbell], [Joints.Ankles]),

        new("cable-crossover", Slot.ChestIsolation, [Kit.Cable], [Joints.Shoulders]),
        new("dumbbell-flyes", Slot.ChestIsolation, [Kit.Dumbbell], [Joints.Shoulders]),

        new("side-lateral-raise", Slot.SideDelts, [Kit.Dumbbell], [Joints.Shoulders]),
        new("cable-seated-lateral-raise", Slot.SideDelts, [Kit.Cable], [Joints.Shoulders]),

        new("face-pull", Slot.RearDelts, [Kit.Cable], None),
        new("reverse-flyes", Slot.RearDelts, [Kit.Dumbbell], None),
        new("seated-bent-over-rear-delt-raise", Slot.RearDelts, [Kit.Dumbbell], None),

        new("dumbbell-bicep-curl", Slot.Biceps, [Kit.Dumbbell], [Joints.Elbows]),
        new("barbell-curl", Slot.Biceps, [Kit.Barbell], [Joints.Elbows, Joints.Wrists]),
        new("hammer-curls", Slot.Biceps, [Kit.Dumbbell], None),
        new("cable-hammer-curls-rope-attachment", Slot.Biceps, [Kit.Cable], None),

        new("triceps-pushdown", Slot.Triceps, [Kit.Cable], [Joints.Elbows]),
        new("lying-triceps-press", Slot.Triceps, [Kit.Barbell], [Joints.Elbows]),
        new("standing-dumbbell-triceps-extension", Slot.Triceps, [Kit.Dumbbell], [Joints.Elbows, Joints.Shoulders]),
        new("kettlebell-overhead-triceps-extension", Slot.Triceps, [Kit.Kettlebell], [Joints.Elbows, Joints.Shoulders]),
        new("bench-dips", Slot.Triceps, [Kit.Bodyweight], [Joints.Shoulders, Joints.Wrists]),

        new("plank", Slot.Core, [Kit.Bodyweight], None),
        new("dead-bug", Slot.Core, [Kit.Bodyweight], None),
        new("pallof-press", Slot.Core, [Kit.Cable], None),
        new("hanging-leg-raise", Slot.Core, [Kit.Bar], [Joints.Shoulders], Hard: true),
    ];

    /// <summary>The ones that fit: the kit is there, nothing loads a go-easy area, and the level and goal allow it.</summary>
    public static IReadOnlyList<CoreExercise> Fitting(Slot slot, IReadOnlySet<string> kit, IReadOnlyCollection<string> goEasy, string experience, string goal) =>
        All.Where(item => item.Slot == slot
                && item.Kit.Any(kit.Contains)
                && !item.Loads.Any(goEasy.Contains)
                && !(item.Hard && experience == Experience.New)
                && !(item.StrengthOnly && goal != PlanGoals.Strength))
            .ToList();
}
