namespace GymBro.Api.Nutrition;

/// <summary>
/// Which days a recalculation reads. Intake runs from the last period start (a
/// measured or formula recalculation, or an accepted fresh start) through
/// yesterday. The start day itself counts: the recalculation before it read
/// only up to the day before, so a Monday-to-Monday week is seven days, never before the latest fresh start and never more
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
        var from = lastStart ?? origin;
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

        var settled = Settled(setup, freshStart);
        var lookback = from.AddDays(-BurnEstimate.LookbackDays);
        var skips = settled > lookback;
        return new RecalculatePeriod(from, to, skips ? settled : lookback, capped, lastStart, skips ? settled : null);
    }

    /// <summary>The first day a weigh-in counts toward the burn: a week after setup or the latest fresh start.</summary>
    public static DateOnly Settled(DateOnly setup, DateOnly? freshStart)
    {
        var restart = freshStart is DateOnly restarted && restarted > setup ? restarted : setup;
        return restart.AddDays(BurnEstimate.SettlingDays);
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
