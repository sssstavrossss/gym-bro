using GymBro.Api.Notifications;
using GymBro.Api.Nutrition;

namespace GymBro.Api.Tests;

public sealed class AdaptiveTargetTests
{
    // BMR 1786, formula burn 2768, formula target 2218.
    private static readonly NutritionInput Person = new(
        Sexes.Male, 83.6m, 180m, 36, ActivityLevels.Moderate, Goals.Lose, 0.5m, 2.0m, 25m);

    private static readonly DateOnly From = new(2026, 10, 1);

    private static readonly DateOnly To = From.AddDays(20);

    private const decimal LossPerDay = 0.5m / 7m;

    private static List<DayFact> Days(decimal kcal, int target = 2218) =>
        Enumerable.Range(0, 21).Select(offset => new DayFact(From.AddDays(offset), kcal, true, target)).ToList();

    /// <summary>A weigh-in every <paramref name="every"/> days from three days before the period through the day after it.</summary>
    private static List<(DateOnly, decimal)> Line(int every = 1, params decimal[] noise)
    {
        var start = From.AddDays(-BurnEstimate.LookbackDays);
        var rows = new List<(DateOnly, decimal)>();
        var index = 0;
        for (var date = start; date <= To.AddDays(1); date = date.AddDays(every), index++)
        {
            var offset = noise.Length == 0 ? 0m : noise[index % noise.Length];
            rows.Add((date, 84m - LossPerDay * (date.DayNumber - start.DayNumber) + offset));
        }

        return rows;
    }

    private static AdaptiveReview Review(
        List<DayFact> facts,
        List<(DateOnly, decimal)> weighIns,
        int prior = 2768,
        int priorSd = 350,
        IReadOnlySet<DateOnly>? excluded = null,
        IReadOnlySet<DateOnly>? includeZero = null) =>
        AdaptiveTarget.Review(
            new ReviewInput(From, To, To.AddDays(1), From.AddDays(-60), facts, weighIns, Person, prior, priorSd, 21),
            excluded ?? new HashSet<DateOnly>(),
            includeZero);

    [Fact]
    public void Clean_daily_weigh_ins_measure_the_burn_and_move_at_most_five_percent()
    {
        var review = Review(Days(2000m), Line());

        Assert.True(review.Measured);
        Assert.Null(review.Blocked);
        Assert.Equal(21, review.PeriodDays);
        Assert.Equal(21, review.IncludedDays);
        Assert.Equal(2000m, review.AverageKcal);
        Assert.Equal(BurnTier.Regular, review.Window.Tier);
        Assert.Equal(25, review.Window.WeighIns);
        Assert.Equal(24, review.Window.Readings.Count);
        var fit = Assert.IsType<WeightFit>(review.Fit);
        Assert.Equal(-0.5m, decimal.Round(fit.RateKgPerWeek, 3));
        var step = Assert.IsType<CappedStep>(review.Step);
        // 2,000 eaten and 0.5 kg a week lost: 2,550. The formula's 2,768 moves 5% of the way there.
        Assert.Equal(2550m, decimal.Round(step.Target));
        Assert.Equal(2768m, step.Prior);
        Assert.True(step.Capped);
        Assert.Equal(2768 - 138, review.Burn);
        Assert.Equal(review.Burn, review.Proposed.Tdee);
        Assert.Equal(review.Burn - 550, review.Proposed.Kcal);
        Assert.Equal(2768, review.Formula.Tdee);
        Assert.Equal(2218, review.Formula.Kcal);
        Assert.Null(review.FarShare);
        // What the cap left over keeps it unsure, so the next week can go on.
        Assert.True(review.BurnSdKcal >= 39);
    }

    [Fact]
    public void A_burn_already_close_to_the_measurement_stays_put()
    {
        var review = Review(Days(2000m), Line(), prior: 2550, priorSd: 80);
        Assert.InRange(review.Burn, 2549, 2551);
        Assert.False(review.Step!.Capped);
    }

    [Fact]
    public void Sparse_noisy_weigh_ins_move_the_burn_less_than_daily_ones()
    {
        var daily = Review(Days(2000m), Line(1, 0.3m, -0.3m), prior: 2600, priorSd: 150);
        var weekly = Review(Days(2000m), Line(7, 0.3m, -0.3m), prior: 2600, priorSd: 150);

        Assert.True(daily.Measured);
        Assert.True(weekly.Measured);
        Assert.Equal(4, weekly.Window.WeighIns);
        Assert.True(weekly.Window.Sd > daily.Window.Sd);
        Assert.True(weekly.Step!.Gain < daily.Step!.Gain);
        Assert.True(weekly.Step.Gain > 0.1m);
    }

