namespace GymBro.Api.Training;

/// <summary>An exercise to swap to, and why it's offered: the same movement, or the same main muscle.</summary>
public sealed record SwapOption(string Id, string Why);

/// <summary>
/// What an exercise can be swapped for in a workout (docs/training.md, phase 5). First the core exercises for the
/// same movement (a squat for a squat), then others for the same main muscle, closest first. With a plan, only
/// what its equipment allows and nothing that loads a go-easy area.
/// </summary>
public static class Swaps
{
    public const string SameMovement = "movement";

    public const string SameMuscle = "muscle";

    /// <summary>How many same-muscle options to offer after the same-movement ones.</summary>
    public const int MuscleOptions = 10;

    private static readonly HashSet<string> NotLifting = new(StringComparer.Ordinal) { "cardio", "stretching" };

    /// <summary>The library's equipment as the generator's kit, or null for kit the plan setup doesn't ask about.</summary>
    public static string? KitOf(string equipment) => equipment switch
    {
        "barbell" or "ez-bar" => Kit.Barbell,
        "dumbbell" => Kit.Dumbbell,
        "kettlebell" => Kit.Kettlebell,
        "cable" => Kit.Cable,
        "machine" => Kit.Machine,
        "bodyweight" or "none" => Kit.Bodyweight,
        _ => null,
    };

    /// <param name="kit">The plan's kit, or null with no plan (anything goes).</param>
    /// <param name="goEasy">The plan's go-easy areas.</param>
    public static IReadOnlyList<SwapOption> For(Exercise exercise, ExerciseLibrary library, IReadOnlySet<string>? kit, IReadOnlyCollection<string> goEasy)
    {
        var options = new List<SwapOption>();
        var taken = new HashSet<string>(StringComparer.Ordinal) { exercise.Id };

        // A core exercise can fill more than one movement (a glute bridge is a hinge and a glute move).
        var slots = CoreExercises.All.Where(item => item.Id == exercise.Id).Select(item => item.Slot).ToHashSet();
        foreach (var item in CoreExercises.All.Where(item => slots.Contains(item.Slot)
                     && (kit is null || item.Kit.Any(kit.Contains))
                     && !item.Loads.Any(goEasy.Contains)))
        {
            if (library.Find(item.Id) is not null && taken.Add(item.Id))
            {
                options.Add(new SwapOption(item.Id, SameMovement));
            }
        }

        var main = exercise.PrimaryMuscles.FirstOrDefault();
        if (main is null)
        {
            return options;
        }

        var lifting = !NotLifting.Contains(exercise.Category);
        var loads = CoreExercises.All.GroupBy(item => item.Id, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.SelectMany(item => item.Loads).ToArray(), StringComparer.Ordinal);
        var similar = library.All
            .Where(item => !taken.Contains(item.Id)
                && item.PrimaryMuscles.Contains(main)
                && NotLifting.Contains(item.Category) != lifting
                && (kit is null || KitOf(item.Equipment) is { } need && kit.Contains(need))
                && !(loads.TryGetValue(item.Id, out var hard) && hard.Any(goEasy.Contains)))
            .Select(item => (item, score: Score(exercise, item)))
            .OrderByDescending(pair => pair.score)
            .ThenBy(pair => pair.item.Name, StringComparer.OrdinalIgnoreCase)
            .Take(MuscleOptions)
            .Select(pair => new SwapOption(pair.item.Id, SameMuscle));
        options.AddRange(similar);
        return options;
    }

    /// <summary>Closer is higher: the same main muscles, compound or isolation, push or pull, and what it records.</summary>
    private static int Score(Exercise from, Exercise to)
    {
        var score = 0;
        if (from.PrimaryMuscles.Count == to.PrimaryMuscles.Count && from.PrimaryMuscles.All(to.PrimaryMuscles.Contains))
        {
            score += 2;
        }

        if (from.Mechanic is not null && from.Mechanic == to.Mechanic)
        {
            score += 2;
        }

        if (from.Force is not null && from.Force == to.Force)
        {
            score += 1;
        }

        if (from.Measure == to.Measure)
        {
            score += 1;
        }

        if (CoreExercises.All.Any(item => item.Id == to.Id))
        {
            score += 1;
        }

        if (to.Level == "expert")
        {
            score -= 2;
        }

        return score;
    }
}
