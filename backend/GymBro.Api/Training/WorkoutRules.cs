namespace GymBro.Api.Training;

public static class WorkoutKinds
{
    public const string Strength = "strength";
    public const string Cardio = "cardio";
    public const string Hybrid = "hybrid";
    public const string Mobility = "mobility";
    public const string Sport = "sport";

    public static readonly IReadOnlySet<string> All = new HashSet<string>([Strength, Cardio, Hybrid, Mobility, Sport]);
}

public static class WorkoutStatuses
{
    public const string Done = "done";
    public const string Skipped = "skipped";

    public static readonly IReadOnlySet<string> All = new HashSet<string>([Done, Skipped]);
}

public static class SetTypes
{
    public const string Warmup = "warmup";
    public const string Working = "working";
    public const string Drop = "drop";

    public static readonly IReadOnlySet<string> All = new HashSet<string>([Warmup, Working, Drop]);
}

/// <summary>A workout as the app sends it: the whole session, sets in order.</summary>
public sealed class WorkoutRequest
{
    public string? Kind { get; set; }

    public DateOnly? Date { get; set; }

    /// <summary>The person's time zone, so "not in the future" means their today.</summary>
    public string? TimeZone { get; set; }

    public string? Name { get; set; }

    public string? Status { get; set; }

    public DateTimeOffset? StartedAt { get; set; }

    public DateTimeOffset? EndedAt { get; set; }

    public string? Notes { get; set; }

    public List<WorkoutSetRequest>? Sets { get; set; }
}

public sealed class WorkoutSetRequest
{
    public string? ExerciseId { get; set; }

    public int Block { get; set; }

    public string? Type { get; set; }

    public int? Reps { get; set; }

    public decimal? Kg { get; set; }

    public int? Rir { get; set; }

    public int? Seconds { get; set; }

    public decimal? Metres { get; set; }

    public int? Calories { get; set; }

    public DateTimeOffset? DoneAt { get; set; }
}

/// <summary>A checked workout, ready to store.</summary>
public sealed record WorkoutDraft(
    string Kind,
    DateOnly Date,
    string? Name,
    string Status,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt,
    string? Notes,
    IReadOnlyList<SetDraft> Sets);

public sealed record SetDraft(
    string ExerciseId,
    int Block,
    string Type,
    int? Reps,
    decimal? Kg,
    int? Rir,
    int? Seconds,
    decimal? Metres,
    int? Calories,
    DateTimeOffset? DoneAt);

/// <summary>
/// What a saved workout may hold. The limits are generous: they catch typos and abuse, not hard sessions.
/// Dates follow weigh-ins: not after the person's today. Unlike food, a workout may be from before setup,
/// since training history is not tied to the nutrition target.
/// </summary>
public static class WorkoutRules
{
    public const int MaxSets = 300;
    public const int MaxBlock = 99;
    public const int MaxNameLength = 80;
    public const int MaxNotesLength = 2000;
    public const int MaxReps = 1000;
    public const decimal MaxKg = 1000m;
    public const int MaxRir = 10;
    public const int MaxSeconds = 86_400;
    public const decimal MaxMetres = 1_000_000m;
    public const int MaxCalories = 10_000;
    public static readonly TimeSpan MaxLength = TimeSpan.FromHours(24);
    public static readonly DateOnly Earliest = new(2000, 1, 1);

    public const string NeedsDate = "Say which day the workout was, like 2026-11-25.";
    public const string TooEarly = "That date is too long ago.";
    public const string UnknownKind = "Use a kind of workout the app knows.";
    public const string UnknownStatus = "A workout is done or skipped.";
    public const string NameTooLong = "Keep the name to 80 characters.";
    public const string NotesTooLong = "Keep the notes to 2,000 characters.";
    public const string TooManySets = "A workout can hold up to 300 sets.";
    public const string EndsBeforeStart = "A workout can't end before it starts.";
    public const string TooLong = "A workout can last up to 24 hours.";
    public const string UnknownSetType = "A set is a warm-up, working or drop set.";
    public const string BadBlock = "A set's block is a number from 0 to 99.";
    public const string OutOfRange = "A set has a number outside what the app accepts.";

