using GymBro.Api.Nutrition;
using GymBro.Api.Profiles;

namespace GymBro.Api.Tests;

public sealed class TrendWeightTests
{
    private static readonly DateOnly AsOf = new(2026, 10, 24);

    [Fact]
    public void Rules_are_a_week_window_two_weigh_ins_and_a_28_day_fresh_start()
    {
        Assert.Equal(7, TrendWeight.WindowDays);
        Assert.Equal(2, TrendWeight.LowAccuracyBelow);
        Assert.Equal(28, TrendWeight.FreshStartGapDays);
        Assert.Equal(7, TrendWeight.MeasuredGapDays);
        Assert.Equal(4, TrendWeight.RateMinWeighIns);
        Assert.Equal(14, TrendWeight.RateMinSpanDays);
        Assert.Equal(3.0m, TrendWeight.TypoLimitKg);
    }

    [Fact]
    public void One_decimal_display_rounds_half_away_from_zero()
    {
        Assert.Equal("80.1", TrendWeight.FormatOneDecimal(80.05m));
        Assert.Equal("80.4", TrendWeight.FormatOneDecimal(80.35m));
        Assert.Equal("80.6", TrendWeight.FormatOneDecimal(80.55m));
        Assert.Equal("80.9", TrendWeight.FormatOneDecimal(80.85m));
    }

    [Fact]
    public void Prototype_36_day_dataset_gives_a_pinned_trend_band_rate_and_targets()
    {
        var start = new DateOnly(2026, 9, 19);
        var series = PrototypeWeights.Select((kg, index) => (start.AddDays(index), kg)).ToList();
        var asOf = new DateOnly(2026, 10, 24);

        Assert.Equal(36, series.Count);
        Assert.Equal(asOf, series[^1].Item1);

        var trend = TrendWeight.Compute(series, asOf);
        Assert.Equal(TrendWeight.Normal, trend.TrendState);
        Assert.Empty(trend.Reasons);
        Assert.Equal(83.23m, trend.TrendKg); // The old 10% smoothing gave 83.60, lagging the loss.
        Assert.Equal(0.23m, trend.BandKg);
        Assert.Equal(-0.36m, trend.RateKgPerWeek);

        var targets = NutritionMath.Calculate(new NutritionInput(
            Sexes.Male,
            trend.TrendKg!.Value,
            HeightCm: 180m,
            Age: 36,
            ActivityLevels.Moderate,
            Goals.Lose,
            RateKgPerWeek: 0.5m,
            ProteinGramsPerKg: 2.0m,
            FatPercent: 25m));
        Assert.Equal(2212, targets.Kcal);
    }

    [Fact]
    public void Setup_weight_is_the_trend_that_day_with_the_scale_noise_as_its_band()
    {
        var series = TrendWeight.Compute([(AsOf, 83.6m)], AsOf);
        Assert.Equal(83.60m, series.TrendKg);
        Assert.Equal(0.60m, series.BandKg);
        Assert.Null(series.RateKgPerWeek);
        Assert.Equal(TrendWeight.LowAccuracy, series.TrendState);
        Assert.Equal([TrendWeight.FewerThanTwoWeighInsInSevenDays], series.Reasons);
        Assert.True(series.On(AsOf)!.Real);
        Assert.False(series.On(AsOf)!.Estimated);
        Assert.True(series.On(AsOf)!.Measured);

        var weight = WeightReader.FromSeries(series, setupKg: null, Goals.Lose, 80m, freshStartAccepted: false);
        Assert.Equal(83.60m, weight.UsedKg);
        Assert.Equal(WeightReader.Trend, weight.Source);
        Assert.False(weight.GoalReached);
    }

