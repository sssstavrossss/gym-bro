using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace GymBro.Api.Training;

/// <summary>What a set of an exercise records. The logging screen shows these fields and no others.</summary>
public static class ExerciseMeasure
{
    /// <summary>Load and reps: most lifts.</summary>
    public const string WeightReps = "weight_reps";

    /// <summary>Reps alone: body-weight moves.</summary>
    public const string Reps = "reps";

    /// <summary>A hold or a stretch, in seconds.</summary>
    public const string Time = "time";

    /// <summary>Distance and time: runs, rows, rides.</summary>
    public const string DistanceTime = "distance_time";

    /// <summary>A load moved over a distance: carries, sleds, walking lunges with a bag.</summary>
    public const string WeightDistance = "weight_distance";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal) { WeightReps, Reps, Time, DistanceTime, WeightDistance };
}

/// <summary>One exercise as the app lists it. Names and muscles stay in English, as the source has them.</summary>
public sealed record Exercise(
    string Id,
    string Name,
    string Category,
    string Equipment,
    string Level,
    string? Mechanic,
    string? Force,
    string Measure,
    IReadOnlyList<string> PrimaryMuscles,
    IReadOnlyList<string> SecondaryMuscles,
    IReadOnlyList<string> Instructions,
    int Images,
    string Source,
    string SourceId);

/// <summary>
/// The exercise library: every exercise from free-exercise-db (public domain, pinned to one commit in
/// <c>free-exercise-db.json</c>) and the ones Gym Bro adds itself (<c>gym-bro-exercises.json</c>: Hyrox stations,
/// the two-hand kettlebell swing). It is reference data that ships with the build, so it lives in memory rather
/// than in the database. Ids are the source's id in lower case with dashes, and never change once shipped.
/// </summary>
public static partial class ExerciseCatalog
{
    public const string FreeExerciseDb = "free-exercise-db";

    public const string GymBro = "gym-bro";

    /// <summary>The free-exercise-db commit the embedded file was taken from. Photos are fetched from the same one.</summary>
    public const string FreeExerciseDbCommit = "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5";

    /// <summary>Where the app serves the photos (static files, made by <c>tools/exercise-photos/build.sh</c>).</summary>
    public const string PhotosPath = "/exercise-photos";

    /// <summary>
    /// The folder of this commit's photos: <c>{PhotoBase}/{id}/{n}.webp</c> for n below <see cref="Exercise.Images"/>.
    /// The commit is in the path, so a photo never changes and can be kept for good.
    /// </summary>
    public static readonly string PhotoBase = $"{PhotosPath}/{FreeExerciseDbCommit[..7]}";

    private static readonly Lazy<ExerciseLibrary> Loaded = new(Load);

    public static ExerciseLibrary Current => Loaded.Value;

    /// <summary>An id from the source's: lower case, words joined by single dashes.</summary>
    public static string IdFrom(string sourceId) => NotWord().Replace(sourceId.ToLowerInvariant(), "-").Trim('-');

    /// <summary>The source's equipment as the app names it. free-exercise-db leaves some exercises without one.</summary>
    public static string Equipment(string? equipment) => equipment switch
    {
        null or "" => "none",
        "body only" => "bodyweight",
        "kettlebells" => "kettlebell",
        "e-z curl bar" => "ez-bar",
        "foam roll" => "foam-roller",
        _ => NotWord().Replace(equipment.ToLowerInvariant(), "-").Trim('-'),
    };

    /// <summary>
    /// What a free-exercise-db exercise records, which the source doesn't say: distance and time for cardio, time
    /// for stretches and holds, load and distance for carries and sleds, reps for body-weight moves, else load and reps.
    /// </summary>
    public static string MeasureOf(string name, string category, string? equipment, string? force)
    {
        if (category == "cardio")
        {
            return ExerciseMeasure.DistanceTime;
        }

        if (category == "stretching" || force == "static")
        {
            return ExerciseMeasure.Time;
        }

        if (category == "strongman" && Moved().IsMatch(name))
        {
            return ExerciseMeasure.WeightDistance;
        }

        return equipment is null or "" or "body only" ? ExerciseMeasure.Reps : ExerciseMeasure.WeightReps;
    }

