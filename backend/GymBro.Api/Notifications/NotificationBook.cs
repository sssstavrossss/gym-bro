using GymBro.Api.Data;
using GymBro.Api.Nutrition;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Notifications;

public static class NotificationTypes
{
    public const string Recalculate = "recalculate";

    public const string RecalculateTitle = "Time to recalculate your target";

    public const string RecalculateBody = "A new week has started. Recalculate to update your target from last week's weigh-ins and logs.";

    /// <summary>Types the app shows on Home while open. They don't light the Profile tab's dot (the inbox "badge").</summary>
    public static readonly string[] ShownOnHome = [Recalculate];

    public const string RecalculateLink = "/today?recalculate=1";
}

public static class NotificationBook
{
    public static async Task<UserNotification?> EnsureCurrentWeekAsync(
        AppDbContext db,
        Profile profile,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (!LocalDates.TryToday(profile.TimeZone, clock, out var today) || !LocalDates.TryZone(profile.TimeZone, out var zone))
        {
            return null;
        }

        var week = RecalculateBanner.WeekStart(today);
        var recalculated = await RecalculatedThisWeek(db, profile.UserId, week, today, cancellationToken);
        var row = await db.UserNotifications.FirstOrDefaultAsync(
            item => item.UserId == profile.UserId && item.Type == NotificationTypes.Recalculate && item.WeekStart == week,
            cancellationToken);
        if (row is null)
        {
            row = new UserNotification
            {
                UserId = profile.UserId,
                Type = NotificationTypes.Recalculate,
                Title = NotificationTypes.RecalculateTitle,
                Body = NotificationTypes.RecalculateBody,
                Link = NotificationTypes.RecalculateLink,
                WeekStart = week,
                CreatedAt = UtcInstant(week, zone),
            };
            db.UserNotifications.Add(row);
        }

        if (recalculated && row.ReadAt is null)
        {
            row.ReadAt = clock.GetUtcNow();
        }

        // A new week's reminder replaces an older one that was never acted on, so at most one is open.
        await db.UserNotifications
            .Where(item => item.UserId == profile.UserId
                && item.Type == NotificationTypes.Recalculate
                && item.WeekStart < week
                && item.ReadAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.ReadAt, clock.GetUtcNow()), cancellationToken);

        return row;
    }

    public static async Task MarkCurrentWeekReadAsync(
        AppDbContext db,
        string userId,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var profile = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(row => row.UserId == userId, cancellationToken);
        if (profile is null)
        {
            return;
        }

        var row = await EnsureCurrentWeekAsync(db, profile, clock, cancellationToken);
        if (row is not null && row.ReadAt is null)
        {
            row.ReadAt = clock.GetUtcNow();
        }
    }

    /// <summary>Local midnight of <paramref name="day"/> in <paramref name="zone"/>, as a UTC instant. Npgsql rejects a non-zero offset on timestamptz.</summary>
    public static DateTimeOffset UtcInstant(DateOnly day, TimeZoneInfo zone)
    {
        var local = day.ToDateTime(TimeOnly.MinValue);
        return new DateTimeOffset(local, zone.GetUtcOffset(local)).ToUniversalTime();
    }

    public static async Task<bool> RecalculatedThisWeek(
        AppDbContext db,
        string userId,
        DateOnly week,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        return await db.TargetHistories.AsNoTracking().AnyAsync(
            row => row.UserId == userId
                && row.EffectiveDate >= week
                && row.EffectiveDate <= today
                && (row.Reasons.Contains(RecalculationReasons.Adaptive)
                    || row.Reasons.Contains(RecalculationReasons.Formula)
                    || row.Reasons.Contains(RecalculationReasons.Kept)
                    || row.Reasons.Contains(TargetReasons.WeeklyRecalculation)),
            cancellationToken);
    }
}
