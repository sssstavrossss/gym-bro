using GymBro.Api.Data;
using GymBro.Api.Nutrition;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Profiles;

public sealed record WeightSnapshot(
    decimal? TrendKg,
    bool TrendVisible,
    decimal? LatestKg,
    DateOnly? LatestDate,
    int WeighInsInWindow,
    decimal? UsedKg,
    string Source);

public static class WeightReader
{
    public const string Trend = "trend";
    public const string WeighIn = "weigh_in";
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
        return Choose(series, asOf, setupKg: null);
    }

    /// <summary>
    /// Two or more weigh-ins use the smoothed trend for targets even when it
    /// is hidden. Exactly one weigh-in uses that raw weight. None uses
    /// <paramref name="setupKg"/> when the caller has one; this app does not
    /// store a setup weight apart from the first weigh-in, so that is null.
    /// </summary>
    public static WeightSnapshot Choose(
        IReadOnlyList<(DateOnly Date, decimal Kg)> weighIns,
        DateOnly asOf,
        decimal? setupKg)
    {
        var series = weighIns.Where(row => row.Date <= asOf).OrderBy(row => row.Date).ToList();
        var smoothed = TrendWeight.Compute(series, asOf);
        var inWindow = TrendWeight.CountInWindow(series, asOf);
        var visible = series.Count >= 2 && TrendWeight.IsShown(inWindow);
        var latest = series.Count == 0 ? ((DateOnly Date, decimal Kg)?)null : series[^1];

        decimal? used;
        string source;
        if (series.Count == 0)
        {
            used = setupKg;
            source = setupKg is null ? None : Setup;
        }
        else if (series.Count == 1)
        {
            used = series[0].Kg;
            source = WeighIn;
        }
        else
        {
            used = smoothed;
            source = Trend;
        }

        return new WeightSnapshot(
            visible ? smoothed : null,
            visible,
            latest?.Kg,
            latest?.Date,
            inWindow,
            used,
            source);
    }
}
