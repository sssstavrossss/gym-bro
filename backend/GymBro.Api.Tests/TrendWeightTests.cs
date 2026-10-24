using GymBro.Api.Nutrition;
using GymBro.Api.Profiles;

namespace GymBro.Api.Tests;

public sealed class TrendWeightTests
{
    private static readonly DateOnly AsOf = new(2026, 10, 24);

    [Fact]
    public void Smoothing_share_is_ten_percent_and_low_accuracy_starts_below_two_weigh_ins()
    {
        Assert.Equal(0.10m, TrendWeight.SmoothingShare);
        Assert.Equal(7, TrendWeight.WindowDays);
        Assert.Equal(2, TrendWeight.LowAccuracyBelow);
        Assert.Equal(28, TrendWeight.MaxInterpolatedGapDays);
        Assert.Equal(3.0m, TrendWeight.TypoLimitKg);
    }

    [Fact]
    public void Prototype_36_day_dataset_still_gives_trend_83_60_and_2218_kcal()
    {
        var start = new DateOnly(2026, 9, 19);
        var series = PrototypeWeights.Select((kg, index) => (start.AddDays(index), kg)).ToList();
        var asOf = new DateOnly(2026, 10, 24);

        Assert.Equal(36, series.Count);
        Assert.Equal(start, series[0].Item1);
        Assert.Equal(asOf, series[^1].Item1);
        Assert.Equal(85.0m, series[0].Item2);
        Assert.Equal(83.3m, series[^1].Item2);

        var trend = TrendWeight.Compute(series, asOf);
        Assert.Equal(TrendWeight.Normal, trend.TrendState);
        Assert.Empty(trend.Reasons);
        Assert.Equal(83.60m, trend.TrendKg);

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
        Assert.Equal(1786, targets.Bmr);
        Assert.Equal(2768, targets.Tdee);
        Assert.Equal(2218, targets.Kcal);
        Assert.Equal(167, targets.Protein);
        Assert.Equal(62, targets.Fat);
        Assert.Equal(249, targets.Carbs);
    }

    [Fact]
    public void Setup_weight_is_the_trend_that_day_and_is_low_accuracy()
    {
        var series = TrendWeight.Compute([(AsOf, 83.6m)], AsOf);
        Assert.Equal(83.60m, series.TrendKg);
        Assert.Equal(TrendWeight.LowAccuracy, series.TrendState);
        Assert.Equal([TrendWeight.FewerThanTwoWeighInsInSevenDays], series.Reasons);
        Assert.True(series.On(AsOf)!.Real);
        Assert.False(series.On(AsOf)!.Estimated);

        var weight = WeightReader.FromSeries(series, setupKg: null, Goals.Lose, 80m, freshStartAccepted: false);
        Assert.Equal(83.60m, weight.UsedKg);
        Assert.Equal(WeightReader.Trend, weight.Source);
        Assert.False(weight.GoalReached);
    }

    [Fact]
    public void Consecutive_weigh_ins_80_then_90_land_on_81_with_a_normal_trend()
    {
        var first = AsOf.AddDays(-1);
        var series = TrendWeight.Compute([(first, 80m), (AsOf, 90m)], AsOf);
        Assert.Equal(80.00m, series.On(first)!.TrendKg);
        Assert.Equal(81.00m, series.TrendKg);
        Assert.Equal(TrendWeight.Normal, series.TrendState);
        Assert.Empty(series.Reasons);
        Assert.Equal(2, series.WeighInsInWindow);
    }

    [Fact]
    public void A_single_weigh_in_in_the_last_seven_days_is_low_accuracy()
    {
        var series = TrendWeight.Compute([(AsOf.AddDays(-6), 80m)], AsOf);
        Assert.Equal(80.00m, series.TrendKg);
        Assert.Equal(1, series.WeighInsInWindow);
        Assert.Equal(TrendWeight.LowAccuracy, series.TrendState);
        Assert.Equal(TrendWeight.FewerThanTwoWeighInsInSevenDays, Assert.Single(series.Reasons));
        Assert.False(series.On(AsOf)!.Real);
        Assert.True(series.On(AsOf)!.Estimated);
    }

