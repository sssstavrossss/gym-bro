namespace GymBro.Api.Training;

/// <summary>
/// One exercise in a plan workout: how many working sets, the rep range (or seconds, for a hold, or metres, for a
/// run or a carry) and the rest. The load is not set here: the first session asks for a weight that leaves about 3
/// reps (docs/training.md, Rules). <paramref name="Superset"/> joins it to the exercise before, as a workout's
/// superset or circuit; the first of a circuit can carry a clock, <paramref name="Format"/> (a <see cref="BlockFormats"/> value).
/// </summary>
public sealed record PlanExercise(
    string ExerciseId,
    int Sets,
    int? RepMin,
    int? RepMax,
    int? Seconds,
    int RestSeconds,
    int? Metres = null,
    bool Superset = false,
    string? Format = null);

/// <summary>
/// A workout in the plan's sequence, like Upper A. Its id is what a session done from it points at.
/// <paramref name="Edited"/> is set once its exercises were changed by hand; remaking the plan drops that.
/// </summary>
public sealed record PlanWorkout(Guid Id, string Name, int Minutes, IReadOnlyList<PlanExercise> Exercises, bool Edited = false);

/// <summary>
/// Builds a plan from the setup's answers with fixed rules, no AI (docs/training.md, Rules). The split gives the
/// workouts and each workout's movements in order of priority; each movement takes the first core exercise that
/// fits the kit, the go-easy areas and the experience; movements are added while the workout fits the time.
/// </summary>
public static class PlanGenerator
{
    /// <summary>A workout's movements, most important first. Later ones drop out when time is short.</summary>
    private static readonly IReadOnlyDictionary<string, Slot[]> Templates = new Dictionary<string, Slot[]>
    {
        ["full-a"] = [Slot.Squat, Slot.HorizontalPush, Slot.HorizontalPull, Slot.Hinge, Slot.VerticalPush, Slot.Biceps, Slot.Triceps, Slot.Calves, Slot.Core],
        ["full-b"] = [Slot.Hinge, Slot.VerticalPush, Slot.VerticalPull, Slot.Lunge, Slot.HorizontalPush, Slot.RearDelts, Slot.Triceps, Slot.Biceps, Slot.Core],
        ["upper-a"] = [Slot.HorizontalPush, Slot.HorizontalPull, Slot.VerticalPush, Slot.VerticalPull, Slot.SideDelts, Slot.Biceps, Slot.Triceps, Slot.ChestIsolation, Slot.RearDelts],
        ["upper-b"] = [Slot.VerticalPull, Slot.HorizontalPush, Slot.HorizontalPull, Slot.VerticalPush, Slot.RearDelts, Slot.Triceps, Slot.Biceps, Slot.SideDelts, Slot.ChestIsolation],
        ["lower-a"] = [Slot.Squat, Slot.Hinge, Slot.Lunge, Slot.HamstringIsolation, Slot.QuadIsolation, Slot.Calves, Slot.Core],
        ["lower-b"] = [Slot.Hinge, Slot.Squat, Slot.Glutes, Slot.Lunge, Slot.HamstringIsolation, Slot.Calves, Slot.Core],
        ["push"] = [Slot.HorizontalPush, Slot.VerticalPush, Slot.HorizontalPush, Slot.SideDelts, Slot.Triceps, Slot.ChestIsolation, Slot.Triceps],
        ["pull"] = [Slot.VerticalPull, Slot.HorizontalPull, Slot.HorizontalPull, Slot.RearDelts, Slot.Biceps, Slot.Biceps, Slot.Core],
        ["legs"] = [Slot.Squat, Slot.Hinge, Slot.Lunge, Slot.QuadIsolation, Slot.HamstringIsolation, Slot.Calves, Slot.Core],
    };

    /// <summary>Warming up before the first lift, in seconds. Short workouts keep it brief.</summary>
    private const int WarmUp = 300;
    private const int ShortWarmUp = 120;
    private const int ShortMinutes = 20;

    /// <summary>Moving to the next exercise: setting up, loading, finding the bench.</summary>
    public const int Changeover = 60;

    /// <summary>A working set of reps, in seconds.</summary>
    private const int SetWork = 40;

