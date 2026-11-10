using GymBro.Api.Progress;

namespace GymBro.Api.Tests;

public sealed class ProgressMathTests
{
    private static readonly DateOnly Today = new(2026, 11, 10);

    [Fact]
    public void Ranges_are_inclusive_windows_and_all_starts_at_the_first_stored_day()
    {
        Assert.Equal(new DateOnly(2026, 11, 4), ProgressMath.WindowStart(Today, "7d", null));
        Assert.Equal(new DateOnly(2026, 10, 12), ProgressMath.WindowStart(Today, "30d", null));
        Assert.Equal(new DateOnly(2026, 8, 13), ProgressMath.WindowStart(Today, "90d", null));
        var sixMonths = ProgressMath.WindowStart(Today, "6m", null);
        Assert.Equal(ProgressMath.SixMonthsDays, Today.DayNumber - sixMonths.DayNumber + 1);
        Assert.Equal(new DateOnly(2026, 5, 13), sixMonths);
        Assert.Equal(new DateOnly(2026, 1, 2), ProgressMath.WindowStart(Today, "all", new DateOnly(2026, 1, 2)));
        Assert.Equal(Today, ProgressMath.WindowStart(Today, "all", null));
        Assert.Equal(Today, ProgressMath.WindowStart(Today, "all", Today.AddDays(3)));
    }

    [Fact]
    public void Averages_ignore_a_zero_count_and_round_half_away_from_zero()
    {
        Assert.Null(ProgressMath.Average(10, 0, 0));
        Assert.Equal(101m, ProgressMath.Average(201, 2, 0));
        Assert.Equal(10.5m, ProgressMath.Average(21, 2, 1));
    }

    [Fact]
    public void Change_needs_two_weigh_ins()
    {
        Assert.Null(ProgressMath.Change([]));
        Assert.Null(ProgressMath.Change([83.6m]));
        Assert.Equal(-0.5m, ProgressMath.Change([84.1m, 83.6m]));
    }

    [Fact]
    public void A_target_does_not_apply_before_it_was_saved()
    {
        var rows = new List<(DateOnly, int, int)> { (new DateOnly(2026, 11, 8), 2200, 160) };
        Assert.Null(ProgressMath.TargetAt(rows, new DateOnly(2026, 11, 7)));
        Assert.Equal((2200, 160), ProgressMath.TargetAt(rows, new DateOnly(2026, 11, 8)));
        Assert.Equal((2200, 160), ProgressMath.TargetAt(rows, new DateOnly(2026, 11, 10)));
    }

    [Theory]
    [InlineData(null, "30d")]
    [InlineData(" 7D ", "7d")]
    [InlineData("all", "all")]
    [InlineData(" 6M ", "6m")]
    public void Known_ranges_are_accepted(string? raw, string normalized)
    {
        Assert.True(ProgressMath.TryRange(raw, out var value));
        Assert.Equal(normalized, value);
    }

    [Fact]
    public void An_unknown_range_is_rejected()
    {
        Assert.False(ProgressMath.TryRange("week", out _));
    }
}
