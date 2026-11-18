using System.Globalization;

namespace GymBro.Api.Nutrition;

/// <summary>
/// One daily trend series, from the first real weigh-in through today, from
/// <see cref="TrendFilter"/> (a damped Kalman filter, smoothed backwards for past days).
/// Each day has a trend and a band (one standard deviation, kg). The last day's trend
/// is the forward filter alone, so today's number never uses hindsight it could not have.
/// A gap over <see cref="FreshStartGapDays"/> days is a fresh start: the filter restarts at
/// the new weigh-in. The same series is what profile, targets, BMR, recalculate, and the
/// API publish (two decimal places, half away from zero).
/// </summary>
public static class TrendWeight
{
    public const int WindowDays = 7;

    /// <summary>Fewer real weigh-ins than this in the last <see cref="WindowDays"/> days is low accuracy.</summary>
    public const int LowAccuracyBelow = 2;

    public const int FreshStartGapDays = 28;

    /// <summary>A day is measured when real weigh-ins at most this many days apart sit on both sides of it.</summary>
    public const int MeasuredGapDays = 7;

    /// <summary>The rate needs this many weigh-ins since the last fresh start...</summary>
    public const int RateMinWeighIns = 4;

    /// <summary>
    /// ...spread over at least this many days. The rate is how far the trend moved over
    /// the last this-many days up to the latest weigh-in, per week.
    /// </summary>
    public const int RateMinSpanDays = 14;

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

        // A fresh start splits the weigh-ins into runs; each run gets its own filter.
        var runs = new List<List<(DateOnly Date, decimal Kg)>> { new() { real[0] } };
        for (var i = 1; i < real.Count; i++)
        {
            if (real[i].Date.DayNumber - real[i - 1].Date.DayNumber > FreshStartGapDays)
            {
                runs.Add([]);
            }

            runs[^1].Add(real[i]);
        }

        var days = new List<TrendDay>(asOf.DayNumber - real[0].Date.DayNumber + 1);
        for (var r = 0; r < runs.Count; r++)
        {
            var run = runs[r];
            var first = run[0].Date;
            var last = run[^1].Date;
            var through = r == runs.Count - 1 ? asOf : runs[r + 1][0].Date.AddDays(-1);
            var path = TrendFilter.Run(
                run.Select(row => (row.Date.DayNumber - first.DayNumber, (double)row.Kg)).ToList(),
                through.DayNumber - first.DayNumber + 1);
            var kg = run.ToDictionary(row => row.Date, row => row.Kg);
            var measured = Measured(run);
            for (var date = first; date <= through; date = date.AddDays(1))
            {
                var index = date.DayNumber - first.DayNumber;
                decimal? weighIn = kg.TryGetValue(date, out var value) ? value : null;
                days.Add(new TrendDay(
                    date,
                    Publish((decimal)path.Levels[index]),
                    Publish((decimal)path.Bands[index]),
                    weighIn,
                    weighIn is not null,
                    weighIn is null,
                    Gap: r < runs.Count - 1 && date > last,
                    measured.Contains(date)));
            }
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
            if (gap > FreshStartGapDays)
            {
                freshStart = new FreshStartFacts(latest.Date, previous.Date, gap, gap / 7);
            }
        }

        var state = freshStart is not null
            ? FreshStartState
            : reasons.Count > 0 ? LowAccuracy : Normal;
        return new TrendSeries(asOf, days, days[^1].TrendKg, state, reasons, inWindow, freshStart, days[^1].BandKg, Rate(runs[^1], days));
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

    /// <summary>One decimal, half away from zero. The weigh-in confirm sentence and the app use this.</summary>
    public static string FormatOneDecimal(decimal value) =>
        decimal.Round(value, 1, MidpointRounding.AwayFromZero).ToString("0.0", CultureInfo.InvariantCulture);

    /// <summary>Trend change over the last <see cref="RateMinSpanDays"/> days up to the latest weigh-in, per week.</summary>
    private static decimal? Rate(IReadOnlyList<(DateOnly Date, decimal Kg)> run, IReadOnlyList<TrendDay> days)
    {
        var last = run[^1].Date;
        var from = last.AddDays(-RateMinSpanDays);
        if (run.Count < RateMinWeighIns || from < run[0].Date)
        {
            return null;
        }

        var end = days.First(day => day.Date == last).TrendKg;
        var start = days.First(day => day.Date == from).TrendKg;
        return Publish((end - start) * 7 / RateMinSpanDays);
    }

    /// <summary>Days covered by weigh-ins at most <see cref="MeasuredGapDays"/> apart, the weigh-in days included.</summary>
    private static HashSet<DateOnly> Measured(IReadOnlyList<(DateOnly Date, decimal Kg)> run)
    {
        var days = new HashSet<DateOnly> { run[0].Date };
        for (var i = 1; i < run.Count; i++)
        {
            days.Add(run[i].Date);
            if (run[i].Date.DayNumber - run[i - 1].Date.DayNumber > MeasuredGapDays)
            {
                continue;
            }

            for (var date = run[i - 1].Date; date < run[i].Date; date = date.AddDays(1))
            {
                days.Add(date);
            }
        }

        return days;
    }
}

/// <summary>
/// One day of the trend. <see cref="BandKg"/> is one standard deviation around it.
/// <see cref="Gap"/> is a day inside a fresh-start gap (the chart breaks the line).
/// <see cref="Measured"/> is a day between weigh-ins at most a week apart (drawn solid).
/// </summary>
public sealed record TrendDay(
    DateOnly Date,
    decimal TrendKg,
    decimal BandKg,
    decimal? WeighInKg,
    bool Real,
    bool Estimated,
    bool Gap,
    bool Measured);

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
    FreshStartFacts? FreshStart,
    decimal? BandKg,
    decimal? RateKgPerWeek)
{
    public static TrendSeries Empty(DateOnly asOf) =>
        new(asOf, [], null, null, [], 0, null, null, null);

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
