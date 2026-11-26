namespace GymBro.Api.Nutrition;

/// <summary>One day of food for the burn: what was logged, or null when it isn't known (no log, or left out).</summary>
public sealed record IntakeDay(DateOnly Date, decimal? Kcal, int? TargetKcal);

/// <summary>
/// What one weigh-in says, compared with the one before it: the weight the food in between
/// predicts with the current burn, the burn the change actually implies, and how sure it is.
/// </summary>
public sealed record BurnReading(
    DateOnly From,
    DateOnly To,
    int Days,
    decimal StartKg,
    decimal EndKg,
    decimal ExpectedKg,
    decimal AteKcal,
    decimal Burn,
    decimal LoggedShare,
    bool BigDayBefore,
    bool Sure);

/// <summary>How often someone weighs in decides how far back the burn looks and how far it may move.</summary>
public enum BurnTier
{
    /// <summary>4 or more weigh-ins in the last 28 days.</summary>
    Regular,

    /// <summary>Fewer than that, but 2 or more in the last 56 days.</summary>
    Sparse,

    /// <summary>Fewer than 2 weigh-ins in 56 days: the burn isn't measured.</summary>
    Rare,
}

/// <summary>
/// The burn the weigh-ins and food of a window point to. <see cref="Burn"/> is null when it
/// can't be measured, and <see cref="Blocked"/> says why.
/// </summary>
public sealed record BurnWindow(
    DateOnly From,
    DateOnly To,
    BurnTier Tier,
    int WeighIns,
    IReadOnlyList<BurnReading> Readings,
    decimal? Burn,
    decimal? Sd,
    string? Blocked);

/// <summary>One move of the burn toward what the readings point to, at most <see cref="Cap"/> either way.</summary>
public sealed record CappedStep(decimal Prior, decimal Target, decimal TargetSd, decimal Gain, decimal Cap, decimal Burn, decimal BurnSd, bool Capped);

/// <summary>
/// Measures the burn from every weigh-in in a rolling window, not only the days since the last
/// recalculation. Each weigh-in is compared with the food logged before it: the weight minus the
/// food eaten so far (in kg) falls along a line whose slope is the burn. Recent weigh-ins count
/// more, and a weigh-in after a big day or after days with no log counts less. The burn then moves
/// toward the result by how sure both are, never more than a few percent at a time; the next recalculation reads most of the same days again, so what a capped step left over
/// is still there to catch up on.
/// </summary>
public static class BurnReadings
{
    public const int WindowDays = 28;

    public const int SparseWindowDays = 56;

    public const int RegularWeighIns = 4;

    public const int MinimumWeighIns = 2;

    /// <summary>First to last weigh-in used must be at least this many days apart.</summary>
    public const int MinimumSpanDays = 7;

    /// <summary>A weigh-in this many days old counts half as much as today's.</summary>
    public const double HalfLifeDays = 14;

    /// <summary>A day this far over its target leaves water and food on the scale the next morning.</summary>
    public const decimal BigDayRatio = 1.3m;

    /// <summary>A reading with fewer of its days logged than this is less sure.</summary>
    public const decimal SureLoggedShare = 0.7m;

    /// <summary>With fewer of the window's days logged than this, the burn isn't measured.</summary>
    public const decimal MinimumLoggedShare = 0.5m;

    /// <summary>How far a weigh-in may sit from the body's real weight: water, salt, the scale.</summary>
    public const double ScaleSdKg = 0.5;

    /// <summary>Extra spread for a weigh-in the morning after a big day.</summary>
    public const double BigDaySdKg = 0.8;

    /// <summary>How far an unlogged day may be from the average logged one.</summary>
    public const double UnloggedDaySdKcal = 600;

    public const decimal RegularCap = 0.05m;

    public const decimal SparseCap = 0.03m;

    public const string NeedWeighIns = "Weigh in at least once a week so your burn can be measured.";

    public const string NeedSpread = "Your weigh-ins need to be at least a week apart, first to last, to measure your burn.";

    public const string NeedLogs = "Too few days are logged to measure your burn.";