    private static ExerciseLibrary Load()
    {
        var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var source = Read<List<SourceExercise>>("free-exercise-db.json", options);
        var own = Read<OwnFile>("gym-bro-exercises.json", options);

        var exercises = source
            .Select(item => new Exercise(
                IdFrom(item.Id),
                item.Name,
                item.Category,
                Equipment(item.Equipment),
                item.Level,
                item.Mechanic,
                item.Force,
                MeasureOf(item.Name, item.Category, item.Equipment, item.Force),
                Muscles(item.PrimaryMuscles),
                Muscles(item.SecondaryMuscles),
                item.Instructions ?? [],
                item.Images?.Count ?? 0,
                FreeExerciseDb,
                item.Id))
            .Concat(own.Exercises.Select(item => new Exercise(
                item.Id,
                item.Name,
                item.Category,
                Equipment(item.Equipment),
                item.Level,
                item.Mechanic,
                item.Force,
                item.Measure ?? MeasureOf(item.Name, item.Category, item.Equipment, item.Force),
                Muscles(item.PrimaryMuscles),
                Muscles(item.SecondaryMuscles),
                item.Instructions ?? [],
                0,
                GymBro,
                item.Id)))
            .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        return new ExerciseLibrary(exercises, Version(exercises));
    }

    private static IReadOnlyList<string> Muscles(IReadOnlyList<string>? muscles) =>
        (muscles ?? []).Select(muscle => NotWord().Replace(muscle.ToLowerInvariant(), "-").Trim('-')).ToList();

    /// <summary>A short hash of the whole library, so a client can keep its copy until the library changes.</summary>
    private static string Version(IReadOnlyList<Exercise> exercises)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(exercises)));
        return Convert.ToHexString(bytes, 0, 8).ToLowerInvariant();
    }

    private static T Read<T>(string file, JsonSerializerOptions options)
    {
        var assembly = typeof(ExerciseCatalog).Assembly;
        var name = assembly.GetManifestResourceNames().Single(resource => resource.EndsWith(file, StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(name) ?? throw new InvalidOperationException($"{file} is missing.");
        return JsonSerializer.Deserialize<T>(stream, options) ?? throw new InvalidOperationException($"{file} was empty.");
    }

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NotWord();

    [GeneratedRegex(@"\b(walk|carry|drag|drags|push|crawl)\b", RegexOptions.IgnoreCase)]
    private static partial Regex Moved();

    private sealed record SourceExercise(
        string Id,
        string Name,
        string Category,
        string? Equipment,
        string Level,
        string? Mechanic,
        string? Force,
        IReadOnlyList<string>? PrimaryMuscles,
        IReadOnlyList<string>? SecondaryMuscles,
        IReadOnlyList<string>? Instructions,
        IReadOnlyList<string>? Images);

    private sealed record OwnExercise(
        string Id,
        string Name,
        string Category,
        string? Equipment,
        string Level,
        string? Mechanic,
        string? Force,
        string? Measure,
        IReadOnlyList<string>? PrimaryMuscles,
        IReadOnlyList<string>? SecondaryMuscles,
        IReadOnlyList<string>? Instructions);

    private sealed record OwnFile(int Version, IReadOnlyList<OwnExercise> Exercises);
}

/// <summary>The loaded library, by id.</summary>
public sealed class ExerciseLibrary
{
    private readonly Dictionary<string, Exercise> byId;

    public ExerciseLibrary(IReadOnlyList<Exercise> exercises, string version)
    {
        All = exercises;
        Version = version;
        byId = exercises.ToDictionary(item => item.Id, StringComparer.Ordinal);
    }

    /// <summary>Every exercise, by name.</summary>
    public IReadOnlyList<Exercise> All { get; }

    public string Version { get; }

    public Exercise? Find(string id) => byId.GetValueOrDefault(id);
}