    [Fact]
    public void Three_day_gap_interpolates_to_80_10_then_80_29_then_80_56()
    {
        var day0 = AsOf.AddDays(-3);
        var series = TrendWeight.Compute([(day0, 80m), (AsOf, 83m)], AsOf);
        var day1 = series.On(day0.AddDays(1))!;
        var day2 = series.On(day0.AddDays(2))!;
        var day3 = series.On(AsOf)!;

        Assert.Equal(81m, day1.ReadingKg);
        Assert.Equal(82m, day2.ReadingKg);
        Assert.Equal(83m, day3.ReadingKg);
        Assert.Equal(80.10m, day1.TrendKg);
        Assert.Equal(80.29m, day2.TrendKg);
        Assert.Equal(80.56m, day3.TrendKg);
        Assert.False(day1.Real);
        Assert.True(day1.Estimated);
        Assert.False(day2.Real);
        Assert.True(day3.Real);
        Assert.False(day3.Estimated);
    }

    [Fact]
    public void A_28_day_gap_is_interpolated_and_a_29_day_gap_is_a_fresh_start()
    {
        var start = new DateOnly(2026, 9, 1);
        var interpolated = TrendWeight.Compute([(start, 80m), (start.AddDays(28), 83m)], start.AddDays(28));
        Assert.Null(interpolated.FreshStart);
        Assert.NotEqual(TrendWeight.FreshStartState, interpolated.TrendState);
        Assert.NotEqual(83.00m, interpolated.TrendKg);
        Assert.InRange(interpolated.TrendKg!.Value, 80.01m, 82.99m);
        Assert.True(interpolated.On(start.AddDays(14))!.Estimated);
        Assert.False(interpolated.On(start.AddDays(14))!.Real);

        var resetDay = start.AddDays(29);
        var reset = TrendWeight.Compute([(start, 80m), (resetDay, 83m)], resetDay);
        Assert.Equal(83.00m, reset.TrendKg);
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
        Assert.False(interpolated.On(start.AddDays(14))!.Gap);
    }

    [Fact]
    public void A_day_after_the_last_weigh_in_keeps_the_previous_trend()
    {
        var series = TrendWeight.Compute(
            [(AsOf.AddDays(-2), 80m), (AsOf.AddDays(-1), 81m)],
            AsOf);
        Assert.Equal(80.10m, series.TrendKg);
        Assert.True(series.On(AsOf)!.Estimated);
        Assert.Equal(TrendWeight.Normal, series.TrendState);
    }

