namespace GymBro.Api.Nutrition;

/// <summary>
/// One daily trend series, from the first real weigh-in through today.
/// Alpha is <see cref="SmoothingShare"/> (0.10) once per reading. Part A has
/// no intake step, so a day with no reading keeps the previous trend.
/// A gap of 2 to <see cref="MaxInterpolatedGapDays"/> days is filled with
/// straight-line readings. A longer gap is a fresh start: that day's trend
/// equals the new weigh-in. The same series is what profile, targets, BMR,
/// the weekly job, and the API publish (two decimal places, half away from zero).
/// </summary>
public static class TrendWeight
{
    public const decimal SmoothingShare = 0.10m;

    public const int WindowDays = 7;

    /// <summary>Fewer real weigh-ins than this in the last <see cref="WindowDays"/> days is low accuracy.</summary>
    public const int LowAccuracyBelow = 2;

    public const int MaxInterpolatedGapDays = 28;

    /// <summary>No-gap typo guard. A gap adds <see cref="TypoKgPerFullWeek"/> per full week, capped at <see cref="TypoCapKg"/>.</summary>
    public const decimal TypoLimitKg = 3.0m;

    public const decimal TypoKgPerFullWeek = 1.0m;

    public const decimal TypoCapKg = 10.0m;

    /// <summary>New weigh-ins and date moves: today inclusive, back this many days.</summary>
    public const int WeighInWindowDays = 7;

    public const string Normal = "normal";

    public const string LowAccuracy = "low_accuracy";

    public const string FreshStartState = "fresh_start";

    public const string FewerThanTwoWeighInsInSevenDays = "fewer_than_2_weighins_7d";

    public static TrendSeries Compute(IReadOnlyList<(DateOnly Date, decimal Kg)> weighIns, DateOnly asOf)
    {
        var real = weighIns
            .Where(row => row.Date <= asOf)
            .OrderBy(row => row.Date)
            .GroupBy(row => row.Date)
            .Select(group => (Date: group.Key, Kg: group.Last().Kg))
            .ToList();
        if (real.Count == 0)
        {
            return TrendSeries.Empty(asOf);
        }

        var gapReadings = new Dictionary<DateOnly, decimal>();
        var freshStartDates = new HashSet<DateOnly>();
        var freshGaps = new HashSet<DateOnly>();
        for (var i = 1; i < real.Count; i++)
        {
            var previous = real[i - 1];
            var current = real[i];
            var gap = current.Date.DayNumber - previous.Date.DayNumber;
            if (gap > MaxInterpolatedGapDays)
            {
                freshStartDates.Add(current.Date);
                for (var dayNumber = previous.Date.DayNumber + 1; dayNumber < current.Date.DayNumber; dayNumber++)
                {
                    freshGaps.Add(DateOnly.FromDayNumber(dayNumber));
                }

                continue;
            }

            if (gap <= 1)
            {
                continue;
            }

            for (var dayNumber = previous.Date.DayNumber + 1; dayNumber <= current.Date.DayNumber; dayNumber++)
            {
                var offset = dayNumber - previous.Date.DayNumber;
                gapReadings[DateOnly.FromDayNumber(dayNumber)] =
                    previous.Kg + (current.Kg - previous.Kg) * offset / gap;
            }
        }

        var realKg = real.ToDictionary(row => row.Date, row => row.Kg);
        var days = new List<TrendDay>(asOf.DayNumber - real[0].Date.DayNumber + 1);
        var trend = real[0].Kg;
        days.Add(Day(real[0].Date, trend, realKg, gapReadings, freshGaps));

        for (var date = real[0].Date.AddDays(1); date <= asOf; date = date.AddDays(1))
        {
            if (freshStartDates.Contains(date))
            {
                trend = realKg[date];
            }
            else if (Reading(date, realKg, gapReadings) is decimal reading)
            {
                trend += SmoothingShare * (reading - trend);
            }

            days.Add(Day(date, trend, realKg, gapReadings, freshGaps));
        }

        var windowStart = asOf.AddDays(-(WindowDays - 1));
        var inWindow = real.Count(row => row.Date >= windowStart && row.Date <= asOf);
        var reasons = new List<string>();
        if (inWindow < LowAccuracyBelow)
        {
            reasons.Add(FewerThanTwoWeighInsInSevenDays);
        }

        FreshStartFacts? freshStart = null;
        if (real.Count >= 2)
        {
            var latest = real[^1];
            var previous = real[^2];
            var gap = latest.Date.DayNumber - previous.Date.DayNumber;
            if (gap > MaxInterpolatedGapDays)
            {
                freshStart = new FreshStartFacts(latest.Date, previous.Date, gap, gap / 7);
            }
        }

        var state = freshStart is not null
            ? FreshStartState
            : reasons.Count > 0 ? LowAccuracy : Normal;
        var published = days[^1].TrendKg;
        return new TrendSeries(asOf, days, published, state, reasons, inWindow, freshStart);
    }

