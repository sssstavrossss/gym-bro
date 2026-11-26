namespace GymBro.Api.Nutrition;

public static class RecalculationReasons
{
    /// <summary>The person accepted a burn measured from their own logs and weigh-ins.</summary>
    public const string Adaptive = "recalculation_adaptive";

    /// <summary>The person chose to go back to the Mifflin-St Jeor formula.</summary>
    public const string Formula = "recalculation_formula";

    /// <summary>
    /// The burn could not be measured yet, so it was kept and the target refreshed
    /// for today's weight. The measuring period keeps running.
    /// </summary>
    public const string Kept = "recalculation_kept";

    public static bool IsRecalculation(string reason) =>
        reason is TargetReasons.WeeklyRecalculation or Adaptive or Formula or Kept;

    /// <summary>A row with one of these reasons starts a new measuring period the next day.</summary>
    public static bool StartsPeriod(string reason) =>
        reason is TargetReasons.WeeklyRecalculation or Adaptive or Formula or TargetReasons.FreshStart;
}

/// <summary>
/// In-app reminder for the Monday–Sunday week in the person's time zone.
/// It stays up after Monday until they recalculate or dismiss it. Push is unrelated.
/// </summary>
public static class RecalculateBanner
{
    public const string DismissKind = "recalculate_dismiss";

    public static DateOnly WeekStart(DateOnly today)
    {
        var back = ((int)today.DayOfWeek - (int)DayOfWeek.Monday + 7) % 7;
        return today.AddDays(-back);
    }

    public static bool Visible(bool recalculatedThisWeek, bool dismissedThisWeek) =>
        !recalculatedThisWeek && !dismissedThisWeek;
}

/// <summary>One day inside a recalculation period. Logged kcal is what was stored, never guessed.</summary>
public sealed record DayFact(DateOnly Date, decimal LoggedKcal, bool HasLog, int? TargetKcal);

/// <summary>A low day: logged at or under 80% of that day's target.</summary>
public sealed record ReviewDay(DateOnly Date, int Kcal, int? TargetKcal, bool Included);

public sealed record CalendarDay(DateOnly Date, int? Kcal, int? TargetKcal, string Status, bool Counted);

public sealed record ProposedTarget(int Bmr, int Tdee, int Kcal, int Protein, int Fat, int Carbs, bool FloorApplied)
{
    public static ProposedTarget From(NutritionResult result) =>
        new(result.Bmr, result.Tdee, result.Kcal, result.Protein, result.Fat, result.Carbs, result.FloorApplied);
}

/// <summary>
/// What a review needs besides the days. <see cref="From"/>–<see cref="To"/> is the period the
/// calendar and low days show; <see cref="Facts"/> also reach back over the burn's window.
/// <see cref="Earliest"/> is the first day a weigh-in may count (after the settling week).
/// <see cref="DaysSinceLast"/> is how long ago the burn was last measured or reset.
/// </summary>
public sealed record ReviewInput(
    DateOnly From,
    DateOnly To,
    DateOnly Today,
    DateOnly Earliest,
    IReadOnlyList<DayFact> Facts,
    IReadOnlyList<(DateOnly Date, decimal Kg)> WeighIns,
    NutritionInput Input,
    int PriorBurn,
    int PriorSdKcal,
    int DaysSinceLast);

public sealed record AdaptiveReview(
    DateOnly From,
    DateOnly To,
    int PeriodDays,
    IReadOnlyList<ReviewDay> LowDays,
    IReadOnlyList<CalendarDay> Calendar,
    int IncludedDays,
    bool Measured,
    string? Blocked,
    int WeighInsNeeded,
    decimal? AverageKcal,
    WeightFit? Fit,
    BurnWindow Window,
    CappedStep? Step,
    int Burn,
    int BurnSdKcal,
    decimal? FarShare,
    ProposedTarget Proposed,
    ProposedTarget Formula,
    int? CountedKcal,
    int? LeftOutKcal);

/// <summary>
/// On-demand target review. A logged day is low when its calories are 80% or
/// less of that day's own target; low days count unless the person leaves them
/// out. A day with no log is left out unless they count it as 0. Nothing is
/// filled in when a number was not stored.
/// The burn is measured from the weigh-ins and food of a rolling window
/// (<see cref="BurnReadings"/>) and moves toward it a capped step at a time. When it
/// can't be measured, the current burn is kept.
/// </summary>
public static class AdaptiveTarget
{
    public const decimal UnderRatio = 0.8m;

    /// <summary>A burn further than this share from the formula gets a wide range and a note.</summary>
    public const decimal FarShare = 0.25m;

    public const string Low = "low";

    public const string Over = "over";

    public const string Normal = "normal";

    public const string NoLog = "nolog";

    public static bool IsUnderTarget(decimal loggedKcal, int targetKcal) =>
        targetKcal > 0 && loggedKcal <= UnderRatio * targetKcal;

