namespace GymBro.Api.Nutrition;

public static class LocalDates
{
    public static bool TryZone(string? timeZoneId, out TimeZoneInfo zone)
    {
        if (string.IsNullOrWhiteSpace(timeZoneId))
        {
            zone = TimeZoneInfo.Utc;
            return false;
        }

        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId.Trim());
            return true;
        }
        catch (TimeZoneNotFoundException)
        {
            zone = TimeZoneInfo.Utc;
            return false;
        }
        catch (InvalidTimeZoneException)
        {
            zone = TimeZoneInfo.Utc;
            return false;
        }
    }

    public static bool TryToday(string? timeZoneId, TimeProvider clock, out DateOnly today)
    {
        if (!TryZone(timeZoneId, out var zone))
        {
            today = default;
            return false;
        }

        var local = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone);
        today = DateOnly.FromDateTime(local.DateTime);
        return true;
    }
}