    [Fact]
    public void A_second_weigh_in_moves_the_trend_part_way_and_narrows_the_band()
    {
        var first = AsOf.AddDays(-1);
        var series = TrendWeight.Compute([(first, 80m), (AsOf, 90m)], AsOf);
        Assert.InRange(series.TrendKg!.Value, 82m, 88m);
        Assert.True(series.BandKg < 0.60m);
        Assert.Equal(TrendWeight.Normal, series.TrendState);
        Assert.Equal(2, series.WeighInsInWindow);
        // With hindsight, the first day is pulled towards the second reading too.
        Assert.True(series.On(first)!.TrendKg > 80m);
    }

    [Fact]
    public void A_single_weigh_in_in_the_last_seven_days_is_low_accuracy_and_held_flat()
    {
        var series = TrendWeight.Compute([(AsOf.AddDays(-6), 80m)], AsOf);
        Assert.Equal(80.00m, series.TrendKg);
        Assert.True(series.BandKg > 0.60m);
        Assert.Equal(1, series.WeighInsInWindow);
        Assert.Equal(TrendWeight.LowAccuracy, series.TrendState);
        Assert.Equal(TrendWeight.FewerThanTwoWeighInsInSevenDays, Assert.Single(series.Reasons));
        Assert.False(series.On(AsOf)!.Real);
        Assert.True(series.On(AsOf)!.Estimated);
        Assert.False(series.On(AsOf)!.Measured);
    }

    [Fact]
    public void Days_between_weigh_ins_rise_steadily_and_are_measured_up_to_a_week_apart()
    {
        var day0 = AsOf.AddDays(-3);
        var series = TrendWeight.Compute([(day0, 80m), (AsOf, 83m)], AsOf);
        var trends = Enumerable.Range(0, 4).Select(i => series.On(day0.AddDays(i))!.TrendKg).ToList();
        Assert.Equal(trends.Order(), trends);
        Assert.True(trends[0] > 80m && trends[3] < 83m);
        Assert.All(Enumerable.Range(0, 4), i => Assert.True(series.On(day0.AddDays(i))!.Measured));
        Assert.True(series.On(day0.AddDays(1))!.Estimated);
        Assert.False(series.On(day0.AddDays(1))!.Real);
        Assert.True(series.On(AsOf)!.Real);

        var weekly = TrendWeight.Compute([(AsOf.AddDays(-7), 80m), (AsOf, 80m)], AsOf);
        Assert.True(weekly.On(AsOf.AddDays(-3))!.Measured);
        var sparse = TrendWeight.Compute([(AsOf.AddDays(-8), 80m), (AsOf, 80m)], AsOf);
        Assert.False(sparse.On(AsOf.AddDays(-3))!.Measured);
        Assert.True(sparse.On(AsOf.AddDays(-8))!.Measured);

        // Among daily weigh-ins, the band is widest in the middle of a gap.
        var daily = Enumerable.Range(0, 21).Select(i => (AsOf.AddDays(-49 + i), 80m))
            .Concat(Enumerable.Range(0, 21).Select(i => (AsOf.AddDays(-20 + i), 80m)))
            .ToList();
        var gapped = TrendWeight.Compute(daily, AsOf);
        Assert.True(gapped.On(AsOf.AddDays(-25))!.BandKg > gapped.On(AsOf.AddDays(-37))!.BandKg);
        Assert.False(gapped.On(AsOf.AddDays(-25))!.Measured);
    }

