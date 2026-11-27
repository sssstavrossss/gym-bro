using System.Text.RegularExpressions;

namespace GymBro.Api.Training;

/// <summary>
/// Finds the library exercise for a name from another app's export (Strong and Hevy both write "Bench Press
/// (Barbell)"). First the names those apps use most, by hand; then the library's own names, as written, with the
/// equipment moved to the front ("Barbell Shrug"), or without it ("Leg Press"). Anything else is left for the person
/// to pick, so a near miss never puts sets on the wrong lift.
/// </summary>
public static partial class ExerciseMatcher
{
    public const int MaxNames = 300;

    public const int MaxNameLength = 120;

    public const string TooManyNames = "Send up to 300 names at a time.";

    /// <summary>Strong and Hevy names, as they write them, to the library's ids.</summary>
    private static readonly (string Name, string Id)[] Known =
    [
        ("Bench Press (Barbell)", "barbell-bench-press-medium-grip"),
        ("Bench Press (Dumbbell)", "dumbbell-bench-press"),
        ("Bench Press (Smith Machine)", "smith-machine-bench-press"),
        ("Bench Press - Close Grip (Barbell)", "close-grip-barbell-bench-press"),
        ("Close Grip Bench Press", "close-grip-barbell-bench-press"),
        ("Incline Bench Press (Barbell)", "barbell-incline-bench-press-medium-grip"),
        ("Incline Bench Press (Dumbbell)", "incline-dumbbell-press"),
        ("Decline Bench Press (Barbell)", "decline-barbell-bench-press"),
        ("Chest Press (Machine)", "leverage-chest-press"),
        ("Chest Fly (Dumbbell)", "dumbbell-flyes"),
        ("Incline Chest Fly (Dumbbell)", "incline-dumbbell-flyes"),
        ("Chest Fly (Machine)", "butterfly"),
        ("Butterfly (Pec Deck)", "butterfly"),
        ("Cable Crossover", "cable-crossover"),
        ("Cable Fly Crossovers", "cable-crossover"),
        ("Chest Dip", "dips-chest-version"),
        ("Push Up", "pushups"),
        ("Squat (Barbell)", "barbell-squat"),
        ("Full Squat", "barbell-full-squat"),
        ("Squat (Smith Machine)", "smith-machine-squat"),
        ("Front Squat (Barbell)", "front-barbell-squat"),
        ("Goblet Squat (Kettlebell)", "goblet-squat"),
        ("Goblet Squat (Dumbbell)", "goblet-squat"),
        ("Goblet Squat", "goblet-squat"),
        ("Squat (Bodyweight)", "bodyweight-squat"),
        ("Air Squat", "bodyweight-squat"),
        ("Hack Squat", "hack-squat"),
        ("Hack Squat (Machine)", "hack-squat"),
        ("Leg Press", "leg-press"),
        ("Leg Press (Machine)", "leg-press"),
        ("Bulgarian Split Squat", "split-squat-with-dumbbells"),
        ("Bulgarian Split Squat (Dumbbell)", "split-squat-with-dumbbells"),
        ("Lunge (Dumbbell)", "dumbbell-lunges"),
        ("Lunge (Barbell)", "barbell-lunge"),
        ("Walking Lunge", "bodyweight-walking-lunge"),
        ("Walking Lunge (Dumbbell)", "dumbbell-lunges"),
        ("Step Up (Dumbbell)", "dumbbell-step-ups"),
        ("Deadlift (Barbell)", "barbell-deadlift"),
        ("Deadlift (Dumbbell)", "stiff-legged-dumbbell-deadlift"),
        ("Romanian Deadlift (Barbell)", "romanian-deadlift"),
        ("Romanian Deadlift (Dumbbell)", "stiff-legged-dumbbell-deadlift"),
        ("Stiff Leg Deadlift (Barbell)", "stiff-legged-barbell-deadlift"),
        ("Sumo Deadlift (Barbell)", "sumo-deadlift"),
        ("Good Morning (Barbell)", "good-morning"),
        ("Hip Thrust (Barbell)", "barbell-hip-thrust"),
        ("Hip Thrust", "barbell-hip-thrust"),
        ("Glute Bridge", "barbell-glute-bridge"),
        ("Leg Extension (Machine)", "leg-extensions"),
        ("Lying Leg Curl (Machine)", "lying-leg-curls"),
        ("Seated Leg Curl (Machine)", "seated-leg-curl"),
        ("Leg Curl (Machine)", "lying-leg-curls"),
        ("Standing Calf Raise (Machine)", "standing-calf-raises"),
        ("Standing Calf Raise", "standing-calf-raises"),
        ("Calf Raise (Standing)", "standing-calf-raises"),
        ("Seated Calf Raise (Machine)", "seated-calf-raise"),
        ("Seated Calf Raise", "seated-calf-raise"),
        ("Hip Adduction (Machine)", "thigh-adductor"),
        ("Hip Abduction (Machine)", "thigh-abductor"),
        ("Back Extension", "hyperextensions-back-extensions"),
        ("Back Extension (Hyperextension)", "hyperextensions-back-extensions"),
        ("Overhead Press (Barbell)", "standing-military-press"),
        ("Strict Military Press (Barbell)", "standing-military-press"),
        ("Seated Overhead Press (Barbell)", "seated-barbell-military-press"),
        ("Overhead Press (Dumbbell)", "dumbbell-shoulder-press"),
        ("Shoulder Press (Dumbbell)", "dumbbell-shoulder-press"),
        ("Seated Overhead Press (Dumbbell)", "seated-dumbbell-press"),
        ("Seated Shoulder Press (Dumbbell)", "seated-dumbbell-press"),
        ("Shoulder Press (Machine)", "machine-shoulder-military-press"),
        ("Overhead Press (Smith Machine)", "smith-machine-overhead-shoulder-press"),
        ("Arnold Press (Dumbbell)", "arnold-dumbbell-press"),
        ("Push Press", "push-press"),
        ("Lateral Raise (Dumbbell)", "side-lateral-raise"),
        ("Lateral Raise (Cable)", "cable-seated-lateral-raise"),
        ("Front Raise (Dumbbell)", "front-dumbbell-raise"),
        ("Reverse Fly (Dumbbell)", "reverse-flyes"),
        ("Rear Delt Reverse Fly (Dumbbell)", "reverse-flyes"),
        ("Reverse Fly (Cable)", "cable-rear-delt-fly"),
        ("Face Pull (Cable)", "face-pull"),
        ("Face Pull", "face-pull"),
        ("Upright Row (Barbell)", "upright-barbell-row"),
        ("Shrug (Barbell)", "barbell-shrug"),
        ("Shrug (Dumbbell)", "dumbbell-shrug"),
        ("Bent Over Row (Barbell)", "bent-over-barbell-row"),
        ("Bent Over Row (Dumbbell)", "bent-over-two-dumbbell-row"),
        ("Dumbbell Row", "one-arm-dumbbell-row"),
        ("Single Arm Dumbbell Row", "one-arm-dumbbell-row"),
        ("Seated Row (Cable)", "seated-cable-rows"),
        ("Seated Cable Row - V Grip (Cable)", "seated-cable-rows"),
        ("Seated Row (Machine)", "seated-cable-rows"),
        ("T Bar Row", "t-bar-row-with-handle"),
        ("Inverted Row", "inverted-row"),
        ("Lat Pulldown (Cable)", "wide-grip-lat-pulldown"),
        ("Lat Pulldown (Machine)", "wide-grip-lat-pulldown"),
        ("Lat Pulldown - Close Grip (Cable)", "close-grip-front-lat-pulldown"),
        ("Pull Up", "pullups"),
        ("Pull Up (Weighted)", "pullups"),
        ("Pull Up (Assisted)", "band-assisted-pull-up"),
        ("Assisted Pull Up", "band-assisted-pull-up"),
        ("Chin Up", "chin-up"),
        ("Chin Up (Weighted)", "chin-up"),
        ("Bicep Curl (Barbell)", "barbell-curl"),
        ("Bicep Curl (Dumbbell)", "dumbbell-bicep-curl"),
        ("Bicep Curl (Cable)", "standing-biceps-cable-curl"),
        ("Bicep Curl (EZ Bar)", "ez-bar-curl"),
        ("EZ Bar Biceps Curl", "ez-bar-curl"),
        ("Hammer Curl (Dumbbell)", "hammer-curls"),
        ("Preacher Curl (Barbell)", "preacher-curl"),
        ("Preacher Curl (EZ Bar)", "preacher-curl"),
        ("Concentration Curl (Dumbbell)", "concentration-curls"),
        ("Triceps Pushdown (Cable - Straight Bar)", "triceps-pushdown"),
        ("Triceps Pushdown", "triceps-pushdown"),
        ("Triceps Rope Pushdown", "triceps-pushdown-rope-attachment"),
        ("Triceps Pushdown (Cable - Rope)", "triceps-pushdown-rope-attachment"),
        ("Triceps Extension (Cable)", "cable-rope-overhead-triceps-extension"),
        ("Overhead Triceps Extension (Cable)", "cable-rope-overhead-triceps-extension"),
        ("Triceps Extension (Dumbbell)", "dumbbell-one-arm-triceps-extension"),
        ("Skullcrusher (Barbell)", "lying-triceps-press"),
        ("Skullcrusher (EZ Bar)", "lying-triceps-press"),
        ("Skullcrusher (Dumbbell)", "lying-dumbbell-tricep-extension"),
        ("Triceps Dip", "dips-triceps-version"),
        ("Bench Dip", "bench-dips"),
        ("Dip", "dips-triceps-version"),
        ("Plank", "plank"),
        ("Crunch", "crunches"),
        ("Crunch (Machine)", "ab-crunch-machine"),
        ("Cable Crunch", "cable-crunch"),
        ("Hanging Leg Raise", "hanging-leg-raise"),
        ("Russian Twist", "russian-twist"),
        ("Ab Wheel", "ab-roller"),
        ("Mountain Climber", "mountain-climbers"),
        ("Burpee", "burpee-broad-jump"),
        ("Box Jump", "box-jump-multiple-response"),
        ("Jump Rope", "rope-jumping"),
        ("Kettlebell Swing", "kettlebell-swing"),
        ("Farmers Walk", "farmers-walk"),
        ("Power Clean", "power-clean"),
        ("Clean and Jerk (Barbell)", "clean-and-jerk"),
        ("Snatch (Barbell)", "snatch"),
        ("Thruster (Kettlebell)", "kettlebell-thruster"),
        ("Running", "run"),
        ("Running (Treadmill)", "running-treadmill"),
        ("Treadmill", "running-treadmill"),
        ("Walking", "walk"),
        ("Rowing (Machine)", "rowing-stationary"),
        ("Cycling", "bicycling-stationary"),
        ("Cycling (Indoor)", "bicycling-stationary"),
        ("Spinning", "bicycling-stationary"),
        ("Swimming", "swim"),
        ("Ski Erg", "skierg"),
        ("SkiErg", "skierg"),
        ("Air Bike", "fan-bike"),
        ("Wall Ball", "wall-ball"),
    ];

