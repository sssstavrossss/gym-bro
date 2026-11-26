using GymBro.Api.Data;
using GymBro.Api.Nutrition;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Profiles;

/// <summary>
/// Loads what <see cref="BurnReadings.Expect"/> needs for one person and day: their real
/// weigh-ins, the food logged in the 28 days before, the target in effect each day, and the burn
/// in effect on that day. Weigh-ins in the settling week after setup or a fresh start don't count.
/// </summary>
public static class ExpectedWeight
{
    public static async Task<WeighInExpectation?> ReadAsync(
        AppDbContext db,
        string userId,
        DateOnly date,
        CancellationToken cancellationToken)
    {
        var profile = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(row => row.UserId == userId, cancellationToken);
        if (profile is null || !LocalDates.TryZone(profile.TimeZone, out var zone))
        {
            return null;
        }

        var history = await db.TargetHistories.AsNoTracking()
            .Where(row => row.UserId == userId && row.EffectiveDate <= date)
            .OrderBy(row => row.EffectiveDate)
            .ToListAsync(cancellationToken);
        var current = history.LastOrDefault();
        if (current is null)
        {
            return null;
        }

        var weight = await WeightReader.ReadAsync(db, userId, date, cancellationToken);
        var weighIns = weight.Series.Days
            .Where(day => day.Real && day.WeighInKg is not null && day.Date < date)
            .Select(day => (day.Date, Kg: day.WeighInKg!.Value))
            .ToList();
        var created = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(profile.CreatedAt, zone).DateTime);
        var earliest = RecalculatePeriod.Settled(created, RecalculatePeriod.LatestFreshStart(weighIns, date));

        var from = date.AddDays(-(BurnReadings.WindowDays + 1));
        var logs = await db.LogEntries.AsNoTracking()
            .Where(row => row.UserId == userId && row.DeletedAt == null && row.LocalDate >= from && row.LocalDate < date)
            .Select(row => new { row.LocalDate, row.Kcal })
            .ToListAsync(cancellationToken);
        var byDay = logs.GroupBy(row => row.LocalDate).ToDictionary(group => group.Key, group => group.Sum(row => row.Kcal));
        var days = new List<IntakeDay>();
        for (var day = from; day < date; day = day.AddDays(1))
        {
            var target = history.LastOrDefault(row => row.EffectiveDate <= day);
            days.Add(new IntakeDay(day, byDay.TryGetValue(day, out var kcal) ? (decimal?)kcal : null, target?.Kcal));
        }

        return BurnReadings.Expect(date, earliest, weighIns, days, current.Tdee);
    }
}