    /// <summary>
    /// 3 kg, plus 1 kg for each full week since the previous real weigh-in, never above 10 kg.
    /// A same-week gap stays at 3 kg. 15 days is 2 full weeks (5 kg). 70 days is capped at 10 kg.
    /// </summary>
    public static decimal TypoThresholdKg(int daysSincePreviousRealWeighIn)
    {
        var days = Math.Max(0, daysSincePreviousRealWeighIn);
        var threshold = TypoLimitKg + TypoKgPerFullWeek * (days / 7);
        return threshold > TypoCapKg ? TypoCapKg : threshold;
    }

    /// <summary>
    /// Only the latest real weigh-in can reach the goal, and only on that weigh-in's own day.
    /// A later day that merely carries the trend does not ask, and neither does an earlier
    /// weigh-in once a newer one exists. Lose means that day's trend is at or under the goal;
    /// gain means at or over. Maintain does not ask. Nothing is stored.
    /// </summary>
    public static bool GoalReached(string? direction, decimal goalWeightKg, TrendSeries series)
    {
        TrendDay? judged = null;
        foreach (var day in series.Days)
        {
            if (day.Real)
            {
                judged = day;
            }
        }

        if (judged is null || judged.Date != series.AsOf)
        {
            return false;
        }

        return direction switch
        {
            Goals.Lose => judged.TrendKg <= goalWeightKg,
            Goals.Gain => judged.TrendKg >= goalWeightKg,
            _ => false,
        };
    }

    public static decimal Publish(decimal trend) =>
        decimal.Round(trend, 2, MidpointRounding.AwayFromZero);

    private static decimal? Reading(
        DateOnly date,
        Dictionary<DateOnly, decimal> realKg,
        Dictionary<DateOnly, decimal> gapReadings)
    {
        if (realKg.TryGetValue(date, out var real))
        {
            return real;
        }

        if (gapReadings.TryGetValue(date, out var gap))
        {
            return gap;
        }

        return null;
    }

    private static TrendDay Day(
        DateOnly date,
        decimal trend,
        Dictionary<DateOnly, decimal> realKg,
        Dictionary<DateOnly, decimal> gapReadings,
        HashSet<DateOnly> freshGaps)
    {
        decimal? weighIn = realKg.TryGetValue(date, out var kg) ? kg : null;
        decimal? reading = weighIn ?? (gapReadings.TryGetValue(date, out var gap) ? gap : null);
        var real = weighIn is not null;
        return new TrendDay(date, Publish(trend), weighIn, reading, real, !real, freshGaps.Contains(date));
    }
}

public sealed record TrendDay(
    DateOnly Date,
    decimal TrendKg,
    decimal? WeighInKg,
    decimal? ReadingKg,
    bool Real,
    bool Estimated,
    bool Gap);

public sealed record FreshStartFacts(
    DateOnly Date,
    DateOnly PreviousDate,
    int DaysSincePrevious,
    int WeeksSincePrevious);

public sealed record TrendSeries(
    DateOnly AsOf,
    IReadOnlyList<TrendDay> Days,
    decimal? TrendKg,
    string? TrendState,
    IReadOnlyList<string> Reasons,
    int WeighInsInWindow,
    FreshStartFacts? FreshStart)
{
    public static TrendSeries Empty(DateOnly asOf) =>
        new(asOf, [], null, null, [], 0, null);

    public TrendDay? On(DateOnly date)
    {
        foreach (var day in Days)
        {
            if (day.Date == date)
            {
                return day;
            }
        }

        return null;
    }
}