    /// <summary>The hand-made names as words, to their ids.</summary>
    public static IReadOnlyDictionary<string, string> Aliases { get; } =
        Known.ToDictionary(item => Words(item.Name), item => item.Id, StringComparer.Ordinal);

    private static readonly Lazy<Dictionary<string, string>> LibraryNames = new(() =>
    {
        var names = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var item in ExerciseCatalog.Current.All)
        {
            names.TryAdd(Words(item.Name), item.Id);
        }

        return names;
    });

    /// <summary>The library exercise a name stands for, or null when it isn't clear.</summary>
    public static string? Match(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        var words = Words(name);
        if (Aliases.TryGetValue(words, out var known))
        {
            return known;
        }

        var library = LibraryNames.Value;
        if (library.TryGetValue(words, out var same))
        {
            return same;
        }

        // "Shrug (Barbell)" is "Barbell Shrug"; "Leg Press (Machine)" is "Leg Press".
        var paren = Parenthesis().Match(name);
        if (paren.Success)
        {
            var bare = Words(name[..paren.Index]);
            var kit = Words(paren.Groups[1].Value);
            if (library.TryGetValue($"{kit} {bare}", out var fronted))
            {
                return fronted;
            }

            if (library.TryGetValue(bare, out var plain) || library.TryGetValue(bare + "s", out plain))
            {
                return plain;
            }
        }

        return library.TryGetValue(words + "s", out var plural) ? plural : null;
    }

    /// <summary>A name as lower-case words, so "Pull-Up" and "pull up" are the same.</summary>
    public static string Words(string name) =>
        string.Join(' ', NotWord().Split(name.ToLowerInvariant().Replace("'", "")).Where(word => word.Length > 0));

    [GeneratedRegex(@"\(([^)]*)\)\s*$")]
    private static partial Regex Parenthesis();

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NotWord();
}
