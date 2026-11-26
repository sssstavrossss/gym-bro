namespace GymBro.Api.Training;

/// <summary>
/// A Hyrox plan's conditioning workouts (docs/training.md, phase 6). The race is 8 × (1 km run + a station):
/// SkiErg, sled push, sled pull, burpee broad jumps, row, farmer's carry, sandbag lunges and wall balls. A plan
/// trains them in two circuits done for time, each round a 1 km run and half the stations at a shorter distance,
/// and in run intervals. Strength days between them come from the usual full-body templates.
/// </summary>
public static class HyroxPlan
{
    public const string StationsA = "stations-a";
    public const string StationsB = "stations-b";
    public const string RunsA = "runs-a";
    public const string RunsB = "runs-b";

    /// <summary>One way to do a station: the exercise, the kit it needs (any one), what it loads, and the work.</summary>
    private sealed record Option(string Id, string[] Kit, string[] Loads, int? Metres = null, int? Reps = null, int? Seconds = null);

    /// <summary>A station's options, the race's own first, then stand-ins for less kit.</summary>
    private static readonly IReadOnlyDictionary<string, Option[]> Stations = new Dictionary<string, Option[]>
    {
        ["run"] =
        [
            new("run", [Training.Kit.Bodyweight], [Joints.Knees, Joints.Ankles], Metres: 1000),
            new("fan-bike", [Training.Kit.Machine], [], Metres: 2000),
        ],
        // Run intervals: the distance per 1 km run (a bike goes twice as far).
        ["intervals"] =
        [
            new("run", [Training.Kit.Bodyweight], [Joints.Knees, Joints.Ankles], Metres: 1000),
            new("rowing-stationary", [Training.Kit.Machine], [Joints.LowerBack], Metres: 1000),
            new("skierg", [Training.Kit.Machine], [Joints.Shoulders], Metres: 1000),
            new("fan-bike", [Training.Kit.Machine], [], Metres: 2000),
        ],
        ["ski"] =
        [
            new("skierg", [Training.Kit.Machine], [Joints.Shoulders], Metres: 500),
            new("mountain-climbers", [Training.Kit.Bodyweight], [Joints.Wrists], Reps: 30),
        ],
        ["sled-push"] =
        [
            new("sled-push", [Training.Kit.Stations], [Joints.Knees], Metres: 25),
            new("goblet-squat", [Training.Kit.Kettlebell, Training.Kit.Dumbbell], [Joints.Knees], Reps: 15),
            new("bodyweight-squat", [Training.Kit.Bodyweight], [Joints.Knees], Reps: 20),
        ],
        ["sled-pull"] =
        [
            new("sled-pull", [Training.Kit.Stations], [Joints.LowerBack], Metres: 25),
            new("one-arm-dumbbell-row", [Training.Kit.Dumbbell], [], Reps: 12),
            new("one-arm-kettlebell-row", [Training.Kit.Kettlebell], [], Reps: 12),
            new("inverted-row", [Training.Kit.Bodyweight], [], Reps: 10),
        ],
        ["burpee-broad-jump"] = [new("burpee-broad-jump", [Training.Kit.Bodyweight], [Joints.Knees, Joints.Wrists], Metres: 20)],
        ["row"] =
        [
            new("rowing-stationary", [Training.Kit.Machine], [Joints.LowerBack], Metres: 500),
            new("mountain-climbers", [Training.Kit.Bodyweight], [Joints.Wrists], Reps: 30),
        ],
        ["carry"] =
        [
            new("farmers-walk", [Training.Kit.Dumbbell, Training.Kit.Kettlebell], [], Metres: 100),
            new("plank", [Training.Kit.Bodyweight], [], Seconds: 45),
        ],
        ["lunge"] =
        [
            new("sandbag-lunge", [Training.Kit.Stations], [Joints.Knees], Metres: 25),
            new("dumbbell-lunges", [Training.Kit.Dumbbell], [Joints.Knees], Reps: 12),
            new("lunge-pass-through", [Training.Kit.Kettlebell], [Joints.Knees], Reps: 12),
            new("bodyweight-walking-lunge", [Training.Kit.Bodyweight], [Joints.Knees], Reps: 16),
        ],
        ["wall-ball"] =
        [
            new("wall-ball", [Training.Kit.Stations], [Joints.Knees, Joints.Shoulders], Reps: 20),
            new("kettlebell-thruster", [Training.Kit.Kettlebell], [Joints.Knees, Joints.Shoulders], Reps: 12),
            new("goblet-squat", [Training.Kit.Dumbbell], [Joints.Knees], Reps: 15),
            new("bodyweight-squat", [Training.Kit.Bodyweight], [Joints.Knees], Reps: 20),
        ],
    };