    [Fact]
    public void Each_consecutive_weigh_in_moves_ten_percent_towards_it()
    {
        var series = TrendWeight.Compute(
            [(AsOf.AddDays(-2), 70m), (AsOf.AddDays(-1), 80m), (AsOf, 90m)],
            AsOf);
        Assert.Equal(72.90m, series.TrendKg);
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

        Assert.Equal(81.00m, TrendWeight.Compute(recent, AsOf).TrendKg);
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
    public void Goal_reached_uses_lose_and_gain_for_rate_mode_and_manual_mode()
    {
        // Judged on the latest real weigh-in, including a later day that only carries
        // that trend. An estimate between weigh-ins is not compared on its own.
        // Manual mode is not a saved field yet; it uses the same lose or gain direction.
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
        Assert.True(TrendWeight.GoalReached(Goals.Lose, 84m, carried));
        Assert.True(TrendWeight.GoalReached(Goals.Gain, 80m, carried));

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
        Assert.Null(series.TrendState);
        Assert.Empty(series.Reasons);
        var none = WeightReader.FromSeries(series, setupKg: null, goal: null, goalWeightKg: 0, freshStartAccepted: false);
        Assert.Equal(WeightReader.None, none.Source);
        var setup = WeightReader.FromSeries(series, setupKg: 85m, goal: null, goalWeightKg: 0, freshStartAccepted: false);
        Assert.Equal(WeightReader.Setup, setup.Source);
        Assert.Equal(85m, setup.UsedKg);
    }

    [Fact]
    public void Prototype_trend_script_fixtures_match_the_published_series()
    {
        // Same cases as prototype/scripts/unit-trend.mjs. Published values are
        // rounded to 2 places; the script's toFixed(2) checks are the same numbers.
        var end = new DateOnly(2026, 10, 24);
        var weights = new List<(DateOnly Date, decimal Kg)>();
        for (var i = 0; i < PrototypeWeights.Length; i++)
        {
            weights.Add((new DateOnly(2026, 9, 19).AddDays(i), PrototypeWeights[i]));
        }

        Assert.Equal(83.60m, TrendWeight.Compute(weights, end).TrendKg);

        var two = TrendWeight.Compute([(new DateOnly(2026, 10, 23), 80m), (end, 90m)], end);
        Assert.Equal(81.00m, two.TrendKg);
        Assert.Equal(TrendWeight.Normal, two.TrendState);

        var one = TrendWeight.Compute([(new DateOnly(2026, 10, 10), 80m), (end, 81m)], end);
        Assert.Equal(TrendWeight.LowAccuracy, one.TrendState);
        Assert.Contains(TrendWeight.FewerThanTwoWeighInsInSevenDays, one.Reasons);

        var setup = TrendWeight.Compute([(end, 84m)], end);
        Assert.Equal(84m, setup.TrendKg);
        Assert.Equal(TrendWeight.LowAccuracy, setup.TrendState);

        var gap = TrendWeight.Compute([(new DateOnly(2026, 10, 1), 80m), (new DateOnly(2026, 10, 4), 83m)], new DateOnly(2026, 10, 4));
        Assert.Equal(80.10m, gap.On(new DateOnly(2026, 10, 2))!.TrendKg);
        Assert.Equal(80.29m, gap.On(new DateOnly(2026, 10, 3))!.TrendKg);
        Assert.Equal(80.56m, gap.On(new DateOnly(2026, 10, 4))!.TrendKg);

        var held = TrendWeight.Compute([(new DateOnly(2026, 9, 26), 80m), (end, 84m)], end);
        Assert.NotEqual(84m, held.TrendKg);
        Assert.NotEqual(TrendWeight.FreshStartState, held.TrendState);
        var reset = TrendWeight.Compute([(new DateOnly(2026, 9, 25), 80m), (end, 84m)], end);
        Assert.Equal(84m, reset.TrendKg);
        Assert.Equal(TrendWeight.FreshStartState, reset.TrendState);
        Assert.Equal(29, reset.FreshStart!.DaysSincePrevious);

        var withoutLast = weights.Where(row => row.Date != end).ToList();
        var reference = TrendWeight.Compute(withoutLast, end.AddDays(-1)).TrendKg!.Value;
        Assert.True(Math.Abs(38.6m - reference) > TrendWeight.TypoLimitKg);
        Assert.True(Math.Abs(86.5m - reference) <= TrendWeight.TypoLimitKg);
        Assert.True(Math.Abs(86.7m - reference) > TrendWeight.TypoLimitKg);
        Assert.Null(TrendWeight.Compute([], end.AddDays(-1)).TrendKg);

        var deleted = weights.Where(row => row.Date != new DateOnly(2026, 10, 15)).ToList();
        Assert.NotEqual(TrendWeight.Compute(weights, end).TrendKg, TrendWeight.Compute(deleted, end).TrendKg);

        var back = TrendWeight.Compute([(new DateOnly(2026, 10, 1), 80m), (new DateOnly(2026, 10, 10), 82m)], end);
        var filled = TrendWeight.Compute(
            [(new DateOnly(2026, 10, 1), 80m), (new DateOnly(2026, 10, 5), 79m), (new DateOnly(2026, 10, 10), 82m)],
            end);
        Assert.NotEqual(back.TrendKg, filled.TrendKg);
    }

    private static readonly decimal[] PrototypeWeights =
    [
        85.0m, 84.7m, 85.1m, 84.8m, 84.9m, 84.6m,
        84.8m, 84.6m, 84.9m, 84.4m, 84.7m, 84.5m, 84.2m, 84.5m, 84.1m, 84.3m, 84.0m, 83.9m, 84.1m, 84.3m, 83.8m,
        83.8m, 84.0m, 84.2m, 83.8m, 83.6m, 84.0m, 83.3m, 83.8m, 83.3m, 83.2m, 83.1m, 83.2m, 83.4m, 82.9m, 83.3m,
    ];
}
