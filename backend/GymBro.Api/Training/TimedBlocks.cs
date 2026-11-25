using System.Text.Json;

namespace GymBro.Api.Training;

/// <summary>The formats a block of a workout can be done in on the clock (docs/training.md, phase 6).</summary>
public static class BlockFormats
{
    /// <summary>Every minute on the minute (or every few minutes): a round starts each time.</summary>
    public const string Emom = "emom";

    /// <summary>As many rounds as possible before the time is up. The score is rounds plus extra reps.</summary>
    public const string Amrap = "amrap";

    /// <summary>The rounds as fast as possible. The score is the time.</summary>
    public const string ForTime = "for_time";

    public static readonly IReadOnlySet<string> All = new HashSet<string>([Emom, Amrap, ForTime]);
}

/// <summary>
/// A block done on the clock, with its score. Straight sets and plain supersets have none. Stored on the session
/// as JSON, keyed by the sets' <c>block</c>.
/// </summary>
public sealed record TimedBlock(int Block, string Format, int? Minutes, int? Every, int? Rounds, int? Reps, int? Seconds);

public sealed class TimedBlockRequest
{
    public int Block { get; set; }

    public string? Format { get; set; }

    /// <summary>EMOM and AMRAP: how long, in minutes.</summary>
    public int? Minutes { get; set; }

    /// <summary>EMOM: a round every this many minutes (1 when left out).</summary>
    public int? Every { get; set; }

    /// <summary>AMRAP: whole rounds done.</summary>
    public int? Rounds { get; set; }

    /// <summary>AMRAP: reps done into the round after the last whole one.</summary>
    public int? Reps { get; set; }

    /// <summary>For time: how long the rounds took. Null when the clock wasn't used.</summary>
    public int? Seconds { get; set; }
}

public static class TimedBlocks
{
    public const int MaxMinutes = 120;
    public const int MaxEvery = 10;
    public const int MaxRounds = 1000;

    public const string UnknownFormat = "A timed block is an EMOM, an AMRAP or for time.";
    public const string BadMinutes = "A timed block runs for 1 to 120 minutes, a round every 1 to 10.";
    public const string BadScore = "A timed block's score is outside what the app accepts.";
    public const string NoSets = "A timed block needs its sets, each block once.";

    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Checks the timed blocks against the workout's sets: each names a block the sets use, once, with only the fields
    /// its format has.
    /// </summary>
    public static (IReadOnlyList<TimedBlock>? Blocks, string? Error) Check(IReadOnlyList<TimedBlockRequest?>? requested, IReadOnlyCollection<int> setBlocks)
    {
        var blocks = new List<TimedBlock>();
        var seen = new HashSet<int>();
        foreach (var block in requested ?? [])
        {
            if (block is null || !setBlocks.Contains(block.Block) || !seen.Add(block.Block))
            {
                return (null, NoSets);
            }

            var format = block.Format?.Trim() ?? "";
            if (!BlockFormats.All.Contains(format))
            {
                return (null, UnknownFormat);
            }

            var timed = format != BlockFormats.ForTime;
            if (timed ? block.Minutes is not (>= 1 and <= MaxMinutes) : block.Minutes is not null)
            {
                return (null, BadMinutes);
            }

            if (format == BlockFormats.Emom ? block.Every is not (null or (>= 1 and <= MaxEvery)) : block.Every is not null)
            {
                return (null, BadMinutes);
            }

            var amrap = format == BlockFormats.Amrap;
            if (!WorkoutRules.Within(block.Rounds, MaxRounds) || !WorkoutRules.Within(block.Reps, WorkoutRules.MaxReps)
                || !WorkoutRules.Within(block.Seconds, WorkoutRules.MaxSeconds)
                || (!amrap && (block.Rounds is not null || block.Reps is not null))
                || (format != BlockFormats.ForTime && block.Seconds is not null))
            {
                return (null, BadScore);
            }

            blocks.Add(new TimedBlock(
                block.Block, format, block.Minutes, format == BlockFormats.Emom ? block.Every ?? 1 : null, block.Rounds, block.Reps, block.Seconds));
        }

        return (blocks, null);
    }

    public static string Serialize(IReadOnlyList<TimedBlock> blocks) => JsonSerializer.Serialize(blocks, Options);

    public static IReadOnlyList<TimedBlock> Deserialize(string? json) =>
        string.IsNullOrWhiteSpace(json) ? [] : JsonSerializer.Deserialize<List<TimedBlock>>(json, Options) ?? [];
}