    public static string StatusOf(DayFact fact)
    {
        if (!fact.HasLog)
        {
            return NoLog;
        }

        if (fact.TargetKcal is int target && target > 0)
        {
            if (IsUnderTarget(fact.LoggedKcal, target))
            {
                return Low;
            }

            if (fact.LoggedKcal > target)
            {
                return Over;
            }
        }

        return Normal;
    }

    public static AdaptiveReview Review(ReviewInput input, IReadOnlySet<DateOnly> excluded, IReadOnlySet<DateOnly>? includeZero = null)
    {
        includeZero ??= new HashSet<DateOnly>();
        var review = Compute(input, excluded, includeZero);
        if (review.LowDays.Count == 0)
        {
            return review;
        }

        // The low-day card shows the target both ways, whatever is chosen now.
        var allLow = review.LowDays.Select(day => day.Date).ToHashSet();
        var counted = review.LowDays.All(day => day.Included)
            ? review
            : Compute(input, excluded.Except(allLow).ToHashSet(), includeZero);
        var leftOut = review.LowDays.All(day => !day.Included)
            ? review
            : Compute(input, excluded.Union(allLow).ToHashSet(), includeZero);
        return review with { CountedKcal = counted.Proposed.Kcal, LeftOutKcal = leftOut.Proposed.Kcal };
    }

    private static AdaptiveReview Compute(ReviewInput input, IReadOnlySet<DateOnly> excluded, IReadOnlySet<DateOnly> includeZero)
    {
        var (from, to) = (input.From, input.To);
        var periodDays = to < from ? 0 : to.DayNumber - from.DayNumber + 1;
        var lowDays = new List<ReviewDay>();
        var calendar = new List<CalendarDay>();
        var counted = new List<decimal>();
        var intake = new List<IntakeDay>();
        foreach (var fact in input.Facts.OrderBy(fact => fact.Date))
        {
            var status = StatusOf(fact);
            var isCounted = status switch
            {
                NoLog => includeZero.Contains(fact.Date),
                Low => !excluded.Contains(fact.Date),
                _ => true,
            };

            // A day left out isn't known to the burn: it is filled with the average logged day.
            decimal? kcal = !isCounted ? null : status == NoLog ? 0m : fact.LoggedKcal;
            intake.Add(new IntakeDay(fact.Date, kcal, fact.TargetKcal));
            if (fact.Date < from || fact.Date > to)
            {
                continue;
            }

            int? logged = fact.HasLog ? NutritionMath.Round(fact.LoggedKcal) : null;
            if (isCounted)
            {
                counted.Add(kcal ?? 0m);
            }

            calendar.Add(new CalendarDay(fact.Date, logged, fact.TargetKcal, status, isCounted));
            if (status == Low)
            {
                lowDays.Add(new ReviewDay(fact.Date, logged ?? 0, fact.TargetKcal, isCounted));
            }
        }

        var formula = NutritionMath.Calculate(input.Input);
        decimal? average = counted.Count == 0 ? null : counted.Sum() / counted.Count;
        var window = BurnReadings.Measure(input.Today, input.Earliest, input.WeighIns, intake, input.PriorBurn);
        var fit = BurnEstimate.Fit(input.WeighIns.Where(row => row.Date >= window.From && row.Date <= input.Today).ToList());
        var needed = window.Tier == BurnTier.Rare ? Math.Max(1, BurnReadings.MinimumWeighIns - window.WeighIns) : 0;

        CappedStep? step = null;
        decimal burn = input.PriorBurn;
        decimal burnSd = input.PriorSdKcal;
        if (window.Burn is not null)
        {
            step = BurnReadings.Step(input.PriorBurn, input.PriorSdKcal, input.DaysSinceLast, window);
            // A burn under BMR means the logs or the scale are off, not the body.
            burn = Math.Max(step.Burn, formula.Bmr);
            burnSd = step.BurnSd;
        }

        // Far from the usual for this body: no hard stop, but the range widens to cover the formula's half.
        decimal? far = null;
        var gap = burn - formula.Tdee;
        if (formula.Tdee > 0 && Math.Abs(gap) > FarShare * formula.Tdee)
        {
            far = gap / formula.Tdee;
            burnSd = Math.Max(burnSd, Math.Abs(gap) / 2);
        }

        var proposed = ProposedTarget.From(NutritionMath.FromExpenditure(input.Input, burn));
        return new AdaptiveReview(
            from,
            to,
            periodDays,
            lowDays,
            calendar,
            counted.Count,
            step is not null,
            window.Blocked,
            needed,
            average,
            fit,
            window,
            step,
            NutritionMath.Round(burn),
            NutritionMath.Round(burnSd),
            far,
            proposed,
            ProposedTarget.From(formula),
            null,
            null);
    }
}