    [Fact]
    public void A_28_day_gap_is_bridged_and_a_29_day_gap_is_a_fresh_start()
    {
        var start = new DateOnly(2026, 9, 1);
        var bridged = TrendWeight.Compute([(start, 80m), (start.AddDays(28), 83m)], start.AddDays(28));
        Assert.Null(bridged.FreshStart);
        Assert.NotEqual(TrendWeight.FreshStartState, bridged.TrendState);
        Assert.InRange(bridged.TrendKg!.Value, 80.01m, 82.99m);
        Assert.True(bridged.On(start.AddDays(14))!.Estimated);
        Assert.False(bridged.On(start.AddDays(14))!.Gap);
        Assert.False(bridged.On(start.AddDays(14))!.Measured);

        var resetDay = start.AddDays(29);
        var reset = TrendWeight.Compute([(start, 80m), (resetDay, 83m)], resetDay);
        Assert.Equal(83.00m, reset.TrendKg);
        Assert.Equal(0.60m, reset.BandKg);
        Assert.Equal(TrendWeight.FreshStartState, reset.TrendState);
        Assert.Equal(TrendWeight.FewerThanTwoWeighInsInSevenDays, Assert.Single(reset.Reasons));
        Assert.NotNull(reset.FreshStart);
        Assert.Equal(29, reset.FreshStart!.DaysSincePrevious);
        Assert.Equal(4, reset.FreshStart.WeeksSincePrevious);
        Assert.Equal(start, reset.FreshStart.PreviousDate);
        Assert.Equal(80.00m, reset.On(resetDay.AddDays(-1))!.TrendKg);
        Assert.True(reset.On(resetDay)!.Real);
        Assert.True(reset.On(resetDay.AddDays(-1))!.Gap);
        Assert.False(reset.On(resetDay)!.Gap);
    }

    [Fact]
    public void Days_after_the_last_weigh_in_hold_the_trend_and_widen_the_band()
    {
        var series = TrendWeight.Compute(
            [(AsOf.AddDays(-8), 80m), (AsOf.AddDays(-7), 81m)],
            AsOf);
        var last = series.On(AsOf.AddDays(-7))!;
        Assert.Equal(last.TrendKg, series.TrendKg);
        Assert.True(series.BandKg > last.BandKg);
        Assert.True(series.On(AsOf)!.Estimated);
        Assert.False(series.On(AsOf.AddDays(-1))!.Measured);
        Assert.Equal(TrendWeight.LowAccuracy, series.TrendState);
    }

    [Fact]
    public void A_steady_loss_is_followed_closely_with_its_rate()
    {
        // 1 kg a week, weighed daily with ±0.3 kg of scale noise. The old 10% smoothing lagged about 1.3 kg.
        var start = AsOf.AddDays(-55);
        var noise = new[] { 0.3m, -0.2m, 0.1m, -0.3m, 0.2m, 0m, -0.1m };
        var rows = Enumerable.Range(0, 56)
            .Select(i => (start.AddDays(i), 90m - i / 7m + noise[i % 7]))
            .ToList();
        var series = TrendWeight.Compute(rows, AsOf);
        var truth = 90m - 55 / 7m;
        Assert.InRange(series.TrendKg!.Value, truth - 0.3m, truth + 0.3m);
        Assert.InRange(series.RateKgPerWeek!.Value, -1.2m, -0.8m);
        Assert.True(series.BandKg < 0.25m);
    }

    [Fact]
    public void One_odd_weigh_in_barely_moves_the_trend()
    {
        var steady = Enumerable.Range(0, 21).Select(i => (AsOf.AddDays(-21 + i), 80m)).ToList();
        var before = TrendWeight.Compute(steady, AsOf.AddDays(-1)).TrendKg!.Value;
        var after = TrendWeight.Compute([.. steady, (AsOf, 82m)], AsOf).TrendKg!.Value;
        Assert.InRange(after - before, 0.05m, 0.4m);
    }

