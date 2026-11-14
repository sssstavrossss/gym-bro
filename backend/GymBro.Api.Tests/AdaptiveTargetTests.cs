using GymBro.Api.Notifications;
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
    public void Days_at_80_percent_or_less_are_listed_and_can_be_excluded()
    {
        var from = new DateOnly(2026, 10, 1);
        var exact = from;
        var justOver = from.AddDays(1);
        var facts = new List<DayFact>
        {
            new(exact, 1600m, true, false, 2000),
            new(justOver, 1602m, true, false, 2000),
        };
        for (var i = 0; i < 6; i++)
        {
            facts.Add(new DayFact(from.AddDays(2 + i), 2000m, true, false, 2000));
        }

        var open = AdaptiveTarget.Review(
            from, facts[^1].Date, facts, new HashSet<DateOnly>(), 80m, 80m, true, true, Person, null);
        var listed = Assert.Single(open.Days);
        Assert.Equal(exact, listed.Date);
        Assert.Equal(1600, listed.Kcal);
        Assert.True(listed.CanExclude);
        Assert.True(listed.Included);
        Assert.False(listed.Fasting);
        Assert.DoesNotContain(open.Days, day => day.Date == justOver);
        Assert.Equal(8, open.IncludedDays);

        var closed = AdaptiveTarget.Review(
            from, facts[^1].Date, facts, new HashSet<DateOnly> { exact }, 80m, 80m, true, true, Person, null);
        Assert.False(closed.Days.Single().Included);
        Assert.Equal(7, closed.IncludedDays);
        Assert.DoesNotContain(1600m, ClosedAverage(closed));
    }

    [Fact]
    public void A_fasting_day_counts_only_when_it_has_a_log_and_only_at_that_log()
    {
        var from = new DateOnly(2026, 10, 1);
        var facts = Enumerable.Range(0, 5).Select(offset =>
            new DayFact(from.AddDays(offset), 2000m, true, false, 2000)).ToList();
        var loggedAbove = from.AddDays(5);
        var loggedLow = from.AddDays(6);
        var empty = from.AddDays(7);
        facts.Add(new DayFact(loggedAbove, 1700m, true, true, 2000));
        facts.Add(new DayFact(loggedLow, 1600m, true, true, 2000));
        facts.Add(new DayFact(empty, 0m, false, true, 2000));

        var review = AdaptiveTarget.Review(
            from, empty, facts, new HashSet<DateOnly> { loggedLow }, 80m, 80m, true, true, Person, null);
        var row = Assert.Single(review.Days);
        Assert.Equal(loggedLow, row.Date);
        Assert.Equal(1600, row.Kcal);
        Assert.False(row.Fasting);
        Assert.True(row.CanExclude);
        Assert.False(row.Included);
        Assert.Equal(6, review.IncludedDays);
        Assert.DoesNotContain(review.Days, day => day.Date == empty || day.Date == loggedAbove);
        Assert.DoesNotContain(0m, ClosedAverage(review));
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

    [Fact]
    public void A_counted_zero_day_counts_toward_seven_and_the_calendar_names_each_status()
    {
        var from = new DateOnly(2026, 10, 1);
        var facts = new List<DayFact>();
        for (var i = 0; i < 6; i++)
        {
            facts.Add(new DayFact(from.AddDays(i), 2000m, true, false, 2000));
        }

        var low = from.AddDays(6);
        var justOver = from.AddDays(7);
        var over = from.AddDays(8);
        var empty = from.AddDays(9);
        facts.Add(new DayFact(low, 1600m, true, false, 2000));
        facts.Add(new DayFact(justOver, 1602m, true, false, 2000));
        facts.Add(new DayFact(over, 2500m, true, false, 2000));
        facts.Add(new DayFact(empty, 0m, false, true, 2000));

        var open = AdaptiveTarget.Review(
            from, empty, facts, new HashSet<DateOnly>(), 80m, 80m, true, true, Person, null);
        Assert.Equal(AdaptiveTarget.Low, open.Calendar.Single(day => day.Date == low).Status);
        Assert.Equal(AdaptiveTarget.Normal, open.Calendar.Single(day => day.Date == justOver).Status);
        Assert.Equal(AdaptiveTarget.Over, open.Calendar.Single(day => day.Date == over).Status);
        Assert.Equal(AdaptiveTarget.NoLog, open.Calendar.Single(day => day.Date == empty).Status);
        Assert.False(open.Calendar.Single(day => day.Date == empty).Counted);
        Assert.Null(open.Calendar.Single(day => day.Date == empty).Kcal);
        Assert.Equal(9, open.IncludedDays);

        var withZero = AdaptiveTarget.Review(
            from, empty, facts, new HashSet<DateOnly>(), 80m, 80m, true, true, Person, null, new HashSet<DateOnly> { empty });
        Assert.Equal(10, withZero.IncludedDays);
        Assert.True(withZero.Calendar.Single(day => day.Date == empty).Counted);
        Assert.True(withZero.Enough);
        var sum = 6 * 2000m + 1600m + 1602m + 2500m;
        Assert.Equal(sum / 9m, open.AverageKcal);
        Assert.Equal(sum / 10m, withZero.AverageKcal);

        var overStays = AdaptiveTarget.Review(
            from, empty, facts, new HashSet<DateOnly> { over }, 80m, 80m, true, true, Person, null);
        Assert.True(overStays.Calendar.Single(day => day.Date == over).Counted);
    }

    [Fact]
    public void The_banner_week_runs_Monday_to_Sunday()
    {
        Assert.Equal(new DateOnly(2026, 11, 9), RecalculateBanner.WeekStart(new DateOnly(2026, 11, 9)));
        Assert.Equal(new DateOnly(2026, 11, 9), RecalculateBanner.WeekStart(new DateOnly(2026, 11, 10)));
        Assert.Equal(new DateOnly(2026, 11, 9), RecalculateBanner.WeekStart(new DateOnly(2026, 11, 15)));
        Assert.Equal(new DateOnly(2026, 11, 16), RecalculateBanner.WeekStart(new DateOnly(2026, 11, 16)));
        Assert.True(RecalculateBanner.Visible(false, false));
        Assert.False(RecalculateBanner.Visible(true, false));
        Assert.False(RecalculateBanner.Visible(false, true));
    }

    [Fact]
    public void A_local_Monday_is_stored_as_a_UTC_instant()
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Europe/Oslo");
        var utc = NotificationBook.UtcInstant(new DateOnly(2026, 11, 9), zone);
        Assert.Equal(TimeSpan.Zero, utc.Offset);
        Assert.Equal(new DateTimeOffset(2026, 11, 8, 23, 0, 0, TimeSpan.Zero), utc);
    }

    private static IEnumerable<decimal> ClosedAverage(AdaptiveReview review) =>
        review.Days.Where(day => day.Included).Select(day => (decimal)day.Kcal);
}
