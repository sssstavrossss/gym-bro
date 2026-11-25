using GymBro.Api.Nutrition;
using GymBro.Api.Progress;

namespace GymBro.Api.Tests;

public sealed class BurnSeriesTests
{
    private static readonly DateOnly Setup = new(2026, 10, 1);

    private static BurnRow Row(DateOnly date, int tdee, int formula, int sd, params string[] reasons) =>
        new(date, 1766, tdee, formula, sd, reasons);

    [Fact]
    public void A_day_before_the_first_target_has_no_burn()
    {
        var rows = new[] { Row(Setup, 2430, 2430, 350, "profile_change") };
        Assert.Null(BurnSeries.At(rows, Setup.AddDays(-1)));
        Assert.Null(BurnSeries.At([], Setup));
    }

    [Fact]
    public void The_formula_burn_stays_at_its_own_spread()
    {
        var rows = new[] { Row(Setup, 2430, 2430, 350, "profile_change") };
        var day = BurnSeries.At(rows, Setup.AddDays(40))!;
        Assert.Equal(new BurnDay(2430, 1766, 350, false, Setup), day);
    }

    [Fact]
    public void A_measured_burn_grows_less_sure_each_week_from_the_recalculation_up_to_the_formula_spread()
    {
        var measured = new DateOnly(2026, 11, 23);
        var rows = new[]
        {
            Row(Setup, 2430, 2430, 350, "profile_change"),
            Row(measured, 2806, 2434, 244, RecalculationReasons.Adaptive),
        };
        var on = BurnSeries.At(rows, measured)!;
        Assert.Equal(2806, on.Kcal);
        Assert.Equal(244, on.SdKcal);
        Assert.True(on.Measured);
        Assert.Equal(measured, on.SetOn);
        // Two weeks on: √(244² + 60²·2) ≈ 258.
        Assert.Equal(258, BurnSeries.At(rows, measured.AddDays(14))!.SdKcal);
        Assert.Equal((int)BurnEstimate.FormulaSdKcal, BurnSeries.At(rows, measured.AddDays(7 * 60))!.SdKcal);
        // The day before, the formula row is still in effect.
        Assert.False(BurnSeries.At(rows, measured.AddDays(-1))!.Measured);
    }

    [Fact]
    public void A_profile_edit_keeps_counting_from_the_recalculation()
    {
        var measured = new DateOnly(2026, 11, 2);
        var edit = new DateOnly(2026, 11, 9);
        var rows = new[]
        {
            Row(Setup, 2430, 2430, 350, "profile_change"),
            Row(measured, 2806, 2434, 244, RecalculationReasons.Adaptive),
            Row(edit, 2790, 2418, 244, "profile_change"),
        };
        var day = BurnSeries.At(rows, edit.AddDays(7))!;
        Assert.Equal(2790, day.Kcal);
        Assert.Equal(measured, day.SetOn);
        Assert.Equal((int)Math.Round(Math.Sqrt(244 * 244 + 60 * 60 * 2)), day.SdKcal);
    }

    [Fact]
    public void SpreadAfter_matches_the_drift_Step_applies_before_measuring()
    {
        var step = BurnEstimate.Step(2500m, 200m, 3m, 2600m, 100m);
        Assert.Equal(step.PriorSd, BurnEstimate.SpreadAfter(200m, 3m));
        Assert.Equal(200m, BurnEstimate.SpreadAfter(200m, -1m));
        Assert.Equal(BurnEstimate.FormulaSdKcal, BurnEstimate.SpreadAfter(340m, 52m));
    }
}
