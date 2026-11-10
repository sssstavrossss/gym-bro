using GymBro.Api.Nutrition;

namespace GymBro.Api.Tests;

public sealed class AdaptiveTargetTests
{
    private static readonly NutritionInput Person = new(
        Sexes.Male, 83.6m, 180m, 36, ActivityLevels.Moderate, Goals.Lose, 0.5m, 2.0m, 25m);

    [Fact]
    public void Worked_example_turns_intake_and_trend_into_a_target_above_the_floor()
    {
        var from = new DateOnly(2026, 10, 1);
        var facts = Enumerable.Range(0, 14).Select(offset =>
        {
            var date = from.AddDays(offset);
            var kcal = offset < 7 ? 2000m : 2200m;
            return new DayFact(date, kcal, true, false, 2218);
        }).ToList();

        var review = AdaptiveTarget.Review(
            from,
            from.AddDays(13),
            facts,
            new HashSet<DateOnly>(),
            84.0m,
            83.3m,
            true,
            true,
            Person,
            null);

        Assert.True(review.Enough);
        Assert.Equal(14, review.PeriodDays);
        Assert.Equal(14, review.IncludedDays);
        Assert.Empty(review.Days);
        Assert.Equal(-0.7m, review.TrendChangeKg);
        Assert.Equal(2100m, review.AverageKcal);
        Assert.Equal(2100m - (-0.7m * 7700m / 14m), review.Burn);
        Assert.NotNull(review.Proposed);
        Assert.Equal(1786, review.Proposed.Bmr);
        Assert.Equal(2485, review.Proposed.Tdee);
        Assert.Equal(1935, review.Proposed.Kcal);
        Assert.Equal(167, review.Proposed.Protein);
        Assert.Equal(54, review.Proposed.Fat);
        Assert.Equal(196, review.Proposed.Carbs);
        Assert.False(review.Proposed.FloorApplied);
    }

    [Fact]
    public void The_documented_seven_day_burn_keeps_the_bmr_floor_and_macros()
    {
        var from = new DateOnly(2026, 10, 1);
        var facts = Enumerable.Range(0, 14).Select(offset =>
            new DayFact(from.AddDays(offset), 2000m, true, false, 2218)).ToList();
        var review = AdaptiveTarget.Review(
            from, from.AddDays(13), facts, new HashSet<DateOnly>(), 84.0m, 83.3m, true, true, Person, null);
        Assert.Equal(2385m, review.Burn);
        Assert.Equal(1835, review.Proposed!.Kcal);
        Assert.Equal(1786, review.Proposed.Bmr);
        Assert.Equal(167, review.Proposed.Protein);
        Assert.Equal(51, review.Proposed.Fat);
        Assert.Equal(177, review.Proposed.Carbs);
    }

    [Fact]
    public void Days_under_90_percent_are_listed_and_can_be_excluded()
    {
        var day = new DateOnly(2026, 10, 2);
        var facts = new List<DayFact>
        {
            new(new DateOnly(2026, 10, 1), 1800m, true, false, 2000),
            new(day, 1799m, true, false, 2000),
        };
        for (var i = 0; i < 6; i++)
        {
            facts.Add(new DayFact(new DateOnly(2026, 10, 3 + i), 2000m, true, false, 2000));
        }

        var open = AdaptiveTarget.Review(
            facts[0].Date, facts[^1].Date, facts, new HashSet<DateOnly>(), 80m, 80m, true, true, Person, null);
        var listed = Assert.Single(open.Days);
        Assert.Equal(day, listed.Date);
        Assert.True(listed.CanExclude);
        Assert.True(listed.Included);
        Assert.Equal(8, open.IncludedDays);

        var closed = AdaptiveTarget.Review(
            facts[0].Date, facts[^1].Date, facts, new HashSet<DateOnly> { day }, 80m, 80m, true, true, Person, null);
        Assert.False(closed.Days.Single().Included);
        Assert.Equal(7, closed.IncludedDays);
        Assert.DoesNotContain(1799m, ClosedAverage(closed));
    }

