using GymBro.Api.Nutrition;
using Xunit.Abstractions;

namespace GymBro.Api.Tests;

public sealed class BurnReadingsTests(ITestOutputHelper output)
{
    private static readonly DateOnly Today = new(2026, 11, 23); // a Monday

    private const int Target = 2500;

    /// <summary>Food for each day before today: <paramref name="kcal"/> picks the day's kcal (null = not logged).</summary>
    private static List<IntakeDay> Food(int count, Func<DateOnly, decimal?> kcal) =>
        Enumerable.Range(1, count).Select(back => Today.AddDays(-back)).Select(date => new IntakeDay(date, kcal(date), Target)).OrderBy(day => day.Date).ToList();

    /// <summary>Weigh-ins on the given days back from today, each the weight energy balance gives with this burn.</summary>
    private static List<(DateOnly, decimal)> Scale(IReadOnlyList<IntakeDay> food, decimal burn, decimal startKg, params int[] daysBack)
    {
        var first = daysBack.Max();
        var rows = new List<(DateOnly, decimal)>();
        foreach (var back in daysBack.OrderByDescending(back => back))
        {
            var date = Today.AddDays(-back);
            var eaten = food.Where(day => day.Date >= Today.AddDays(-first) && day.Date < date).Sum(day => day.Kcal ?? 0m);
            var days = first - back;
            rows.Add((date, startKg + (eaten - burn * days) / NutritionMath.KcalPerKg));
        }

        return rows;
    }

    private static readonly DateOnly Long = Today.AddDays(-200);

    [Fact]
    public void Weekly_weigh_ins_measure_the_burn_and_a_sunday_feast_is_counted_as_food()
    {
        var food = Food(60, date => date.DayOfWeek == DayOfWeek.Sunday ? 3500m : 2000m);
        var weighIns = Scale(food, 2900m, 85m, 28, 21, 14, 7, 0);

        var window = BurnReadings.Measure(Today, Long, weighIns, food, 2900m);

        Assert.Equal(BurnTier.Regular, window.Tier);
        Assert.Equal(5, window.WeighIns);
        Assert.Null(window.Blocked);
        Assert.Equal(2900m, decimal.Round(window.Burn!.Value));
        Assert.Equal(4, window.Readings.Count);
        // Each reading's expected weight is the weight it found: the food explains it all.
        Assert.All(window.Readings, reading => Assert.Equal(decimal.Round(reading.EndKg, 3), decimal.Round(reading.ExpectedKg, 3)));
        Assert.All(window.Readings, reading => Assert.Equal(2900m, decimal.Round(reading.Burn)));
        // Sunday was 140% of target before every Monday: a habit, so the bloat cancels and each stays sure.
        Assert.All(window.Readings, reading => Assert.True(reading.BigDayBefore));
        Assert.All(window.Readings, reading => Assert.True(reading.Sure));
    }

    [Fact]
    public void A_bloated_weigh_in_after_a_big_day_counts_for_less()
    {
        var food = Food(60, date => date == Today.AddDays(-1) ? 3500m : 2200m);
        var clean = Scale(food, 2700m, 85m, 28, 24, 21, 17, 14, 10, 7, 3, 0);
        var bloated = clean.Select(row => row.Item1 == Today ? (row.Item1, row.Item2 + 1m) : row).ToList();
        var plain = food.Select(day => day with { TargetKcal = null }).ToList();

        var careful = BurnReadings.Measure(Today, Long, bloated, food, 2700m);
        var naive = BurnReadings.Measure(Today, Long, bloated, plain, 2700m);

        Assert.True(careful.Readings[^1].BigDayBefore);
        Assert.False(naive.Readings[^1].BigDayBefore);
        Assert.True(Math.Abs(careful.Burn!.Value - 2700m) < Math.Abs(naive.Burn!.Value - 2700m));
        Assert.True(careful.Burn < 2700m);
    }

    [Fact]
    public void Unlogged_days_are_filled_with_the_average_and_make_a_reading_less_sure()
    {
        var food = Food(60, date => date >= Today.AddDays(-7) && date < Today.AddDays(-3) ? null : 2200m);
        var full = Food(60, _ => 2200m);
        var weighIns = Scale(full, 2700m, 85m, 28, 21, 14, 7, 0);

        var window = BurnReadings.Measure(Today, Long, weighIns, food, 2700m);

        Assert.Equal(2700m, decimal.Round(window.Burn!.Value));
        var last = window.Readings[^1];
        Assert.Equal(3m / 7m, last.LoggedShare);
        Assert.False(last.Sure);
        Assert.Equal(7 * 2200m, last.AteKcal);
        Assert.True(window.Readings[0].Sure);
    }