    [Fact]
    public void Rate_needs_four_weigh_ins_over_two_weeks_since_the_last_fresh_start()
    {
        Assert.Null(TrendWeight.Compute([(AsOf.AddDays(-14), 82m), (AsOf.AddDays(-7), 81m), (AsOf, 80m)], AsOf).RateKgPerWeek);
        Assert.Null(TrendWeight.Compute([(AsOf.AddDays(-13), 82m), (AsOf.AddDays(-9), 81.5m), (AsOf.AddDays(-5), 81m), (AsOf, 80m)], AsOf).RateKgPerWeek);
        var weekly = TrendWeight.Compute(
            [(AsOf.AddDays(-21), 83m), (AsOf.AddDays(-14), 82m), (AsOf.AddDays(-7), 81m), (AsOf, 80m)],
            AsOf);
        Assert.True(weekly.RateKgPerWeek < 0m);

        var restarted = TrendWeight.Compute(
            [(AsOf.AddDays(-80), 90m), (AsOf.AddDays(-73), 89m), (AsOf.AddDays(-66), 88m), (AsOf.AddDays(-59), 87m), (AsOf, 80m)],
            AsOf);
        Assert.NotNull(restarted.FreshStart);
        Assert.Null(restarted.RateKgPerWeek);
    }

    [Fact]
    public void Daily_weigh_ins_give_a_narrower_band_than_weekly_ones()
    {
        var daily = TrendWeight.Compute(Enumerable.Range(0, 28).Select(i => (AsOf.AddDays(-27 + i), 80m)).ToList(), AsOf);
        var weekly = TrendWeight.Compute(Enumerable.Range(0, 5).Select(i => (AsOf.AddDays(-28 + i * 7), 80m)).ToList(), AsOf);
        Assert.True(daily.BandKg < weekly.BandKg);
        Assert.Equal(80.00m, daily.TrendKg);
    }

    [Fact]
    public void A_28_day_gap_keeps_older_history_and_a_29_day_gap_drops_it()
    {
        var recent = new List<(DateOnly, decimal)>
        {
            (AsOf.AddDays(-2), 80m),
            (AsOf.AddDays(-1), 80m),
            (AsOf, 90m),
        };
        var twentyEightDaysBack = new List<(DateOnly, decimal)>
        {
            (AsOf.AddDays(-30), 60m),
            (AsOf.AddDays(-2), 80m),
            (AsOf.AddDays(-1), 80m),
            (AsOf, 90m),
        };
        var twentyNineDaysBack = new List<(DateOnly, decimal)>
        {
            (AsOf.AddDays(-31), 60m),
            (AsOf.AddDays(-2), 80m),
            (AsOf.AddDays(-1), 80m),
            (AsOf, 90m),
        };

        Assert.NotEqual(
            TrendWeight.Compute(recent, AsOf).TrendKg,
            TrendWeight.Compute(twentyEightDaysBack, AsOf).TrendKg);
        Assert.Equal(
            TrendWeight.Compute(recent, AsOf).TrendKg,
            TrendWeight.Compute(twentyNineDaysBack, AsOf).TrendKg);
        Assert.Equal(TrendWeight.Normal, TrendWeight.Compute(twentyNineDaysBack, AsOf).TrendState);
    }

    [Fact]
    public void Deleting_a_weigh_in_from_the_series_matches_never_having_entered_it()
    {
        var day0 = AsOf.AddDays(-3);
        var without = TrendWeight.Compute([(day0, 80m), (AsOf, 83m)], AsOf);
        var with = TrendWeight.Compute([(day0, 80m), (day0.AddDays(1), 90m), (AsOf, 83m)], AsOf);
        Assert.NotEqual(without.TrendKg, with.TrendKg);

        var removed = with.Days
            .Where(day => day.Real && day.Date != day0.AddDays(1))
            .Select(day => (day.Date, day.WeighInKg!.Value))
            .ToList();
        var again = TrendWeight.Compute(removed, AsOf);
        Assert.Equal(without.TrendKg, again.TrendKg);
        Assert.Equal(without.Days.Select(day => day.TrendKg), again.Days.Select(day => day.TrendKg));
    }