    [Fact]
    public void Low_days_count_unless_left_out_and_the_left_out_target_is_offered()
    {
        var facts = Days(2000m);
        facts[3] = facts[3] with { LoggedKcal = 1700m };
        facts[9] = facts[9] with { LoggedKcal = 1000m };
        var counted = Review(facts, Line(), prior: 2550, priorSd: 200);

        Assert.Equal(2, counted.LowDays.Count);
        Assert.All(counted.LowDays, day => Assert.True(day.Included));
        Assert.Equal(21, counted.IncludedDays);
        Assert.Equal(AdaptiveTarget.Low, counted.Calendar[3].Status);
        Assert.True(counted.Calendar[3].Counted);
        Assert.Equal(AdaptiveTarget.Normal, counted.Calendar[0].Status);

        // A day left out is filled with the average logged day for the burn.
        var excluded = new HashSet<DateOnly> { From.AddDays(3), From.AddDays(9) };
        var leftOut = Review(facts, Line(), prior: 2550, priorSd: 200, excluded: excluded);
        Assert.Equal(19, leftOut.IncludedDays);
        Assert.Equal(2000m, leftOut.AverageKcal);
        Assert.All(leftOut.LowDays, day => Assert.False(day.Included));
        Assert.Equal(2550m, decimal.Round(leftOut.Window.Burn!.Value));
        Assert.True(counted.Window.Burn < leftOut.Window.Burn);
        Assert.Equal(leftOut.Proposed.Kcal, counted.LeftOutKcal);
        Assert.Equal(counted.Proposed.Kcal, counted.CountedKcal);
        Assert.True(counted.LeftOutKcal > counted.Proposed.Kcal);

        // A mixed choice still offers both: all counted and all left out.
        var mixed = Review(facts, Line(), prior: 2550, priorSd: 200, excluded: new HashSet<DateOnly> { From.AddDays(9) });
        Assert.Equal(counted.Proposed.Kcal, mixed.CountedKcal);
        Assert.Equal(leftOut.Proposed.Kcal, mixed.LeftOutKcal);
    }

    [Fact]
    public void Exactly_80_percent_is_low_and_a_day_over_target_is_over()
    {
        Assert.Equal(AdaptiveTarget.Low, AdaptiveTarget.StatusOf(new DayFact(From, 1600m, true, 2000)));
        Assert.Equal(AdaptiveTarget.Normal, AdaptiveTarget.StatusOf(new DayFact(From, 1601m, true, 2000)));
        Assert.Equal(AdaptiveTarget.Over, AdaptiveTarget.StatusOf(new DayFact(From, 2001m, true, 2000)));
        Assert.Equal(AdaptiveTarget.NoLog, AdaptiveTarget.StatusOf(new DayFact(From, 0m, false, 2000)));
    }

    [Fact]
    public void A_day_with_no_log_is_left_out_unless_counted_as_zero()
    {
        var facts = Days(2000m);
        facts[5] = new DayFact(From.AddDays(5), 0m, false, 2218);
        var review = Review(facts, Line());
        Assert.Equal(20, review.IncludedDays);
        Assert.Equal(AdaptiveTarget.NoLog, review.Calendar[5].Status);
        Assert.False(review.Calendar[5].Counted);
        Assert.Null(review.Calendar[5].Kcal);
        Assert.Empty(review.LowDays);
        Assert.Null(review.LeftOutKcal);
        Assert.Null(review.CountedKcal);

        var zero = Review(facts, Line(), includeZero: new HashSet<DateOnly> { From.AddDays(5) });
        Assert.Equal(21, zero.IncludedDays);
        Assert.True(zero.Calendar[5].Counted);
        Assert.Equal(2000m * 20 / 21, zero.AverageKcal);
    }

    [Fact]
    public void Too_few_logged_days_keep_the_current_burn()
    {
        var facts = Days(2000m).Select((day, index) => index < 6 ? day : new DayFact(day.Date, 0m, false, 2218)).ToList();
        var review = Review(facts, Line(), prior: 2600, priorSd: 120);

        Assert.False(review.Measured);
        Assert.Equal(BurnReadings.NeedLogs, review.Blocked);
        Assert.Null(review.Step);
        Assert.Equal(2600, review.Burn);
        Assert.Equal(120, review.BurnSdKcal);
        Assert.Equal(2050, review.Proposed.Kcal);
    }

    [Fact]
    public void Too_few_or_bunched_weigh_ins_say_what_is_missing()
    {
        var one = Review(Days(2000m), [(From, 84m)]);
        Assert.Equal(BurnTier.Rare, one.Window.Tier);
        Assert.Equal(BurnReadings.NeedWeighIns, one.Blocked);
        Assert.Equal(1, one.WeighInsNeeded);
        Assert.Equal(2768, one.Burn);

        var bunched = Review(Days(2000m), [(To, 84m), (To.AddDays(-2), 84.1m), (To.AddDays(-4), 84.2m)]);
        Assert.Equal(BurnTier.Sparse, bunched.Window.Tier);
        Assert.Equal(BurnReadings.NeedSpread, bunched.Blocked);
        Assert.Equal(0, bunched.WeighInsNeeded);
    }

    [Fact]
    public void A_measured_burn_under_bmr_is_raised_to_bmr_and_flagged_far_from_the_formula()
    {
        var review = Review(Days(900m, 2218), Line(), prior: 1800, priorSd: 50);
        Assert.True(review.Measured);
        Assert.Equal(1786, review.Burn);
        Assert.Equal(1786, review.Proposed.Kcal);
        Assert.True(review.Proposed.FloorApplied);
        Assert.True(review.FarShare < -0.25m);
    }

