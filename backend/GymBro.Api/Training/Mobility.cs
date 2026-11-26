namespace GymBro.Api.Training;

/// <summary>
/// A plan workout's mobility warm-up and cool-down (docs/training.md, Mobility), each a setting of the plan.
/// The warm-up is a few dynamic moves for the parts the workout trains, in place of the plain warm-up's time.
/// The cool-down is a few held stretches for the muscles it trained most, and takes its own minutes.
/// Both are picked from short, hand-made lists of the library's stretches, with no equipment, passing over
/// anything that loads a go-easy area.
/// </summary>
public static class Mobility
{
    /// <summary>One move or stretch: the exercise, the muscles it's for, and the areas it loads.</summary>
    private sealed record Move(string Id, string[] Muscles, string[] Loads);

    private static readonly string[] Upper = ["chest", "shoulders", "lats", "middle-back", "traps", "biceps", "triceps", "forearms", "neck"];

    /// <summary>Dynamic moves, in order of preference. Upper-body moves first, then lower-body and whole-body ones.</summary>
    private static readonly Move[] WarmUpMoves =
    [
        new("arm-circles", ["shoulders", "chest"], [Joints.Shoulders]),
        new("dynamic-chest-stretch", ["chest", "shoulders"], [Joints.Shoulders]),
        new("dynamic-back-stretch", ["lats", "middle-back", "shoulders"], [Joints.Shoulders]),
        new("shoulder-circles", ["shoulders", "traps"], []),
        new("wrist-circles", ["forearms", "biceps", "triceps"], [Joints.Wrists]),
        new("standing-hip-circles", ["glutes", "abductors", "adductors"], [Joints.Hips]),
        new("front-leg-raises", ["hamstrings", "glutes", "quadriceps"], [Joints.Hips]),
        new("side-leg-raises", ["adductors", "abductors", "glutes"], [Joints.Hips]),
        new("worlds-greatest-stretch", ["quadriceps", "hamstrings", "glutes", "lower-back"], [Joints.Knees, Joints.Hips]),
        new("inchworm", ["hamstrings", "lower-back", "abdominals", "shoulders"], [Joints.Wrists, Joints.LowerBack]),
        new("ankle-circles", ["calves"], [Joints.Ankles]),
    ];

    /// <summary>Held stretches by muscle, the gentlest first.</summary>
    private static readonly Move[] Stretches =
    [
        new("standing-hip-flexors", ["quadriceps"], [Joints.Hips]),
        new("on-your-side-quad-stretch", ["quadriceps"], [Joints.Knees]),
        new("hamstring-stretch", ["hamstrings"], []),
        new("seated-floor-hamstring-stretch", ["hamstrings", "calves"], [Joints.LowerBack]),
        new("knee-across-the-body", ["glutes", "lower-back"], [Joints.Hips]),
        new("one-knee-to-chest", ["glutes", "lower-back"], []),
        new("standing-gastrocnemius-calf-stretch", ["calves"], [Joints.Ankles]),
        new("calf-stretch-hands-against-wall", ["calves"], []),
        new("elbows-back", ["chest", "shoulders"], [Joints.Shoulders]),
        new("chest-and-front-of-shoulder-stretch", ["chest", "shoulders"], [Joints.Shoulders]),
        new("one-arm-against-wall", ["lats"], [Joints.Shoulders]),
        new("side-lying-floor-stretch", ["lats", "abdominals"], []),
        new("upper-back-stretch", ["middle-back", "traps"], []),
        new("shoulder-stretch", ["shoulders", "middle-back"], [Joints.Shoulders]),
        new("triceps-stretch", ["triceps", "lats"], [Joints.Shoulders]),
        new("standing-biceps-stretch", ["biceps", "chest"], [Joints.Shoulders]),
        new("kneeling-forearm-stretch", ["forearms"], [Joints.Wrists]),
        new("childs-pose", ["lower-back", "lats"], [Joints.Knees]),
        new("hug-knees-to-chest", ["lower-back", "glutes"], []),
        new("side-lying-groin-stretch", ["adductors"], [Joints.Hips]),
        new("standing-lateral-stretch", ["abdominals", "lats"], []),
    ];

    /// <summary>Each warm-up move, in seconds: about 10 slow swings or circles a side.</summary>
    public const int MoveSeconds = 30;

    /// <summary>Getting from one move or stretch to the next.</summary>
    public const int Transition = 15;

    /// <summary>A held stretch: 30 s when new to training, else 45 s.</summary>
    public static int HoldSeconds(string experience) => experience == Experience.New ? 30 : 45;

    /// <summary>Warm-up moves: 2 in a short workout's 2 minutes, else 5 in the usual 5.</summary>
    public static int WarmUpCount(int planMinutes) => planMinutes <= 20 ? 2 : 5;

    /// <summary>Cool-down stretches: 2 in a short workout, 4 from an hour up, else 3.</summary>
    public static int CoolDownCount(int planMinutes) => planMinutes <= 20 ? 2 : planMinutes >= 60 ? 4 : 3;

    /// <summary>The time a cool-down takes from the workout, which the generator keeps free for it.</summary>
    public static int CoolDownSeconds(PlanAnswers answers) =>
        answers.CoolDown ? CoolDownCount(answers.Minutes) * (HoldSeconds(answers.Experience) + Transition) : 0;