    [Fact]
    public void A_fasting_day_stays_included_at_zero_and_cannot_be_excluded()
    {
        var from = new DateOnly(2026, 10, 1);
        var facts = Enumerable.Range(0, 6).Select(offset =>
            new DayFact(from.AddDays(offset), 2000m, true, false, 2000)).ToList();
        var fast = from.AddDays(6);
        facts.Add(new DayFact(fast, 900m, true, true, 2000));
        var review = AdaptiveTarget.Review(
            from, fast, facts, new HashSet<DateOnly> { fast }, 80m, 80m, true, true, Person, null);
        var row = Assert.Single(review.Days);
        Assert.True(row.Fasting);
        Assert.False(row.CanExclude);
        Assert.True(row.Included);
        Assert.Equal(0, row.Kcal);
        Assert.Equal(7, review.IncludedDays);
        Assert.True(review.Enough);
    }

    [Fact]
    public void Fewer_than_seven_included_days_or_no_weigh_ins_do_not_invent_a_target()
    {
        var from = new DateOnly(2026, 10, 1);
        var facts = Enumerable.Range(0, 6).Select(offset =>
            new DayFact(from.AddDays(offset), 2000m, true, false, 2000)).ToList();
        var shortPeriod = AdaptiveTarget.Review(
            from, from.AddDays(5), facts, new HashSet<DateOnly>(), 80m, 79m, true, true, Person, null);
        Assert.False(shortPeriod.Enough);
        Assert.Null(shortPeriod.Proposed);
        Assert.Equal(AdaptiveTarget.NeedMoreDays, shortPeriod.Blocked);
        Assert.Equal(1786, shortPeriod.Formula.Bmr);
        Assert.NotEqual(0, shortPeriod.Formula.Kcal);

        var noScale = AdaptiveTarget.Review(
            from, from.AddDays(13), Enumerable.Range(0, 14).Select(offset =>
                new DayFact(from.AddDays(offset), 2000m, true, false, 2000)).ToList(),
            new HashSet<DateOnly>(), null, null, false, false, Person, null);
        Assert.False(noScale.Enough);
        Assert.Null(noScale.Proposed);
        Assert.Null(noScale.Burn);
        Assert.Equal(AdaptiveTarget.NeedWeighIns, noScale.Blocked);
    }

    [Fact]
    public void A_burn_under_bmr_is_raised_to_the_floor_unless_the_number_is_manual()
    {
        var from = new DateOnly(2026, 10, 1);
        var facts = Enumerable.Range(0, 7).Select(offset =>
            new DayFact(from.AddDays(offset), 1500m, true, false, 2218)).ToList();
        var floored = AdaptiveTarget.Review(
            from, from.AddDays(6), facts, new HashSet<DateOnly>(), 80m, 80m, true, true, Person, null);
        Assert.True(floored.Proposed!.FloorApplied);
        Assert.Equal(floored.Proposed.Bmr, floored.Proposed.Kcal);

        var manual = AdaptiveTarget.Review(
            from, from.AddDays(6), facts, new HashSet<DateOnly>(), 80m, 80m, true, true, Person, 1500);
        Assert.Equal(1500, manual.Proposed!.Kcal);
        Assert.True(manual.Proposed.ManualKept);
        Assert.False(manual.Proposed.FloorApplied);
        Assert.True(manual.Proposed.Tdee > 0);
    }

    [Fact]
    public void A_day_with_no_log_is_left_out()
    {
        var from = new DateOnly(2026, 10, 1);
        var facts = Enumerable.Range(0, 7).Select(offset =>
            new DayFact(from.AddDays(offset), 2000m, true, false, 2000)).ToList();
        facts.Add(new DayFact(from.AddDays(7), 0m, false, false, 2000));
        var review = AdaptiveTarget.Review(
            from, from.AddDays(7), facts, new HashSet<DateOnly>(), 80m, 80m, true, true, Person, null);
        Assert.Equal(7, review.IncludedDays);
        Assert.Empty(review.Days);
    }

    private static IEnumerable<decimal> ClosedAverage(AdaptiveReview review) =>
        review.Days.Where(day => day.Included).Select(day => (decimal)day.Kcal);
}