    [Fact]
    public void A_burn_far_from_the_formula_keeps_going_with_a_wide_range()
    {
        var review = Review(Days(3000m), Line(), prior: 3600, priorSd: 100);
        Assert.True(review.Measured);
        Assert.InRange(review.Burn, 3540, 3600);
        Assert.True(review.FarShare > 0.25m);
        // No hard stop: the range widens to half the distance from the formula.
        Assert.True(review.BurnSdKcal >= (review.Burn - 2768) / 2);
    }

    [Fact]
    public void Fit_is_a_least_squares_line_with_a_noise_floor()
    {
        var day = new DateOnly(2026, 1, 1);
        var fit = BurnEstimate.Fit([(day, 80m), (day.AddDays(7), 79.3m), (day.AddDays(14), 78.6m), (day.AddDays(14), 78.6m)]);
        Assert.NotNull(fit);
        Assert.Equal(3, fit.WeighIns);
        Assert.Equal(14, fit.SpanDays);
        Assert.Equal(-0.1m, decimal.Round(fit.SlopeKgPerDay, 6));
        // A perfect line still assumes 0.5 kg of noise with only three weigh-ins: 0.5 / sqrt(98).
        Assert.Equal(0.0505m, decimal.Round(fit.SlopeSeKgPerDay, 4));
        Assert.Null(BurnEstimate.Fit([(day, 80m), (day.AddDays(7), 79m)]));
        Assert.Null(BurnEstimate.Fit([(day, 80m), (day.AddDays(2), 79m), (day.AddDays(5), 79m)]));
    }

    [Fact]
    public void A_carried_burn_keeps_its_distance_from_the_formula()
    {
        Assert.Equal(2600, BurnEstimate.Carry(2500, 2700, 2600));
        Assert.Equal(2500, BurnEstimate.Carry(2500, 2600, 2600));
    }

    [Fact]
    public void The_period_starts_after_the_last_period_start_and_reaches_back_eight_weeks_at_most()
    {
        var today = new DateOnly(2026, 11, 17);
        var setup = new DateOnly(2026, 1, 1);

        var weekly = RecalculatePeriod.For(today, setup, null, today.AddDays(-8), null);
        Assert.Equal(today.AddDays(-8), weekly.From);
        Assert.Equal(today.AddDays(-1), weekly.To);
        Assert.Equal(today.AddDays(-11), weekly.SlopeFrom);

        // Recalculating every Monday reads the whole week, the last Monday included.
        var monday = new DateOnly(2026, 11, 16);
        var week = RecalculatePeriod.For(monday, setup, null, monday.AddDays(-7), null);
        Assert.Equal(new DateOnly(2026, 11, 9), week.From);
        Assert.Equal(new DateOnly(2026, 11, 15), week.To);
        Assert.Equal(7, week.To.DayNumber - week.From.DayNumber + 1);
        Assert.False(weekly.Capped);
        Assert.Null(weekly.SettledFrom);

        var long_ = RecalculatePeriod.For(today, setup, null, new DateOnly(2026, 3, 14), null);
        Assert.True(long_.Capped);
        Assert.Equal(56, long_.To.DayNumber - long_.From.DayNumber + 1);
        Assert.Equal(new DateOnly(2026, 3, 14), long_.LastUpdate);
    }

    [Fact]
    public void A_new_account_or_fresh_start_skips_the_first_week_of_weigh_ins()
    {
        var today = new DateOnly(2026, 11, 17);
        var setup = today.AddDays(-21);

        var first = RecalculatePeriod.For(today, setup, setup.AddDays(-1), null, null);
        Assert.Equal(setup.AddDays(-1), first.From);
        Assert.Equal(setup.AddDays(7), first.SlopeFrom);
        Assert.Equal(setup.AddDays(7), first.SettledFrom);

        var fresh = today.AddDays(-10);
        var afterGap = RecalculatePeriod.For(today, new DateOnly(2026, 1, 1), null, today.AddDays(-60), fresh);
        Assert.Equal(fresh, afterGap.From);
        Assert.Equal(fresh.AddDays(7), afterGap.SlopeFrom);
        Assert.Equal(fresh.AddDays(7), RecalculatePeriod.Settled(new DateOnly(2026, 1, 1), fresh));
        Assert.Equal(setup.AddDays(7), RecalculatePeriod.Settled(setup, null));
    }

    [Fact]
    public void The_latest_fresh_start_is_the_last_weigh_in_after_a_gap_over_28_days()
    {
        var day = new DateOnly(2026, 1, 1);
        Assert.Null(RecalculatePeriod.LatestFreshStart([(day, 80m), (day.AddDays(28), 80m)], day.AddDays(60)));
        Assert.Equal(day.AddDays(29), RecalculatePeriod.LatestFreshStart([(day, 80m), (day.AddDays(29), 80m), (day.AddDays(30), 80m)], day.AddDays(60)));
        Assert.Null(RecalculatePeriod.LatestFreshStart([(day, 80m), (day.AddDays(29), 80m)], day.AddDays(20)));
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
}
