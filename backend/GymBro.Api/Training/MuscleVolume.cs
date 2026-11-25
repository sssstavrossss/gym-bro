namespace GymBro.Api.Training;

/// <summary>Working sets per muscle a week to aim for (docs/training.md → Rules → Volume).</summary>
public sealed record VolumeTarget(int Low, int High);

/// <summary>
/// One muscle's sets this week: <paramref name="Sets"/> counts a set in full where the muscle is a main one and as
/// half where it helps. <paramref name="Days"/> is how many days it was worked as a main muscle.
/// </summary>
public sealed record MuscleSets(string Muscle, decimal Sets, int Direct, int Helping, int Days);

/// <summary>Sets per muscle for Progress → Strength's This week (docs/training.md, phase 4).</summary>
public static class MuscleVolume
{
    /// <summary>About 8–10 for new, 10–14 for some experience (also with no plan), 14–18 for experienced.</summary>
    public static VolumeTarget TargetFor(string? experience) => experience switch
    {
        Experience.New => new VolumeTarget(8, 10),
        Experience.Experienced => new VolumeTarget(14, 18),
        _ => new VolumeTarget(10, 14),
    };

    /// <summary>
    /// Counts each set (warm-ups already left out) against its exercise's main and helping muscles. Cardio and
    /// stretches don't build a muscle's volume, so they don't count, nor does an exercise the library doesn't know.
    /// Most sets first, then by muscle.
    /// </summary>
    public static IReadOnlyList<MuscleSets> Count(IEnumerable<(DateOnly Date, string ExerciseId)> sets, ExerciseLibrary library)
    {
        var direct = new Dictionary<string, int>(StringComparer.Ordinal);
        var helping = new Dictionary<string, int>(StringComparer.Ordinal);
        var days = new Dictionary<string, HashSet<DateOnly>>(StringComparer.Ordinal);
        foreach (var (date, exerciseId) in sets)
        {
            var exercise = library.Find(exerciseId);
            if (exercise is null || exercise.Category is "cardio" or "stretching")
            {
                continue;
            }

            var main = exercise.PrimaryMuscles.Distinct(StringComparer.Ordinal).ToList();
            foreach (var muscle in main)
            {
                direct[muscle] = direct.GetValueOrDefault(muscle) + 1;
                if (!days.TryGetValue(muscle, out var on))
                {
                    days[muscle] = on = [];
                }

                on.Add(date);
            }

            foreach (var muscle in exercise.SecondaryMuscles.Distinct(StringComparer.Ordinal).Except(main, StringComparer.Ordinal))
            {
                helping[muscle] = helping.GetValueOrDefault(muscle) + 1;
            }
        }

        return direct.Keys.Union(helping.Keys, StringComparer.Ordinal)
            .Select(muscle =>
            {
                var d = direct.GetValueOrDefault(muscle);
                var h = helping.GetValueOrDefault(muscle);
                return new MuscleSets(muscle, d + h / 2m, d, h, days.TryGetValue(muscle, out var on) ? on.Count : 0);
            })
            .OrderByDescending(item => item.Sets)
            .ThenBy(item => item.Muscle, StringComparer.Ordinal)
            .ToList();
    }
}
