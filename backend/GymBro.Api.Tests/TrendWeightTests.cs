using GymBro.Api.Nutrition;
using GymBro.Api.Profiles;

namespace GymBro.Api.Tests;

public sealed class TrendWeightTests
{
    private static readonly DateOnly AsOf = new(2026, 10, 24);

    [Fact]
    public void Smoothing_share_is_ten_percent()
    {
        Assert.Equal(0.10m, TrendWeight.SmoothingShare);
        Assert.Equal(3, TrendWeight.MinimumWeighIns);
        Assert.Equal(7, TrendWeight.WindowDays);
    }

    [Fact]
    public void Smoothing_still_runs_when_fewer_than_three_weigh_ins_are_recent()
    {
        var two = new List<(DateOnly, decimal)>
        {
            (AsOf.AddDays(-2), 80m),
            (AsOf.AddDays(-1), 81m),
        };
        Assert.Equal(2, TrendWeight.CountInWindow(two, AsOf));
        Assert.False(TrendWeight.IsShown(TrendWeight.CountInWindow(two, AsOf)));
        Assert.Equal(80.10m, TrendWeight.Compute(two, AsOf));

        var older = new List<(DateOnly, decimal)>
        {
            (AsOf.AddDays(-20), 70m),
            (AsOf.AddDays(-10), 71m),
            (AsOf.AddDays(-7), 72m),
            (AsOf.AddDays(-6), 73m),
            (AsOf, 74m),
        };
        Assert.Equal(2, TrendWeight.CountInWindow(older, AsOf));
        Assert.False(TrendWeight.IsShown(TrendWeight.CountInWindow(older, AsOf)));
        Assert.NotNull(TrendWeight.Compute(older, AsOf));
    }

    [Fact]
    public void Targets_use_the_trend_from_two_weigh_ins_and_hide_it_until_three_in_seven_days()
    {
        var two = new List<(DateOnly, decimal)>
        {
            (AsOf.AddDays(-2), 80m),
            (AsOf.AddDays(-1), 90m),
        };
        var hidden = WeightReader.Choose(two, AsOf, setupKg: 70m);
        Assert.False(hidden.TrendVisible);
        Assert.Null(hidden.TrendKg);
        Assert.Equal(81.00m, hidden.UsedKg);
        Assert.Equal(WeightReader.Trend, hidden.Source);

        var one = new List<(DateOnly, decimal)> { (AsOf, 83.6m) };
        var raw = WeightReader.Choose(one, AsOf, setupKg: 70m);
        Assert.False(raw.TrendVisible);
        Assert.Equal(83.6m, raw.UsedKg);
        Assert.Equal(WeightReader.WeighIn, raw.Source);

        var none = WeightReader.Choose([], AsOf, setupKg: 85.0m);
        Assert.Equal(85.0m, none.UsedKg);
        Assert.Equal(WeightReader.Setup, none.Source);
        Assert.Equal(WeightReader.None, WeightReader.Choose([], AsOf, setupKg: null).Source);
    }

    [Fact]
    public void Each_weigh_in_moves_a_fixed_share_towards_it()
    {
        var series = new List<(DateOnly, decimal)>
        {
            (AsOf.AddDays(-2), 70m),
            (AsOf.AddDays(-1), 80m),
            (AsOf, 90m),
        };

        var expected = 70m;
        expected += TrendWeight.SmoothingShare * (80m - expected);
        expected += TrendWeight.SmoothingShare * (90m - expected);
        expected = decimal.Round(expected, 1, MidpointRounding.AwayFromZero);

        Assert.Equal(72.9m, expected);
        Assert.Equal(expected, TrendWeight.Compute(series, AsOf));
    }

    [Fact]
    public void Older_weigh_ins_still_affect_the_trend_once_the_window_is_full()
    {
        var recent = new List<(DateOnly, decimal)>
        {
            (AsOf.AddDays(-2), 80m),
            (AsOf.AddDays(-1), 80m),
            (AsOf, 90m),
        };
        var withHistory = new List<(DateOnly, decimal)>
        {
            (AsOf.AddDays(-30), 60m),
            (AsOf.AddDays(-2), 80m),
            (AsOf.AddDays(-1), 80m),
            (AsOf, 90m),
        };

        Assert.Equal(81.0m, TrendWeight.Compute(recent, AsOf));
        Assert.NotEqual(TrendWeight.Compute(recent, AsOf), TrendWeight.Compute(withHistory, AsOf));
        Assert.Equal(3, TrendWeight.CountInWindow(withHistory, AsOf));
    }

    [Fact]
    public void A_gap_does_not_add_a_step_for_the_missing_day()
    {
        var series = new List<(DateOnly, decimal)>
        {
            (AsOf.AddDays(-4), 80m),
            (AsOf.AddDays(-1), 90m),
            (AsOf, 90m),
        };

        // 80, then one step to 81, then one step to 81.9. The two days
        // with no weigh-in are not extra 10% steps.
        Assert.Equal(81.90m, TrendWeight.Compute(series, AsOf));
    }

    [Fact]
    public void Prototype_demo_weigh_ins_trend_to_83_60_and_the_worked_example_targets()
    {
        // Fictional morning series from the design prototype (seed.ts WEIGHTS):
        // 36 days, 19 Sep–24 Oct 2026. The trend starts at the first weigh-in
        // and moves 10 percent toward each later one. The last day is 83.60 kg.
        var start = new DateOnly(2026, 9, 19);
        var series = PrototypeWeights.Select((kg, index) => (start.AddDays(index), kg)).ToList();
        var asOf = new DateOnly(2026, 10, 24);

        Assert.Equal(36, series.Count);
        Assert.Equal(start, series[0].Item1);
        Assert.Equal(asOf, series[^1].Item1);
        Assert.Equal(85.0m, series[0].Item2);
        Assert.Equal(83.3m, series[^1].Item2);

        var trend = TrendWeight.Compute(series, asOf);
        Assert.Equal(83.60m, trend);

        var targets = NutritionMath.Calculate(new NutritionInput(
            Sexes.Male,
            trend!.Value,
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

    private static readonly decimal[] PrototypeWeights =
    [
        85.0m, 84.7m, 85.1m, 84.8m, 84.9m, 84.6m,
        84.8m, 84.6m, 84.9m, 84.4m, 84.7m, 84.5m, 84.2m, 84.5m, 84.1m, 84.3m, 84.0m, 83.9m, 84.1m, 84.3m, 83.8m,
        83.8m, 84.0m, 84.2m, 83.8m, 83.6m, 84.0m, 83.3m, 83.8m, 83.3m, 83.2m, 83.1m, 83.2m, 83.4m, 82.9m, 83.3m,
    ];
}
