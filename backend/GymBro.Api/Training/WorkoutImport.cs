using System.Security.Cryptography;
using System.Text;

namespace GymBro.Api.Training;

/// <summary>Workouts read from another app's export, a batch at a time.</summary>
public sealed class WorkoutImportRequest
{
    /// <summary><c>strong</c> or <c>hevy</c>.</summary>
    public string? Source { get; set; }

    /// <summary>The person's time zone, so "not in the future" means their today.</summary>
    public string? TimeZone { get; set; }

    public List<ImportedWorkoutRequest?>? Workouts { get; set; }
}

public sealed class ImportedWorkoutRequest
{
    /// <summary>What marks the workout in the export (its start and name), so importing the file again skips it.</summary>
    public string? Key { get; set; }

    public WorkoutRequest? Workout { get; set; }
}

/// <summary>
/// Importing history from Strong or Hevy. The phone reads the file and matches the exercises; the server checks each
/// workout as it checks one logged here, and keeps it done. Each gets an id made from the account, the app and the
/// workout's key, so importing the same file twice skips the workouts already there instead of adding copies.
/// </summary>
public static class WorkoutImport
{
    public const string Strong = "strong";

    public const string Hevy = "hevy";

    public static readonly IReadOnlySet<string> Sources = new HashSet<string>(StringComparer.Ordinal) { Strong, Hevy };

    public const int MaxWorkouts = 100;

    public const int MaxKeyLength = 200;

    public const string UnknownSource = "Import from Strong or Hevy.";

    public const string NoWorkouts = "Send at least one workout.";

    public const string TooMany = "Send up to 100 workouts at a time.";

    public const string NeedsKey = "Each workout needs the key that marks it in the export.";

    /// <summary>The same account, app and key always make the same id.</summary>
    public static Guid IdFor(string userId, string source, string key)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"gym-bro-import\n{userId}\n{source}\n{key}"));
        var bytes = hash[..16];
        // A name-based UUID (version 5 layout, RFC 4122 variant).
        bytes[6] = (byte)((bytes[6] & 0x0F) | 0x50);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        return new Guid(bytes, bigEndian: true);
    }

    /// <summary>The batch as a whole: the app, and how many.</summary>
    public static string? CheckBatch(WorkoutImportRequest request)
    {
        if (request.Source is not { } source || !Sources.Contains(source))
        {
            return UnknownSource;
        }

        var count = request.Workouts?.Count ?? 0;
        if (count == 0)
        {
            return NoWorkouts;
        }

        return count > MaxWorkouts ? TooMany : null;
    }

    /// <summary>One workout: its key, then the usual rules. Imported workouts are done and not tied to a plan.</summary>
    public static (WorkoutDraft? Draft, string? Key, string? Error) Check(ImportedWorkoutRequest? item, DateOnly clientToday, DateOnly serverToday)
    {
        var key = item?.Key?.Trim();
        if (string.IsNullOrEmpty(key) || key.Length > MaxKeyLength || item!.Workout is null)
        {
            return (null, null, NeedsKey);
        }

        var workout = item.Workout;
        workout.Status = WorkoutStatuses.Done;
        workout.PlanWorkoutId = null;
        workout.SequencePosition = null;
        var (draft, error) = WorkoutRules.Check(workout, ExerciseCatalog.Current, clientToday, serverToday);
        if (draft is null)
        {
            var day = workout.Date is { } date ? date.ToString("yyyy-MM-dd") : "with no date";
            return (null, key, $"The workout {day}: {error}");
        }

        return (draft, key, null);
    }
}
