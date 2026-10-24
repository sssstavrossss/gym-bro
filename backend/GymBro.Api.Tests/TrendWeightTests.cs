using GymBro.Api.Nutrition;

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
    public void Returns_nothing_until_three_weigh_ins_in_seven_days()
    {
        var two = new List<(DateOnly, decimal)>
        {
            (AsOf.AddDays(-2), 80m),
            (AsOf.AddDays(-1), 81m),
        };
        Assert.Null(TrendWeight.Compute(two, AsOf));

        var older = new List<(DateOnly, decimal)>
        {
            (AsOf.AddDays(-20), 70m),
            (AsOf.AddDays(-10), 71m),
            (AsOf.AddDays(-7), 72m),
            (AsOf.AddDays(-6), 73m),
            (AsOf, 74m),
        };
        Assert.Equal(2, TrendWeight.CountInWindow(older, AsOf));
        Assert.Null(TrendWeight.Compute(older, AsOf));
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
    public void Prototype_demo_weigh_ins_trend_to_about_83_97()
    {
        // Fictional morning series from the design prototype (seed.ts WEIGHTS),
        // 19 Sep–24 Oct 2026, one weigh-in a day. The prototype starts the trend
        // at the first weigh-in, then applies the share to each later one.
        // Its own alpha is 0.25 so that demo lands near 83.6. At 10% the same
        // recurrence is 83.9676… kg, published as 83.97.
        var start = new DateOnly(2026, 9, 19);
        var series = PrototypeWeights.Select((kg, index) => (start.AddDays(index), kg)).ToList();

        Assert.Equal(new DateOnly(2026, 10, 24), series[^1].Item1);
        Assert.Equal(83.97m, TrendWeight.Compute(series, new DateOnly(2026, 10, 24)));
    }

    private static readonly decimal[] PrototypeWeights =
    [
        85.4m, 85.1m, 85.5m, 85.2m, 85.3m, 85.0m,
        85.2m, 85.0m, 85.3m, 84.8m, 85.1m, 84.9m, 84.6m, 84.9m, 84.5m, 84.7m, 84.4m, 84.3m, 84.5m, 84.7m, 84.2m,
        84.2m, 84.4m, 84.6m, 84.2m, 84.0m, 84.4m, 83.7m, 84.2m, 83.7m, 83.6m, 83.5m, 83.6m, 83.8m, 83.3m, 83.4m,
    ];
}