    [Fact]
    public void Today_never_uses_hindsight_a_later_weigh_in_would_add()
    {
        var rows = new List<(DateOnly, decimal)> { (AsOf.AddDays(-4), 80m), (AsOf.AddDays(-2), 81m), (AsOf, 79m) };
        var then = TrendWeight.Compute(rows, AsOf.AddDays(-2));
        var now = TrendWeight.Compute(rows, AsOf);
        Assert.Equal(then.TrendKg, then.On(AsOf.AddDays(-2))!.TrendKg);
        // The past day is smoothed again once a later weigh-in exists.
        Assert.NotEqual(then.TrendKg, now.On(AsOf.AddDays(-2))!.TrendKg);
    }

    [Fact]
    public void Goal_reached_uses_lose_and_gain_for_rate_mode_and_manual_mode()
    {
        // Judged on the latest real weigh-in, and only on that weigh-in's own day
        // (decision 35.10). A later day that only carries the trend does not ask.
        var day = TrendWeight.Compute([(AsOf, 83.6m)], AsOf);
        Assert.True(TrendWeight.GoalReached(Goals.Lose, 84m, day));
        Assert.True(TrendWeight.GoalReached(Goals.Lose, 83.6m, day));
        Assert.False(TrendWeight.GoalReached(Goals.Lose, 80m, day));
        Assert.True(TrendWeight.GoalReached(Goals.Gain, 80m, day));
        Assert.True(TrendWeight.GoalReached(Goals.Gain, 83.6m, day));
        Assert.False(TrendWeight.GoalReached(Goals.Gain, 90m, day));
        Assert.False(TrendWeight.GoalReached(Goals.Maintain, 83.6m, day));
        Assert.False(TrendWeight.GoalReached(null, 80m, day));

        var carried = TrendWeight.Compute([(AsOf.AddDays(-1), 83.6m)], AsOf);
        Assert.False(carried.On(AsOf)!.Real);
        Assert.False(TrendWeight.GoalReached(Goals.Lose, 84m, carried));
        Assert.False(TrendWeight.GoalReached(Goals.Gain, 80m, carried));

        var beforeAny = TrendWeight.Compute([(AsOf, 83.6m)], AsOf.AddDays(-1));
        Assert.False(TrendWeight.GoalReached(Goals.Lose, 84m, beforeAny));

        var latest = TrendWeight.Compute([(AsOf.AddDays(-3), 80m), (AsOf, 83m)], AsOf);
        Assert.True(TrendWeight.GoalReached(Goals.Gain, 80.5m, latest));
        Assert.False(TrendWeight.GoalReached(Goals.Gain, 80.5m, TrendWeight.Compute([(AsOf.AddDays(-3), 80m)], AsOf)));
    }

    [Fact]
    public void No_weigh_ins_leave_the_trend_empty()
    {
        var series = TrendWeight.Compute([], AsOf);
        Assert.Null(series.TrendKg);
        Assert.Null(series.BandKg);
        Assert.Null(series.RateKgPerWeek);
        Assert.Null(series.TrendState);
        Assert.Empty(series.Reasons);
        var none = WeightReader.FromSeries(series, setupKg: null, goal: null, goalWeightKg: 0, freshStartAccepted: false);
        Assert.Equal(WeightReader.None, none.Source);
        var setup = WeightReader.FromSeries(series, setupKg: 85m, goal: null, goalWeightKg: 0, freshStartAccepted: false);
        Assert.Equal(WeightReader.Setup, setup.Source);
        Assert.Equal(85m, setup.UsedKg);
    }

    private static readonly decimal[] PrototypeWeights =
    [
        85.0m, 84.7m, 85.1m, 84.8m, 84.9m, 84.6m,
        84.8m, 84.6m, 84.9m, 84.4m, 84.7m, 84.5m, 84.2m, 84.5m, 84.1m, 84.3m, 84.0m, 83.9m, 84.1m, 84.3m, 83.8m,
        83.8m, 84.0m, 84.2m, 83.8m, 83.6m, 84.0m, 83.3m, 83.8m, 83.3m, 83.2m, 83.1m, 83.2m, 83.4m, 82.9m, 83.3m,
    ];
}