    [Fact]
    public void Fewer_than_four_weigh_ins_in_four_weeks_looks_back_eight_and_moves_less()
    {
        var food = Food(60, _ => 2200m);
        var weighIns = Scale(food, 2700m, 85m, 42, 28, 14, 0);

        var window = BurnReadings.Measure(Today, Long, weighIns, food, 2700m);

        Assert.Equal(BurnTier.Sparse, window.Tier);
        Assert.Equal(Today.AddDays(-56), window.From);
        Assert.Equal(4, window.WeighIns);
        Assert.Equal(2700m, decimal.Round(window.Burn!.Value));
        var step = BurnReadings.Step(3000m, 350m, 7, window);
        Assert.True(step.Capped);
        Assert.Equal(90m, step.Cap);
        Assert.Equal(2910m, step.Burn);
    }

    [Fact]
    public void One_weigh_in_in_eight_weeks_is_not_measured()
    {
        var food = Food(60, _ => 2200m);
        var window = BurnReadings.Measure(Today, Long, [(Today.AddDays(-3), 84m), (Today.AddDays(-70), 86m)], food, 2700m);

        Assert.Equal(BurnTier.Rare, window.Tier);
        Assert.Null(window.Burn);
        Assert.Equal(BurnReadings.NeedWeighIns, window.Blocked);
    }

    [Fact]
    public void Weigh_ins_less_than_a_week_apart_or_too_few_logs_are_not_measured()
    {
        var food = Food(60, _ => 2200m);
        var close = Scale(food, 2700m, 85m, 6, 4, 2, 0);
        Assert.Equal(BurnReadings.NeedSpread, BurnReadings.Measure(Today, Long, close, food, 2700m).Blocked);

        var sparse = Food(60, date => date.DayNumber % 3 == 0 ? 2200m : null);
        var weighIns = Scale(food, 2700m, 85m, 28, 21, 14, 7, 0);
        Assert.Equal(BurnReadings.NeedLogs, BurnReadings.Measure(Today, Long, weighIns, sparse, 2700m).Blocked);
    }

    [Fact]
    public void Weigh_ins_before_the_earliest_day_are_left_out()
    {
        var food = Food(60, _ => 2200m);
        var weighIns = Scale(food, 2700m, 85m, 28, 21, 14, 7, 0);
        var window = BurnReadings.Measure(Today, Today.AddDays(-10), weighIns, food, 2700m);

        Assert.Equal(Today.AddDays(-10), window.From);
        Assert.Equal(BurnTier.Sparse, window.Tier);
        Assert.Equal(2, window.WeighIns);
    }

    [Fact]
    public void A_step_moves_by_how_sure_both_are_and_never_past_five_percent()
    {
        var window = new BurnWindow(Today.AddDays(-28), Today, BurnTier.Regular, 5, [], 2900m, 150m, null);

        // Four new weeks: the window is all new, a plain Kalman step.
        var month = BurnReadings.Step(2800m, 250m, 28, window);
        var priorVar = 250.0 * 250 + 60.0 * 60 * 4;
        Assert.Equal(priorVar / (priorVar + 150.0 * 150), (double)month.Gain, 6);
        Assert.Equal(2800m + month.Gain * 100m, month.Burn);
        Assert.False(month.Capped);
        Assert.True(month.BurnSd < 250m);

        // One new week: three of the four were read last time, so it counts for less.
        var week = BurnReadings.Step(2800m, 250m, 7, window);
        Assert.True(week.Gain < month.Gain);

        var far = BurnReadings.Step(2800m, 350m, 28, window with { Burn = 3600m, Sd = 100m });
        Assert.True(far.Capped);
        Assert.Equal(140m, far.Cap);
        Assert.Equal(2940m, far.Burn);
        // What the cap left over keeps it unsure, so the next step can go on.
        Assert.Equal(330m, far.BurnSd);

        var down = BurnReadings.Step(2800m, 350m, 28, window with { Burn = 2000m, Sd = 100m });
        Assert.Equal(2660m, down.Burn);
    }

    [Fact]
    public void In_simulation_the_rolling_readings_move_less_and_are_as_close_or_closer_by_week_twelve()
    {
        var results = BurnSimulation.Scenarios.Select(scenario => BurnSimulation.Run(scenario)).ToList();
        var report = BurnSimulation.Report(results);
        output.WriteLine(report);
        if (Environment.GetEnvironmentVariable("BURN_SIM_REPORT") is { Length: > 0 } path)
        {
            File.WriteAllText(path, report);
        }

        foreach (var result in results)
        {
            var name = result.Scenario.Name;
            // Never more than 5% in one go, and on average no jumpier than today.
            Assert.True(result.NewMaxStepShare <= 0.0501, name);
            Assert.True(result.NewMeanStep <= result.OldMeanStep + 1, name);
            // By week 12 at least as close as today's maths.
            Assert.True(result.NewError[2] <= result.OldError[2] + 5, name);
        }

        // A weekly feast before a weekly weigh-in, the case that started this.
        var feast = results.Single(result => result.Scenario.Name == "Weekly, Sunday feast, burn −10%");
        Assert.True(feast.NewError[1] < feast.OldError[1]);
    }
}