    private static readonly IReadOnlyDictionary<string, string[]> Circuits = new Dictionary<string, string[]>
    {
        [StationsA] = ["run", "ski", "sled-push", "sled-pull", "burpee-broad-jump"],
        [StationsB] = ["run", "row", "carry", "lunge", "wall-ball"],
    };

    /// <summary>The most rounds of a circuit, and run intervals, for each experience.</summary>
    private static int MaxRounds(string experience) => experience switch
    {
        Experience.New => 2,
        Experience.Experienced => 4,
        _ => 3,
    };

    public static bool IsConditioning(string template) => Circuits.ContainsKey(template) || template is RunsA or RunsB;

    /// <summary>
    /// A conditioning workout: a circuit of stations done for time, or run intervals. Rounds (or intervals) are as
    /// many as fit the time, from 1 (2 intervals) up to the experience's most.
    /// </summary>
    public static (List<PlanExercise> Exercises, int Seconds) Fill(string template, IReadOnlySet<string> kit, PlanAnswers answers, ExerciseLibrary library, int warmUp)
    {
        var budget = answers.Minutes * 60 - warmUp;
        if (template is RunsA or RunsB)
        {
            // 1 km repeats with 90 s between, or twice as many 500 m with a minute; a machine stands in for running
            // when knees or ankles need going easy on.
            var (metres, rest, per) = template == RunsA ? (1000, 90, 1) : (500, 60, 2);
            var option = Stations["intervals"].FirstOrDefault(item => Usable(item, kit, answers, library));
            if (option is null)
            {
                return ([], warmUp);
            }

            var interval = new PlanExercise(option.Id, 1, null, null, null, rest, Metres: metres * (option.Metres ?? 1000) / 1000);
            var count = Math.Clamp((budget - PlanGenerator.Changeover) / (PlanGenerator.Work(interval) + rest), 2, (MaxRounds(answers.Experience) + 1) * per);
            var runs = interval with { Sets = count };
            return ([runs], warmUp + PlanGenerator.Duration(runs));
        }

        var picked = new List<PlanExercise>();
        var stations = Circuits.GetValueOrDefault(template) ?? Circuits[StationsA];
        foreach (var station in stations)
        {
            var option = Stations[station].FirstOrDefault(item => Usable(item, kit, answers, library) && picked.All(done => done.ExerciseId != item.Id));
            if (option is not null)
            {
                picked.Add(new PlanExercise(option.Id, 1, option.Reps, option.Reps, option.Seconds, 0, Metres: option.Metres, Superset: picked.Count > 0));
            }
        }

        if (picked.Count == 0)
        {
            return ([], warmUp);
        }

        // The circuit's first exercise carries the clock: the rounds are done for time.
        picked[0] = picked[0] with { Superset = false, Format = BlockFormats.ForTime };
        var round = picked.Sum(PlanGenerator.Work);
        var rounds = Math.Clamp((budget - picked.Count * PlanGenerator.Changeover) / Math.Max(1, round), 1, MaxRounds(answers.Experience));
        var exercises = picked.Select(item => item with { Sets = rounds }).ToList();
        return (exercises, warmUp + exercises.Sum(PlanGenerator.Duration));
    }

    private static bool Usable(Option option, IReadOnlySet<string> kit, PlanAnswers answers, ExerciseLibrary library) =>
        option.Kit.Any(kit.Contains) && !option.Loads.Any(answers.GoEasy.Contains) && library.Find(option.Id) is not null;
}
