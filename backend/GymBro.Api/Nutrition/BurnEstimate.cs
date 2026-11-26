namespace GymBro.Api.Nutrition;

/// <summary>A straight line through real weigh-ins: how fast weight moved, and how sure that is.</summary>
public sealed record WeightFit(
    int WeighIns,
    DateOnly First,
    DateOnly Last,
    decimal SlopeKgPerDay,
    decimal SlopeSeKgPerDay)
{
    public int SpanDays => Last.DayNumber - First.DayNumber;

    public decimal RateKgPerWeek => SlopeKgPerDay * 7m;
}

/// <summary>
/// Shared burn rules: how unsure the formula is, how fast an unmeasured burn grows less sure,
/// the weight line Recalculate shows, and how a measured burn is carried through profile edits.
/// The measurement itself is <see cref="BurnReadings"/>.
/// </summary>
public static class BurnEstimate
{
    /// <summary>How unsure the Mifflin-St Jeor burn is for one person, in kcal a day.</summary>
    public const decimal FormulaSdKcal = 350m;

    /// <summary>How much a real burn can drift in a week without being measured.</summary>
    public const decimal WeeklyDriftKcal = 60m;

    public const int MinimumWeighIns = 3;

    /// <summary>First to last weigh-in used must be at least this many days apart.</summary>
    public const int MinimumSpanDays = 6;

    /// <summary>Weigh-ins this many days after setup or a fresh start are mostly water, so the slope skips them.</summary>
    public const int SettlingDays = 7;

    /// <summary>The period never reaches further back than this.</summary>
    public const int MaxPeriodDays = 56;

    /// <summary>The slope also uses weigh-ins this many days before the period starts.</summary>
    public const int LookbackDays = 3;

    /// <summary>Day-to-day scale noise is never assumed smaller than this.</summary>
    public const decimal ResidualFloorKg = 0.3m;

    /// <summary>With only three weigh-ins the noise estimate itself is shaky, so assume more.</summary>
    public const decimal ResidualFloorFewKg = 0.5m;

    /// <summary>
    /// Least-squares line through the weigh-ins (one per date). Null when there
    /// are fewer than <see cref="MinimumWeighIns"/> or they span fewer than
    /// <see cref="MinimumSpanDays"/> days.
    /// </summary>
    public static WeightFit? Fit(IReadOnlyList<(DateOnly Date, decimal Kg)> weighIns)
    {
        var points = weighIns
            .GroupBy(row => row.Date)
            .Select(group => (Date: group.Key, Kg: group.Last().Kg))
            .OrderBy(row => row.Date)
            .ToList();
        if (points.Count < MinimumWeighIns)
        {
            return null;
        }

        var first = points[0].Date;
        var last = points[^1].Date;
        if (last.DayNumber - first.DayNumber < MinimumSpanDays)
        {
            return null;
        }

        var n = points.Count;
        var xs = points.Select(row => (double)(row.Date.DayNumber - first.DayNumber)).ToArray();
        var ys = points.Select(row => (double)row.Kg).ToArray();
        var meanX = xs.Average();
        var meanY = ys.Average();
        var sxx = xs.Sum(x => (x - meanX) * (x - meanX));
        var sxy = xs.Select((x, i) => (x - meanX) * (ys[i] - meanY)).Sum();
        var slope = sxy / sxx;
        var ssr = xs.Select((x, i) => ys[i] - (meanY + slope * (x - meanX))).Sum(r => r * r);
        var floor = (double)(n == MinimumWeighIns ? ResidualFloorFewKg : ResidualFloorKg);
        var residual = Math.Max(floor, Math.Sqrt(ssr / (n - 2)));
        var se = residual / Math.Sqrt(sxx);
        return new WeightFit(n, first, last, (decimal)slope, (decimal)se);
    }

    /// <summary>
    /// How unsure a burn is after <paramref name="weeks"/> unmeasured: it drifts by
    /// <see cref="WeeklyDriftKcal"/> a week, never past the formula's spread.
    /// </summary>
    public static decimal SpreadAfter(decimal sd, decimal weeks) =>
        (decimal)Math.Sqrt((double)DriftedVariance(sd, weeks));

    private static decimal DriftedVariance(decimal sd, decimal weeks) =>
        Math.Min(sd * sd + WeeklyDriftKcal * WeeklyDriftKcal * Math.Max(0m, weeks), FormulaSdKcal * FormulaSdKcal);

    /// <summary>
    /// The burn a target carries forward. A measured burn keeps its distance from
    /// the formula, so a later weight, age, or activity change still moves it.
    /// </summary>
    public static int Carry(int formulaTdeeNow, int rowTdee, int rowFormulaTdee) =>
        formulaTdeeNow + (rowTdee - rowFormulaTdee);
}
