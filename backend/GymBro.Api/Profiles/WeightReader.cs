using GymBro.Api.Data;
using GymBro.Api.Nutrition;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Profiles;

public sealed record WeightSnapshot(
    decimal? TrendKg,
    decimal? LatestKg,
    DateOnly? LatestDate,
    int WeighInsInWindow,
    decimal? UsedKg,
    string Source);

public static class WeightReader
{
    public const string Trend = "trend";
    public const string WeighIn = "weigh_in";
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
        var trend = TrendWeight.Compute(series, asOf);
        var latest = rows.Count == 0 ? null : rows[^1];
        var used = trend ?? latest?.Kg;
        var source = trend is not null ? Trend : latest is not null ? WeighIn : None;
        return new WeightSnapshot(
            trend,
            latest?.Kg,
            latest?.LocalDate,
            TrendWeight.CountInWindow(series, asOf),
            used,
            source);
    }
}
