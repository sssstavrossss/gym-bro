using GymBro.Api.Data;
using GymBro.Api.Foods;

namespace GymBro.Api.Logging;

/// <summary>
/// The average daily nutrient panel over the seven days ending on a date.
/// Only days with at least one entry count, like the averages on Progress. Each day's total is
/// <see cref="NutrientPanel.Day"/>: what is known, with an unknown value counted as 0.
/// </summary>
public static class NutrientWeek
{
    public const int Days = 7;

    public static DateOnly FirstDay(DateOnly lastDay) => lastDay.AddDays(-(Days - 1));

    public static WeekAverage Average(IEnumerable<LogEntry> rows)
    {
        var days = rows.GroupBy(row => row.LocalDate).Select(day => NutrientPanel.Day(day.ToList())).ToList();
        var average = new Dictionary<string, decimal?>();
        if (days.Count == 0)
        {
            return new WeekAverage(0, average);
        }

        foreach (var key in days[0].Keys)
        {
            average[key] = Math.Round(days.Sum(day => day[key] ?? 0m) / days.Count, 2, MidpointRounding.AwayFromZero);
        }

        return new WeekAverage(days.Count, average);
    }
}

public sealed record WeekAverage(int LoggedDays, Dictionary<string, decimal?> Average);
