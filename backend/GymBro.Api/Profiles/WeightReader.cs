using GymBro.Api.Data;
using GymBro.Api.Nutrition;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Profiles;

public sealed record WeightSnapshot(
    DateOnly AsOf,
    decimal? TrendKg,
    string? TrendState,
    IReadOnlyList<string> Reasons,
    decimal? LatestKg,
    DateOnly? LatestDate,
    int WeighInsInWindow,
    decimal? UsedKg,
    string Source,
    bool GoalReached,
    bool RecalculatePending,
    FreshStartFacts? FreshStart,
    TrendSeries Series);

public static class WeightReader
{
    public const string Trend = "trend";

    public const string Setup = "setup";

    public const string None = "none";

    public static async Task<WeightSnapshot> ReadAsync(
        AppDbContext db,
        string userId,
        DateOnly asOf,
        CancellationToken cancellationToken)
    {
        var rows = await db.WeighIns.AsNoTracking()
            .Where(row => row.UserId == userId && row.LocalDate <= asOf)
            .OrderBy(row => row.LocalDate)
            .Select(row => new { row.LocalDate, row.Kg })
            .ToListAsync(cancellationToken);
        var series = rows.Select(row => (row.LocalDate, row.Kg)).ToList();
        var profile = await db.Profiles.AsNoTracking()
            .Where(row => row.UserId == userId)
            .Select(row => new { row.Goal, row.GoalWeightKg, row.FreshStartDeclinedOn, row.GoalKeptOn, row.GoalKeptKg })
            .FirstOrDefaultAsync(cancellationToken);
        var computed = TrendWeight.Compute(series, asOf);
        var promptSettled = false;
        if (computed.FreshStart is not null)
        {
            var freshDate = computed.FreshStart.Date;
            promptSettled = profile?.FreshStartDeclinedOn == freshDate;
            if (!promptSettled)
            {
                // Accepting the prompt, or any recalculation since that day, answers it.
                var since = await db.TargetHistories.AsNoTracking()
                    .Where(row => row.UserId == userId && row.EffectiveDate >= freshDate && row.EffectiveDate <= asOf)
                    .Select(row => row.Reasons)
                    .ToListAsync(cancellationToken);
                promptSettled = since.Any(reasons => reasons.Any(reason =>
                    reason == TargetReasons.FreshStart || RecalculationReasons.IsRecalculation(reason)));
            }
        }

        var snapshot = FromSeries(
            computed,
            setupKg: null,
            profile?.Goal,
            profile?.GoalWeightKg ?? 0,
            freshStartAccepted: promptSettled);

        // "Keep my goal" on that weigh-in day, for that goal, answers the card on every device.
        var kept = snapshot.GoalReached
            && profile?.GoalKeptOn is { } keptOn && keptOn == snapshot.LatestDate
            && profile.GoalKeptKg == profile.GoalWeightKg;
        return kept ? snapshot with { GoalReached = false } : snapshot;
    }

    /// <summary>
    /// The number targets use is the published trend, including the first
    /// weigh-in (that day's trend is the weigh-in itself). A setup weight is
    /// only a stand-in when the caller still has one and no weigh-in exists.
    /// This app saves setup weight as the first weigh-in, so that stand-in is unused.
    /// </summary>
    public static WeightSnapshot FromSeries(
        TrendSeries series,
        decimal? setupKg,
        string? goal,
        decimal goalWeightKg,
        bool freshStartAccepted)
    {
        decimal? latestKg = null;
        DateOnly? latestDate = null;
        for (var i = series.Days.Count - 1; i >= 0; i--)
        {
            if (!series.Days[i].Real)
            {
                continue;
            }

            latestKg = series.Days[i].WeighInKg;
            latestDate = series.Days[i].Date;
            break;
        }

        if (series.TrendKg is not decimal trend)
        {
            return new WeightSnapshot(
                series.AsOf,
                null,
                null,
                [],
                null,
                null,
                0,
                setupKg,
                setupKg is null ? None : Setup,
                false,
                false,
                null,
                series);
        }

        return new WeightSnapshot(
            series.AsOf,
            trend,
            series.TrendState,
            series.Reasons,
            latestKg,
            latestDate,
            series.WeighInsInWindow,
            trend,
            Trend,
            TrendWeight.GoalReached(goal, goalWeightKg, series),
            series.FreshStart is not null && !freshStartAccepted,
            series.FreshStart,
            series);
    }
}