    public static string UnknownExercise(string? id) => $"\"{id}\" is not an exercise the app knows.";

    /// <summary>Checks a workout and returns it cleaned up, or the first thing wrong with it.</summary>
    public static (WorkoutDraft? Draft, string? Error) Check(WorkoutRequest request, ExerciseLibrary library, DateOnly clientToday, DateOnly serverToday)
    {
        if (request.Date is not { } date)
        {
            return (null, NeedsDate);
        }

        if (date > clientToday || date.DayNumber - serverToday.DayNumber > Logging.LogEntryRules.ZoneToleranceDays)
        {
            return (null, Logging.LogEntryRules.FutureDate);
        }

        if (date < Earliest)
        {
            return (null, TooEarly);
        }

        var kind = string.IsNullOrWhiteSpace(request.Kind) ? WorkoutKinds.Strength : request.Kind.Trim();
        if (!WorkoutKinds.All.Contains(kind))
        {
            return (null, UnknownKind);
        }

        var status = string.IsNullOrWhiteSpace(request.Status) ? WorkoutStatuses.Done : request.Status.Trim();
        if (!WorkoutStatuses.All.Contains(status))
        {
            return (null, UnknownStatus);
        }

        var name = Clean(request.Name);
        if (name?.Length > MaxNameLength)
        {
            return (null, NameTooLong);
        }

        var notes = Clean(request.Notes);
        if (notes?.Length > MaxNotesLength)
        {
            return (null, NotesTooLong);
        }

        if (request.StartedAt is { } started && request.EndedAt is { } ended)
        {
            if (ended < started)
            {
                return (null, EndsBeforeStart);
            }

            if (ended - started > MaxLength)
            {
                return (null, TooLong);
            }
        }

        var requested = request.Sets ?? [];
        if (requested.Count > MaxSets)
        {
            return (null, TooManySets);
        }

        var sets = new List<SetDraft>(requested.Count);
        foreach (var set in requested)
        {
            if (set is null || string.IsNullOrWhiteSpace(set.ExerciseId) || library.Find(set.ExerciseId) is null)
            {
                return (null, UnknownExercise(set?.ExerciseId));
            }

            var type = string.IsNullOrWhiteSpace(set.Type) ? SetTypes.Working : set.Type.Trim();
            if (!SetTypes.All.Contains(type))
            {
                return (null, UnknownSetType);
            }

            if (set.Block is < 0 or > MaxBlock)
            {
                return (null, BadBlock);
            }

            if (!Within(set.Reps, MaxReps) || !Within(set.Kg, MaxKg) || !Within(set.Rir, MaxRir)
                || !Within(set.Seconds, MaxSeconds) || !Within(set.Metres, MaxMetres) || !Within(set.Calories, MaxCalories))
            {
                return (null, OutOfRange);
            }

            sets.Add(new SetDraft(
                set.ExerciseId.Trim(),
                set.Block,
                type,
                set.Reps,
                set.Kg is { } kg ? decimal.Round(kg, 2, MidpointRounding.AwayFromZero) : null,
                set.Rir,
                set.Seconds,
                set.Metres is { } metres ? decimal.Round(metres, 1, MidpointRounding.AwayFromZero) : null,
                set.Calories,
                set.DoneAt));
        }

        return (new WorkoutDraft(kind, date, name, status, request.StartedAt, request.EndedAt, notes, sets), null);
    }

    /// <summary>
    /// Volume in kg: weight × reps over the sets that count (done, not warm-ups). Sets without a weight add
    /// nothing, so a bodyweight workout has no volume.
    /// </summary>
    public static decimal Volume(IEnumerable<Data.WorkoutSet> sets) =>
        sets.Where(Counts).Sum(set => (set.Kg ?? 0) * (set.Reps ?? 0));

    /// <summary>A set that counts toward the workout's totals: ticked off and not a warm-up.</summary>
    public static bool Counts(Data.WorkoutSet set) => set.DoneAt is not null && set.Type != SetTypes.Warmup;

    private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    private static bool Within(int? value, int max) => value is null || (value >= 0 && value <= max);

    private static bool Within(decimal? value, decimal max) => value is null || (value >= 0 && value <= max);
}
