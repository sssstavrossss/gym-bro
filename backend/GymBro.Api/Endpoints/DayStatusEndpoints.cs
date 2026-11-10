using System.Security.Claims;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Logging;
using GymBro.Api.Profiles;
using GymBro.Api.Users;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Endpoints;

public static class DayStatusEndpoints
{
    public const string NeedFasting = "Say whether the day is a fasting day.";

    public const string RangeOrder = "The end date is before the start.";

    public const string RangeLength = "Ask for two weeks or less.";

    public static RouteGroupBuilder MapDayStatus(this RouteGroupBuilder api)
    {
        api.MapGet("/day-status", Get);
        api.MapPut("/day-status/{date}", Put);
        api.MapGet("/log-days", LoggedDays);
        return api;
    }

    private static async Task<IResult> Get(
        ClaimsPrincipal principal,
        string? date,
        string? timeZone,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (!LogEntryRules.TryDate(date, out var localDate))
        {
            return ApiResults.Error(LogEntryRules.BadDate);
        }

        var window = await LogWindow.OpenAsync(Caller.Id(principal), timeZone, db, clock, cancellationToken);
        if (window.Error is not null)
        {
            return ApiResults.Error(window.Error);
        }

        var dateError = LogEntryRules.RejectDate(localDate, window.SetupDate, window.ClientToday, window.ServerToday);
        if (dateError is not null)
        {
            return ApiResults.Error(dateError);
        }

        var userId = Caller.Id(principal);
        var row = await db.DayStatuses.AsNoTracking()
            .FirstOrDefaultAsync(item => item.UserId == userId && item.LocalDate == localDate, cancellationToken);
        return Results.Ok(ToResponse(localDate, row));
    }

    private static async Task<IResult> Put(
        ClaimsPrincipal principal,
        string date,
        HttpRequest http,
        AppDbContext db,
        UserDirectory users,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (!LogEntryRules.TryDate(date, out var localDate))
        {
            return ApiResults.Error(LogEntryRules.BadDate);
        }

        var body = await ReadBody(http, cancellationToken);
        if (body.Error is not null)
        {
            return ApiResults.Error(body.Error);
        }

        await users.UpsertAsync(principal, cancellationToken);
        var window = await LogWindow.OpenAsync(Caller.Id(principal), body.TimeZone, db, clock, cancellationToken);
        if (window.Error is not null)
        {
            return ApiResults.Error(window.Error);
        }

        var dateError = LogEntryRules.RejectDate(localDate, window.SetupDate, window.ClientToday, window.ServerToday);
        if (dateError is not null)
        {
            return ApiResults.Error(dateError);
        }

        var userId = Caller.Id(principal);
        var row = await db.DayStatuses
            .FirstOrDefaultAsync(item => item.UserId == userId && item.LocalDate == localDate, cancellationToken);

        // Fasting is set and cleared on its own. The complete column is not written.
        // Adding food later does not come through here and does not clear the mark.
        if (row is null)
        {
            row = new DayStatus { UserId = userId, LocalDate = localDate, Complete = false };
            db.DayStatuses.Add(row);
        }

        row.Fasting = body.Fasting;
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(ToResponse(localDate, row));
    }

    private static async Task<IResult> LoggedDays(
        ClaimsPrincipal principal,
        string? from,
        string? to,
        string? timeZone,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (!LogEntryRules.TryDate(from, out var fromDate) || !LogEntryRules.TryDate(to, out var toDate))
        {
            return ApiResults.Error(LogEntryRules.BadDate);
        }

        if (toDate < fromDate)
        {
            return ApiResults.Error(RangeOrder);
        }

        if (toDate.DayNumber - fromDate.DayNumber > 13)
        {
            return ApiResults.Error(RangeLength);
        }

        var window = await LogWindow.OpenAsync(Caller.Id(principal), timeZone, db, clock, cancellationToken);
        if (window.Error is not null)
        {
            return ApiResults.Error(window.Error);
        }

        var start = fromDate < window.SetupDate ? window.SetupDate : fromDate;
        var end = toDate > window.ClientToday ? window.ClientToday : toDate;
        var userId = Caller.Id(principal);
        var logged = new List<DateOnly>();
        if (start <= end)
        {
            logged = await db.LogEntries.AsNoTracking()
                .Where(entry => entry.UserId == userId
                    && entry.DeletedAt == null
                    && entry.LocalDate >= start
                    && entry.LocalDate <= end)
                .Select(entry => entry.LocalDate)
                .Distinct()
                .OrderBy(entry => entry)
                .ToListAsync(cancellationToken);
        }

        var firstTarget = await TargetBook.FirstDateAsync(db, userId, cancellationToken);
        return Results.Ok(new
        {
            from = fromDate,
            to = toDate,
            setupDate = window.SetupDate,
            today = window.ClientToday,
            firstTargetDate = firstTarget,
            loggedDates = logged,
        });
    }

    private static object ToResponse(DateOnly localDate, DayStatus? row) => new
    {
        localDate,
        complete = row?.Complete ?? false,
        fasting = row?.Fasting ?? false,
    };

    private readonly record struct Body(bool Complete, bool Fasting, string TimeZone, string? Error);

    private static async Task<Body> ReadBody(HttpRequest http, CancellationToken cancellationToken)
    {
        try
        {
            using var json = await JsonDocument.ParseAsync(http.Body, cancellationToken: cancellationToken);
            var root = json.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("fasting", out var fastingElement)
                || fastingElement.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            {
                return new Body(false, false, "", NeedFasting);
            }

            var zone = root.TryGetProperty("timeZone", out var zoneElement) && zoneElement.ValueKind == JsonValueKind.String
                ? zoneElement.GetString() ?? ""
                : "";
            return new Body(false, fastingElement.GetBoolean(), zone, null);
        }
        catch (JsonException)
        {
            return new Body(false, false, "", NeedFasting);
        }
    }
}
