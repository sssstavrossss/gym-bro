namespace GymBro.Api.Nutrition;

/// <summary>
/// Which days a recalculation reads. Intake runs from the day after the last
/// period start (a measured or formula recalculation, or an accepted fresh
/// start) through yesterday, never before the latest fresh start and never more
/// than <see cref="BurnEstimate.MaxPeriodDays"/> back. The slope also reads a few
/// weigh-ins before the period and today's, but skips the settling week after
/// setup or a fresh start.
/// </summary>
public sealed record RecalculatePeriod(
    DateOnly From,
    DateOnly To,
    DateOnly SlopeFrom,
    bool Capped,
    DateOnly? LastUpdate,
    DateOnly? SettledFrom)
{
    public static RecalculatePeriod For(
        DateOnly today,
        DateOnly setup,
        DateOnly? firstLog,
        DateOnly? lastStart,
        DateOnly? freshStart)
    {
        var origin = firstLog is DateOnly logged && logged < setup ? logged : setup;
        var from = lastStart is DateOnly last ? last.AddDays(1) : origin;
        if (freshStart is DateOnly fresh && fresh > from)
        {
            from = fresh;
        }

        var to = today.AddDays(-1);
        var earliest = to.AddDays(-(BurnEstimate.MaxPeriodDays - 1));
        var capped = from < earliest;
        if (capped)
        {
            from = earliest;
        }

        var restart = freshStart is DateOnly restarted && restarted > setup ? restarted : setup;
        var settled = restart.AddDays(BurnEstimate.SettlingDays);
        var lookback = from.AddDays(-BurnEstimate.LookbackDays);
        var skips = settled > lookback;
        return new RecalculatePeriod(from, to, skips ? settled : lookback, capped, lastStart, skips ? settled : null);
    }

    /// <summary>The latest weigh-in on or before <paramref name="asOf"/> that came after a gap of more than 28 days.</summary>
    public static DateOnly? LatestFreshStart(IReadOnlyList<(DateOnly Date, decimal Kg)> weighIns, DateOnly asOf)
    {
        var dates = weighIns.Select(row => row.Date).Where(date => date <= asOf).Distinct().OrderBy(date => date).ToList();
        for (var i = dates.Count - 1; i >= 1; i--)
        {
            if (dates[i].DayNumber - dates[i - 1].DayNumber > TrendWeight.FreshStartGapDays)
            {
                return dates[i];
            }
        }

        return null;
    }
}
