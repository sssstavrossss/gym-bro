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

/// <summary>What a review needs besides the days: the weigh-ins for the slope, and the burn it starts from.</summary>
public sealed record ReviewInput(
    DateOnly From,
    DateOnly To,
    IReadOnlyList<DayFact> Facts,
    IReadOnlyList<(DateOnly Date, decimal Kg)> SlopeWeighIns,
    NutritionInput Input,
    int PriorBurn,
    int PriorSdKcal);

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
    BurnStep? Step,
    int Burn,
    int BurnSdKcal,
    ProposedTarget Proposed,
    ProposedTarget Formula,
    int? CountedKcal,
    int? LeftOutKcal);

/// <summary>
/// On-demand target review. A logged day is low when its calories are 80% or
/// less of that day's own target; low days count unless the person leaves them
/// out. A day with no log is left out unless they count it as 0. Nothing is
/// filled in when a number was not stored.
/// The burn is measured from the average counted intake and the weight slope,
/// then stepped from the current burn (<see cref="BurnEstimate"/>). When it
/// can't be measured, the current burn is kept.
/// </summary>
public static class AdaptiveTarget
{
    public const decimal UnderRatio = 0.8m;

    public const int MinimumIncludedDays = 7;

    public const string NeedMoreDays = "Fewer than 7 days are counted, so your burn can't be measured yet.";

    public const string NeedSpread = "Your weigh-ins need to be at least 6 days apart, first to last, to measure your burn.";

    public const string Low = "low";

    public const string Over = "over";

    public const string Normal = "normal";

    public const string NoLog = "nolog";

    public static bool IsUnderTarget(decimal loggedKcal, int targetKcal) =>
        targetKcal > 0 && loggedKcal <= UnderRatio * targetKcal;

    public static string NeedWeighIns(int more) =>
        more == 1 ? "Weigh in 1 more time to measure your burn." : $"Weigh in {more} more times to measure your burn.";

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
        foreach (var fact in input.Facts.OrderBy(fact => fact.Date))
        {
            if (fact.Date < from || fact.Date > to)
            {
                continue;
            }

            var status = StatusOf(fact);
            int? logged = fact.HasLog ? NutritionMath.Round(fact.LoggedKcal) : null;
            var isCounted = status switch
            {
                NoLog => includeZero.Contains(fact.Date),
                Low => !excluded.Contains(fact.Date),
                _ => true,
            };
            if (isCounted)
            {
                counted.Add(status == NoLog ? 0m : fact.LoggedKcal);
            }

            calendar.Add(new CalendarDay(fact.Date, logged, fact.TargetKcal, status, isCounted));
            if (status == Low)
            {
                lowDays.Add(new ReviewDay(fact.Date, logged ?? 0, fact.TargetKcal, isCounted));
            }
        }

        var formula = NutritionMath.Calculate(input.Input);
        decimal? average = counted.Count == 0 ? null : counted.Sum() / counted.Count;
        var fit = BurnEstimate.Fit(input.SlopeWeighIns);
        var weighIns = input.SlopeWeighIns.Select(row => row.Date).Distinct().Count();
        var needed = Math.Max(0, BurnEstimate.MinimumWeighIns - weighIns);

        string? blocked = null;
        if (counted.Count < MinimumIncludedDays)
        {
            blocked = NeedMoreDays;
        }
        else if (fit is null)
        {
            blocked = needed > 0 ? NeedWeighIns(needed) : NeedSpread;
        }

        BurnStep? step = null;
        decimal burn = input.PriorBurn;
        decimal burnSd = input.PriorSdKcal;
        if (blocked is null && fit is not null && average is decimal eaten)
        {
            var (measured, measuredSd) = BurnEstimate.Measure(eaten, fit);
            step = BurnEstimate.Step(input.PriorBurn, input.PriorSdKcal, periodDays / 7m, measured, measuredSd);
            // A burn under BMR means the logs or the scale are off, not the body.
            burn = Math.Max(step.Burn, formula.Bmr);
            burnSd = step.BurnSd;
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
            blocked,
            blocked is null ? 0 : needed,
            average,
            fit,
            step,
            NutritionMath.Round(burn),
            NutritionMath.Round(burnSd),
            proposed,
            ProposedTarget.From(formula),
            null,
            null);
    }
}