    /// <summary>A list's time: each move's or stretch's seconds and the step to the next.</summary>
    public static int Seconds(IReadOnlyList<PlanExercise>? moves) => moves?.Sum(item => item.Sets * (item.Seconds ?? 0) + Transition) ?? 0;

    /// <summary>
    /// The workout with its warm-up and cool-down as the answers ask, made again from its exercises (after an edit,
    /// say), and its minutes worked out again. An empty workout gets neither.
    /// </summary>
    public static PlanWorkout Attach(PlanWorkout workout, PlanAnswers answers, ExerciseLibrary library)
    {
        var warmUp = answers.WarmUp ? WarmUp(workout.Exercises, answers, library) : null;
        var coolDown = answers.CoolDown ? CoolDown(workout.Exercises, answers, library) : null;
        var attached = workout with { WarmUp = warmUp is { Count: > 0 } ? warmUp : null, CoolDown = coolDown is { Count: > 0 } ? coolDown : null };
        return workout.Exercises.Count == 0 ? attached : attached with { Minutes = PlanGenerator.Minutes(attached, answers.Minutes) };
    }

    /// <summary>
    /// The warm-up: moves for the parts the workout trains. Mostly upper body takes the upper-body moves, mostly lower
    /// body the lower-body ones, and a mix takes some of each, the moves for its busiest muscles first.
    /// </summary>
    public static IReadOnlyList<PlanExercise> WarmUp(IReadOnlyList<PlanExercise> exercises, PlanAnswers answers, ExerciseLibrary library)
    {
        var weights = MuscleWeights(exercises, library);
        if (weights.Count == 0)
        {
            return [];
        }

        var fitting = WarmUpMoves.Where(move => Fits(move, answers, library)).ToList();
        var ranked = fitting
            .Select((move, order) => (move, order, score: move.Muscles.Sum(muscle => weights.GetValueOrDefault(muscle))))
            .Where(item => item.score > 0)
            .OrderByDescending(item => item.score)
            .ThenBy(item => item.order)
            .Select(item => item.move)
            .ToList();
        var count = WarmUpCount(answers.Minutes);
        var upperShare = weights.Where(item => Upper.Contains(item.Key)).Sum(item => item.Value) / weights.Values.Sum();
        // A mix of upper and lower body warms both: the best move for each first, then the rest by score.
        var picked = new List<Move>();
        if (upperShare is > 0.25 and < 0.75)
        {
            picked.AddRange(ranked.Where(move => IsUpper(move)).Take(1));
            picked.AddRange(ranked.Where(move => !IsUpper(move)).Take(1));
        }

        picked.AddRange(ranked.Where(move => !picked.Contains(move)));
        return [.. picked.Take(count).Select(move => new PlanExercise(move.Id, 1, null, null, MoveSeconds, 0))];
    }

    /// <summary>The cool-down: a stretch for each of the muscles the workout trained most, busiest first, none twice.</summary>
    public static IReadOnlyList<PlanExercise> CoolDown(IReadOnlyList<PlanExercise> exercises, PlanAnswers answers, ExerciseLibrary library)
    {
        var weights = MuscleWeights(exercises, library);
        var hold = HoldSeconds(answers.Experience);
        var count = CoolDownCount(answers.Minutes);
        var picked = new List<Move>();
        foreach (var muscle in weights.OrderByDescending(item => item.Value).Select(item => item.Key))
        {
            if (picked.Count == count)
            {
                break;
            }

            // A stretch already picked for another muscle covers this one too.
            if (picked.Any(move => move.Muscles[0] == muscle))
            {
                continue;
            }

            var stretch = Stretches.FirstOrDefault(move => move.Muscles[0] == muscle && !picked.Contains(move) && Fits(move, answers, library));
            if (stretch is not null)
            {
                picked.Add(stretch);
            }
        }

        return [.. picked.Select(move => new PlanExercise(move.Id, 1, null, null, hold, 0))];
    }

    /// <summary>
    /// How much the workout works each muscle: a set counts 1 for each main muscle and ½ for each helping one, as
    /// This week counts them. Stretches don't count.
    /// </summary>
    private static Dictionary<string, double> MuscleWeights(IReadOnlyList<PlanExercise> exercises, ExerciseLibrary library)
    {
        var weights = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var item in exercises)
        {
            var exercise = library.Find(item.ExerciseId);
            if (exercise is null || exercise.Category is "stretching")
            {
                continue;
            }

            var sets = Math.Max(1, item.Sets);
            foreach (var muscle in exercise.PrimaryMuscles)
            {
                weights[muscle] = weights.GetValueOrDefault(muscle) + sets;
            }

            foreach (var muscle in exercise.SecondaryMuscles)
            {
                weights[muscle] = weights.GetValueOrDefault(muscle) + sets / 2.0;
            }
        }

        return weights;
    }

    private static bool IsUpper(Move move) => Upper.Contains(move.Muscles[0]);

    private static bool Fits(Move move, PlanAnswers answers, ExerciseLibrary library) =>
        !move.Loads.Any(answers.GoEasy.Contains) && library.Find(move.Id) is not null;
}
