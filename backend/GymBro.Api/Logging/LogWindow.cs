using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Logging;

/// <summary>
/// The signed-in user's food-log window: setup date through today in the
/// zone the client sent, with the one-day tolerance already in
/// <see cref="LogEntryRules.RejectZone"/>.
/// </summary>
public static class LogWindow
{
    public readonly record struct Opened(
        string? Error,
        DateOnly SetupDate,
        DateOnly ClientToday,
        DateOnly ServerToday,
        TimeZoneInfo Zone);

    public static async Task<Opened> OpenAsync(
        string userId,
        string? timeZoneId,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var zoneError = LogEntryRules.RejectZone(timeZoneId, clock, out var zone, out var clientToday, out var serverToday);
        if (zoneError is not null)
        {
            return new Opened(zoneError, default, default, default, TimeZoneInfo.Utc);
        }

        var created = await db.Profiles.AsNoTracking()
            .Where(row => row.UserId == userId)
            .Select(row => (DateTimeOffset?)row.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
        if (created is null)
        {
            return new Opened(LogEntryRules.NeedProfile, default, clientToday, serverToday, zone);
        }

        return new Opened(null, LogEntryRules.SetupDate(created.Value, zone), clientToday, serverToday, zone);
    }
}