    /// <summary>
    /// The burn the window ending today points to. <paramref name="earliest"/> is the first day a
    /// weigh-in may count (after the settling week, never before a fresh start).
    /// <paramref name="currentBurn"/> only sets each reading's expected weight.
    /// </summary>
    public static BurnWindow Measure(
        DateOnly today,
        DateOnly earliest,
        IReadOnlyList<(DateOnly Date, decimal Kg)> weighIns,
        IReadOnlyList<IntakeDay> days,
        decimal currentBurn)
    {
        var all = weighIns
            .Where(row => row.Date >= earliest && row.Date <= today)
            .GroupBy(row => row.Date)
            .Select(group => (Date: group.Key, Kg: group.Last().Kg))
            .OrderBy(row => row.Date)
            .ToList();
        var regularFrom = Max(today.AddDays(-WindowDays), earliest);
        var recent = all.Where(row => row.Date >= regularFrom).ToList();
        var tier = BurnTier.Regular;
        var from = regularFrom;
        var points = recent;
        if (recent.Count < RegularWeighIns)
        {
            from = Max(today.AddDays(-SparseWindowDays), earliest);
            points = all.Where(row => row.Date >= from).ToList();
            tier = points.Count >= MinimumWeighIns ? BurnTier.Sparse : BurnTier.Rare;
        }

        if (tier == BurnTier.Rare)
        {
            return new BurnWindow(from, today, tier, points.Count, [], null, null, NeedWeighIns);
        }

        var first = points[0].Date;
        var last = points[^1].Date;
        var byDate = days.Where(day => day.Date >= first.AddDays(-1) && day.Date < last).ToDictionary(day => day.Date);
        var known = byDate.Values.Where(day => day.Date >= first && day.Kcal is not null).Select(day => (double)day.Kcal!.Value).ToList();
        // A big day before most weigh-ins is a habit (a weekly feast, then the weekly weigh-in): the
        // bloat is about the same each time and cancels out, so only an odd one counts for less.
        var habit = points.Count(point => BigDayBefore(point.Date, byDate)) * 2 > points.Count;
        var span = last.DayNumber - first.DayNumber;
        var loggedShare = span == 0 ? 0 : (double)known.Count / span;
        var fill = known.Count == 0 ? 0 : known.Average();
        var readings = Readings(points, byDate, fill, currentBurn, habit);
        if (span < MinimumSpanDays)
        {
            return new BurnWindow(from, today, tier, points.Count, readings, null, null, NeedSpread);
        }

        if (loggedShare < (double)MinimumLoggedShare)
        {
            return new BurnWindow(from, today, tier, points.Count, readings, null, null, NeedLogs);
        }

        var (burn, sd) = Fit(today, points, byDate, fill, habit);
        return new BurnWindow(from, today, tier, points.Count, readings, (decimal)burn, (decimal)sd, null);
    }

    /// <summary>
    /// Moves the burn toward the window's result by how sure each is (a Kalman step), and never
    /// past the tier's cap. The current burn grows less sure each week it goes unmeasured. The
    /// window overlaps the last one, so its spread is widened by how few of its days are new:
    /// re-reading the same weeks must not make the burn surer each time. A capped step stays
    /// unsure by at least half of what it left over, so the next one is free to keep going.
    /// </summary>
    public static CappedStep Step(decimal prior, decimal priorSd, int daysSinceLast, BurnWindow window)
    {
        if (window.Burn is not decimal target || window.Sd is not decimal sd)
        {
            throw new ArgumentException("The window has no burn.", nameof(window));
        }

        var windowDays = window.To.DayNumber - window.From.DayNumber;
        var fresh = Math.Clamp(daysSinceLast, 1, Math.Max(1, windowDays));
        var priorVar = (double)Math.Pow((double)BurnEstimate.SpreadAfter(priorSd, daysSinceLast / 7m), 2);
        var measuredVar = (double)(sd * sd) * Math.Max(1, (double)windowDays / fresh);
        var gain = priorVar + measuredVar <= 0 ? 0 : priorVar / (priorVar + measuredVar);
        var cap = prior * (window.Tier == BurnTier.Regular ? RegularCap : SparseCap);
        var move = (decimal)gain * (target - prior);
        var capped = Math.Abs(move) > cap;
        var burn = prior + Math.Clamp(move, -cap, cap);
        var burnSd = (decimal)Math.Sqrt((1 - gain) * priorVar);
        if (capped)
        {
            burnSd = Math.Max(burnSd, Math.Abs(target - burn) / 2);
        }

        return new CappedStep(prior, target, sd, (decimal)gain, cap, burn, burnSd, capped);
    }

