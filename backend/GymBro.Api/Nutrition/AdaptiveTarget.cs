namespace GymBro.Api.Nutrition;

public static class RecalculationReasons
{
    /// <summary>The person confirmed an adaptive burn from their own logs and weigh-ins.</summary>
    public const string Adaptive = "recalculation_adaptive";

    /// <summary>Not enough logs or weigh-ins, so the person confirmed the Mifflin-St Jeor formula instead.</summary>
    public const string Formula = "recalculation_formula";

    public static bool IsRecalculation(string reason) =>
        reason is TargetReasons.WeeklyRecalculation or Adaptive or Formula;
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

/// <summary>One day inside a recalculation window. Logged kcal is what was stored, never guessed.</summary>
public sealed record DayFact(DateOnly Date, decimal LoggedKcal, bool HasLog, bool Fasting, int? TargetKcal);

public sealed record ReviewDay(DateOnly Date, int Kcal, int? TargetKcal, bool Fasting, bool CanExclude, bool Included);

public sealed record ProposedTarget(int Bmr, int Tdee, int Kcal, int Protein, int Fat, int Carbs, bool FloorApplied, bool ManualKept);

public sealed record AdaptiveReview(
    DateOnly From,
    DateOnly To,
    int PeriodDays,
    IReadOnlyList<ReviewDay> Days,
    int IncludedDays,
    bool Enough,
    string? Blocked,
    decimal? TrendStartKg,
    decimal? TrendEndKg,
    decimal? TrendChangeKg,
    decimal? AverageKcal,
    decimal? Burn,
    ProposedTarget? Proposed,
    ProposedTarget Formula);

/// <summary>
/// On-demand target review. A logged day is listed when its calories are 80%
/// or less of that day's own target. A day with no log is left out. A fasting
/// mark does not add the day, remove it, or replace its logged calories.
/// Nothing is filled in when a number was not stored.
/// </summary>
public static class AdaptiveTarget
{
    public const decimal UnderRatio = 0.8m;

    public const int MinimumIncludedDays = 7;

    public const string NeedMoreDays = "Fewer than 7 days can be included, so there is no adaptive target.";

    public const string NeedWeighIns = "There is no weigh-in at the start of this period and another inside it, so the trend change is not measurable.";

    public static bool IsUnderTarget(decimal loggedKcal, int targetKcal) =>
        targetKcal > 0 && loggedKcal <= UnderRatio * targetKcal;

    public static AdaptiveReview Review(
        DateOnly from,
        DateOnly to,
        IReadOnlyList<DayFact> facts,
        IReadOnlySet<DateOnly> excluded,
        decimal? trendStartKg,
        decimal? trendEndKg,
        bool weighInOnOrBeforeStart,
        bool weighInInsidePeriod,
        NutritionInput input,
        int? manualKcal)
    {
        var periodDays = to < from ? 0 : to.DayNumber - from.DayNumber + 1;
        var listed = new List<ReviewDay>();
        var includedKcal = new List<decimal>();
        foreach (var fact in facts.OrderBy(fact => fact.Date))
        {
            if (fact.Date < from || fact.Date > to)
            {
                continue;
            }

            var under = fact.HasLog && fact.TargetKcal is int target && IsUnderTarget(fact.LoggedKcal, target);
            var include = fact.HasLog && fact.TargetKcal is not null && !(under && excluded.Contains(fact.Date));
            if (include)
            {
                includedKcal.Add(fact.LoggedKcal);
            }

            if (!under)
            {
                continue;
            }

            listed.Add(new ReviewDay(
                fact.Date,
                (int)decimal.Round(fact.LoggedKcal, 0, MidpointRounding.AwayFromZero),
                fact.TargetKcal,
                false,
                true,
                include));
        }

        var formula = ToProposed(NutritionMath.Calculate(input), manualKept: false);
        decimal? average = includedKcal.Count == 0 ? null : includedKcal.Sum() / includedKcal.Count;
        var trendKnown = weighInOnOrBeforeStart && weighInInsidePeriod && trendStartKg is not null && trendEndKg is not null;
        decimal? change = trendKnown ? trendEndKg - trendStartKg : null;
        decimal? burn = average is decimal avg && change is decimal delta && periodDays > 0
            ? avg - (delta * NutritionMath.KcalPerKg / periodDays)
            : null;

        string? blocked = null;
        if (includedKcal.Count < MinimumIncludedDays)
        {
            blocked = NeedMoreDays;
        }
        else if (!trendKnown)
        {
            blocked = NeedWeighIns;
        }

        ProposedTarget? proposed = null;
        if (blocked is null && burn is decimal ready)
        {
            var result = NutritionMath.FromExpenditure(input, ready, manualKcal);
            proposed = ToProposed(result, manualKcal is not null);
        }

        return new AdaptiveReview(
            from,
            to,
            periodDays,
            listed,
            includedKcal.Count,
            blocked is null,
            blocked,
            trendKnown ? trendStartKg : null,
            trendKnown ? trendEndKg : null,
            change,
            average,
            burn,
            proposed,
            formula);
    }

    private static ProposedTarget ToProposed(NutritionResult result, bool manualKept) =>
        new(result.Bmr, result.Tdee, result.Kcal, result.Protein, result.Fat, result.Carbs, result.FloorApplied, manualKept);
}
