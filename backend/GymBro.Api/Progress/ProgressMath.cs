namespace GymBro.Api.Progress;

/// <summary>
/// Progress is only what was stored. A day with no food log has no calories.
/// A day with no weigh-in has no weight. Targets apply only from the date they were saved.
/// </summary>
public static class ProgressMath
{
    public const string BadRange = "Use 7d, 30d, 90d, or all.";

    public static bool TryRange(string? range, out string normalized)
    {
        normalized = string.IsNullOrWhiteSpace(range) ? "30d" : range.Trim().ToLowerInvariant();
        return normalized is "7d" or "30d" or "90d" or "all";
    }

    /// <summary>Inclusive start. All begins on the earliest stored weigh-in or log, not before.</summary>
    public static DateOnly WindowStart(DateOnly today, string range, DateOnly? earliest)
    {
        var start = range switch
        {
            "7d" => today.AddDays(-6),
            "30d" => today.AddDays(-29),
            "90d" => today.AddDays(-89),
            _ => earliest is DateOnly first && first < today ? first : today,
        };
        return start > today ? today : start;
    }

    public static decimal? Average(decimal sum, int count, int digits)
    {
        if (count <= 0) return null;
        return decimal.Round(sum / count, digits, MidpointRounding.AwayFromZero);
    }

    /// <summary>Last weigh-in minus the first, in date order. One reading has no change.</summary>
    public static decimal? Change(IReadOnlyList<decimal> orderedKg)
    {
        if (orderedKg.Count < 2) return null;
        return decimal.Round(orderedKg[^1] - orderedKg[0], 2, MidpointRounding.AwayFromZero);
    }

    /// <summary>The target saved on or before <paramref name="day"/>. Rows must be oldest first.</summary>
    public static (int Kcal, int Protein)? TargetAt(IReadOnlyList<(DateOnly Date, int Kcal, int Protein)> rows, DateOnly day)
    {
        (int Kcal, int Protein)? value = null;
        foreach (var row in rows)
        {
            if (row.Date > day) break;
            value = (row.Kcal, row.Protein);
        }
        return value;
    }
}
