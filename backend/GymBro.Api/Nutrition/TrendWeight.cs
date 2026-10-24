namespace GymBro.Api.Nutrition;

/// <summary>
/// Exponentially weighted trend. The first weigh-in is the starting value.
/// Each later weigh-in moves the trend by <see cref="SmoothingShare"/> of the
/// gap (exactly 10 percent per weigh-in, not once per calendar day). A day
/// with no weigh-in adds no step. The value is withheld until there are at
/// least <see cref="MinimumWeighIns"/> weigh-ins in the last
/// <see cref="WindowDays"/> days, inclusive of the as-of date.
/// The published figure is rounded to two decimal places, half away from zero.
/// </summary>
public static class TrendWeight
{
    public const decimal SmoothingShare = 0.10m;

    public const int MinimumWeighIns = 3;

    public const int WindowDays = 7;

    public static decimal? Compute(IReadOnlyList<(DateOnly Date, decimal Kg)> weighIns, DateOnly asOf)
    {
        if (CountInWindow(weighIns, asOf) < MinimumWeighIns)
        {
            return null;
        }

        var series = weighIns.Where(row => row.Date <= asOf).OrderBy(row => row.Date).ToList();
        if (series.Count == 0)
        {
            return null;
        }

        var trend = series[0].Kg;
        for (var i = 1; i < series.Count; i++)
        {
            trend += SmoothingShare * (series[i].Kg - trend);
        }

        return decimal.Round(trend, 2, MidpointRounding.AwayFromZero);
    }

    public static int CountInWindow(IReadOnlyList<(DateOnly Date, decimal Kg)> weighIns, DateOnly asOf)
    {
        var start = asOf.AddDays(-(WindowDays - 1));
        return weighIns.Count(row => row.Date >= start && row.Date <= asOf);
    }
}