    /// <summary>The split's workouts in sequence order: a name, a template and which variant of each movement.</summary>
    public static IReadOnlyList<(string Name, string Template, int Variant)> Sequence(string split, int days) => split switch
    {
        Splits.Custom => [.. Enumerable.Range(0, days).Select(index => (CustomName(index), "", 0))],
        // Hyrox: strength days between circuits of the race's stations, and run intervals from three days a week.
        Splits.Hyrox when days >= 3 =>
            [("Strength A", "full-a", 0), ("Stations A", HyroxPlan.StationsA, 0), ("Runs A", HyroxPlan.RunsA, 0),
             ("Strength B", "full-b", 1), ("Stations B", HyroxPlan.StationsB, 1), ("Runs B", HyroxPlan.RunsB, 1)],
        Splits.Hyrox => [("Strength A", "full-a", 0), ("Stations A", HyroxPlan.StationsA, 0), ("Strength B", "full-b", 1), ("Stations B", HyroxPlan.StationsB, 1)],
        Splits.UpperLower => [("Upper A", "upper-a", 0), ("Lower A", "lower-a", 0), ("Upper B", "upper-b", 1), ("Lower B", "lower-b", 1)],
        Splits.PushPullLegs when days >= 6 =>
            [("Push A", "push", 0), ("Pull A", "pull", 0), ("Legs A", "legs", 0), ("Push B", "push", 1), ("Pull B", "pull", 1), ("Legs B", "legs", 1)],
        Splits.PushPullLegs => [("Push", "push", 0), ("Pull", "pull", 0), ("Legs", "legs", 0)],
        Splits.PplUpperLower => [("Push", "push", 0), ("Pull", "pull", 0), ("Legs", "legs", 0), ("Upper", "upper-b", 1), ("Lower", "lower-b", 1)],
        _ => [("Full body A", "full-a", 0), ("Full body B", "full-b", 1)],
    };

    /// <summary>
    /// The plan's workouts. <paramref name="keepIds"/> are the current plan's workout ids: a new plan with the same
    /// split keeps them, so the sequence carries on where it was instead of starting again at A.
    /// </summary>
    public static IReadOnlyList<PlanWorkout> Generate(PlanAnswers answers, ExerciseLibrary library, IReadOnlyList<Guid>? keepIds = null, Func<Guid>? newId = null)
    {
        newId ??= Guid.NewGuid;
        var kit = EquipmentPresets.KitOf(answers.Equipment);
        var sequence = Sequence(answers.Split, answers.Weekdays.Count);
        var workouts = new List<PlanWorkout>(sequence.Count);
        for (var index = 0; index < sequence.Count; index++)
        {
            var (name, template, variant) = sequence[index];
            var id = keepIds is not null && keepIds.Count == sequence.Count ? keepIds[index] : newId();
            if (answers.Split == Splits.Custom)
            {
                workouts.Add(new PlanWorkout(id, name, 0, []));
                continue;
            }

            var (exercises, seconds) = HyroxPlan.IsConditioning(template)
                ? HyroxPlan.Fill(template, kit, answers, library, WarmUpFor(answers.Minutes))
                : Fill(Templates[template], variant, kit, answers, library);
            workouts.Add(new PlanWorkout(id, name, RoundMinutes(seconds), exercises));
        }

        return workouts;
    }

    private static (List<PlanExercise> Exercises, int Seconds) Fill(Slot[] slots, int variant, IReadOnlySet<string> kit, PlanAnswers answers, ExerciseLibrary library)
    {
        var budget = answers.Minutes * 60;
        var total = WarmUpFor(answers.Minutes);
        var picked = new List<PlanExercise>();
        var seen = new Dictionary<Slot, int>();
        foreach (var slot in slots)
        {
            // A movement that comes twice in a workout (two presses on Push) takes the next exercise the second time.
            var repeat = seen.GetValueOrDefault(slot);
            seen[slot] = repeat + 1;
            var fitting = CoreExercises.Fitting(slot, kit, answers.GoEasy, answers.Experience, answers.Goal)
                .Where(item => library.Find(item.Id) is not null && picked.All(done => done.ExerciseId != item.Id))
                .ToList();
            if (fitting.Count == 0)
            {
                continue;
            }

            // A strength plan opens every workout with its main barbell lift, so the B workouts don't swap it out.
            var first = picked.Count == 0;
            var shift = first && answers.Goal == PlanGoals.Strength ? 0 : variant;
            var core = fitting[(shift + repeat) % fitting.Count];
            var prescription = Prescribe(library.Find(core.Id)!, Compound(slot), first, answers);
            var seconds = Duration(prescription);
            // Always at least two exercises, however short the time. One that doesn't fit leaves room for a shorter one.
            if (picked.Count >= 2 && total + seconds > budget)
            {
                continue;
            }

            picked.Add(prescription);
            total += seconds;
        }

        return (picked, total);
    }

    /// <summary>
    /// The big movements, which take the compound rep range and rest. Isolation and core slots don't, whatever the
    /// source calls the exercise (it calls face pulls and dead bugs compound).
    /// </summary>
    public static bool Compound(Slot slot) => slot is Slot.Squat or Slot.Hinge or Slot.Lunge or Slot.HorizontalPush
        or Slot.VerticalPush or Slot.HorizontalPull or Slot.VerticalPull or Slot.Glutes;