    /// <summary>
    /// Weighted least squares through (day, weight − food eaten so far / 7700): the slope is
    /// minus the burn in kg a day. The spread comes from each weigh-in's own spread, widened when
    /// the weigh-ins scatter more than that.
    /// </summary>
    private static (double Burn, double Sd) Fit(
        DateOnly today,
        List<(DateOnly Date, decimal Kg)> points,
        Dictionary<DateOnly, IntakeDay> byDate,
        double fill,
        bool habit)
    {
        var start = points[0].Date;
        var n = points.Count;
        var t = new double[n];
        var z = new double[n];
        var variance = new double[n];
        var weight = new double[n];
        var eaten = 0.0;
        var day = start;
        for (var i = 0; i < n; i++)
        {
            var unknown = 0;
            for (; day < points[i].Date; day = day.AddDays(1))
            {
                var kcal = byDate.TryGetValue(day, out var row) ? row.Kcal : null;
                eaten += kcal is decimal value ? (double)value : fill;
                if (kcal is null)
                {
                    unknown++;
                }
            }

            t[i] = points[i].Date.DayNumber - start.DayNumber;
            z[i] = (double)points[i].Kg - eaten / (double)NutritionMath.KcalPerKg;
            var big = !habit && BigDayBefore(points[i].Date, byDate);
            var missing = unknown * UnloggedDaySdKcal / (double)NutritionMath.KcalPerKg;
            variance[i] = ScaleSdKg * ScaleSdKg + (big ? BigDaySdKg * BigDaySdKg : 0) + missing * missing;
            var age = today.DayNumber - points[i].Date.DayNumber;
            weight[i] = Math.Pow(0.5, age / HalfLifeDays) / variance[i];
        }

        var sw = weight.Sum();
        var meanT = weight.Select((w, i) => w * t[i]).Sum() / sw;
        var meanZ = weight.Select((w, i) => w * z[i]).Sum() / sw;
        var sxx = weight.Select((w, i) => w * (t[i] - meanT) * (t[i] - meanT)).Sum();
        var sxz = weight.Select((w, i) => w * (t[i] - meanT) * (z[i] - meanZ)).Sum();
        var slope = sxz / sxx;

        // The slope's spread from each weigh-in's own spread (the weights aren't purely inverse-variance).
        var slopeVar = weight.Select((w, i) => w * w * variance[i] * (t[i] - meanT) * (t[i] - meanT)).Sum() / (sxx * sxx);
        if (n > 2)
        {
            // Weigh-ins that scatter more than assumed widen it.
            var chi = weight.Select((w, i) =>
            {
                var r = z[i] - (meanZ + slope * (t[i] - meanT));
                return r * r / variance[i];
            }).Sum() / (n - 2);
            slopeVar *= Math.Max(1, chi);
        }

        var kcalPerKg = (double)NutritionMath.KcalPerKg;
        return (-slope * kcalPerKg, Math.Sqrt(slopeVar) * kcalPerKg);
    }

    private static List<BurnReading> Readings(
        List<(DateOnly Date, decimal Kg)> points,
        Dictionary<DateOnly, IntakeDay> byDate,
        double fill,
        decimal currentBurn,
        bool habit)
    {
        var readings = new List<BurnReading>();
        for (var i = 1; i < points.Count; i++)
        {
            var (from, startKg) = points[i - 1];
            var (to, endKg) = points[i];
            var days = to.DayNumber - from.DayNumber;
            var ate = 0m;
            var logged = 0;
            for (var day = from; day < to; day = day.AddDays(1))
            {
                if (byDate.TryGetValue(day, out var row) && row.Kcal is decimal kcal)
                {
                    ate += kcal;
                    logged++;
                }
                else
                {
                    ate += (decimal)fill;
                }
            }

            var share = (decimal)logged / days;
            var big = BigDayBefore(to, byDate);
            var expected = startKg + (ate - currentBurn * days) / NutritionMath.KcalPerKg;
            var burn = (ate - (endKg - startKg) * NutritionMath.KcalPerKg) / days;
            readings.Add(new BurnReading(from, to, days, startKg, endKg, expected, ate, burn, share, big, !(big && !habit) && share >= SureLoggedShare));
        }

        return readings;
    }

    private static bool BigDayBefore(DateOnly weighIn, Dictionary<DateOnly, IntakeDay> byDate) =>
        byDate.TryGetValue(weighIn.AddDays(-1), out var day)
        && day.Kcal is decimal kcal
        && day.TargetKcal is int target
        && target > 0
        && kcal > BigDayRatio * target;

    private static DateOnly Max(DateOnly a, DateOnly b) => a > b ? a : b;
}