    /// <summary>Sets, reps and rest for one exercise (docs/training.md, Rules: rep ranges, rest defaults).</summary>
    public static PlanExercise Prescribe(Exercise exercise, bool compound, bool first, PlanAnswers answers)
    {
        var experienced = answers.Experience == Experience.Experienced;
        var isNew = answers.Experience == Experience.New;
        var sets = compound ? (experienced ? 4 : 3) : (isNew ? 2 : 3);
        if (answers.Minutes <= ShortMinutes)
        {
            sets = Math.Min(sets, 2);
        }

        var rest = Rest(exercise, compound, answers.Goal, first);
        if (exercise.Measure == ExerciseMeasure.Time)
        {
            var hold = isNew ? 30 : experienced ? 60 : 45;
            return new PlanExercise(exercise.Id, sets, null, null, hold, rest);
        }

        var (low, high) = exercise.Measure == ExerciseMeasure.Reps
            ? compound ? (8, 15) : (10, 20)
            : answers.Goal switch
            {
                PlanGoals.Strength when compound && first => (3, 6),
                PlanGoals.Strength when compound => (6, 8),
                PlanGoals.Strength => (8, 12),
                PlanGoals.Fitness when compound => (8, 12),
                PlanGoals.Fitness => (12, 15),
                _ when compound => (6, 10),
                _ => (10, 15),
            };
        if (answers.Goal == PlanGoals.Strength && compound && first && exercise.Measure == ExerciseMeasure.WeightReps)
        {
            sets = Math.Max(sets, answers.Minutes <= ShortMinutes ? 2 : 4);
        }

        return new PlanExercise(exercise.Id, sets, low, high, null, rest);
    }

    /// <summary>
    /// Rest between sets: heavy leg and hip compounds 3:00, other compounds 2:00, isolation 1:30 (as the workout
    /// screen's timer), a minute between holds. A strength plan's first, heaviest lift gets a minute more; fitness
    /// takes a third off.
    /// </summary>
    public static int Rest(Exercise exercise, bool compound, string goal, bool first = false)
    {
        if (exercise.Measure == ExerciseMeasure.Time)
        {
            return 60;
        }

        var lower = exercise.PrimaryMuscles.Any(muscle => muscle is "quadriceps" or "hamstrings" or "glutes" or "lower-back");
        var rest = compound ? (lower ? 180 : 120) : 90;
        return goal switch
        {
            PlanGoals.Strength when compound && first => rest + 60,
            PlanGoals.Fitness => (int)(Math.Round(rest * 2 / 3.0 / 15) * 15),
            _ => rest,
        };
    }

    /// <summary>An exercise's time in the workout: each set's work and rest, and the changeover to it.</summary>
    public static int Duration(PlanExercise exercise) => exercise.Sets * (Work(exercise) + exercise.RestSeconds) + Changeover;

    /// <summary>
    /// One set's work, in seconds: a hold's time; a distance at about 5:00 a km (a run, a row) or, under 300 m, a slow
    /// 45 s and a half second a metre (a sled, a carry); else 40 s of reps.
    /// </summary>
    public static int Work(PlanExercise exercise) => exercise.Seconds
        ?? (exercise.Metres is { } metres ? (metres >= 300 ? metres * 3 / 10 : 45 + metres / 2) : SetWork);

    private static int WarmUpFor(int minutes) => minutes <= ShortMinutes ? ShortWarmUp : WarmUp;

    /// <summary>"Workout A" to "Workout G": your own plan's workouts until you name them.</summary>
    public static string CustomName(int index) => $"Workout {(char)('A' + index)}";

    /// <summary>
    /// Your own plan after a change of answers: its workouts stay as you made them. More days add empty ones at the
    /// end; fewer drop the last ones.
    /// </summary>
    public static IReadOnlyList<PlanWorkout> KeepCustom(IReadOnlyList<PlanWorkout> current, int days, Func<Guid>? newId = null)
    {
        newId ??= Guid.NewGuid;
        var kept = current.Take(days).ToList();
        var names = kept.Select(item => item.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        for (var index = kept.Count; kept.Count < days; index++)
        {
            var name = CustomName(index);
            if (names.Add(name))
            {
                kept.Add(new PlanWorkout(newId(), name, 0, []));
            }
        }

        return kept;
    }

    /// <summary>A workout's estimate: the warm-up and each exercise's time, to the nearest 5 minutes.</summary>
    public static int Minutes(IEnumerable<PlanExercise> exercises, int planMinutes) =>
        RoundMinutes(WarmUpFor(planMinutes) + exercises.Sum(Duration));

    /// <summary>To the nearest 5 minutes, as "~55 min" shows it.</summary>
    private static int RoundMinutes(int seconds) => Math.Max(5, (int)Math.Round(seconds / 300.0) * 5);
}

/// <summary>A plan's workouts as stored in its JSON column.</summary>
public static class PlanWorkouts
{
    private static readonly System.Text.Json.JsonSerializerOptions Options = new(System.Text.Json.JsonSerializerDefaults.Web);

    public static string Serialize(IReadOnlyList<PlanWorkout> workouts) => System.Text.Json.JsonSerializer.Serialize(workouts, Options);

    public static IReadOnlyList<PlanWorkout> Parse(string? json) =>
        string.IsNullOrWhiteSpace(json) ? [] : System.Text.Json.JsonSerializer.Deserialize<List<PlanWorkout>>(json, Options) ?? [];
}
