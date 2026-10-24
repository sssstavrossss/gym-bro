using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Nutrition;
using GymBro.Api.Profiles;
using GymBro.Api.Users;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Endpoints;

public sealed class WeighInRequest
{
    public decimal Kg { get; set; }

    public string? TimeZone { get; set; }

    public bool Confirm { get; set; }
}

public sealed class FreshStartRequest
{
    public bool? Accept { get; set; }
}

public static class WeighInEndpoints
{
    public const string ConfirmWeighIn = "confirm_weigh_in";

    public static RouteGroupBuilder MapWeighIns(this RouteGroupBuilder api)
    {
        api.MapPut("/weigh-ins/{date}", Put);
        api.MapDelete("/weigh-ins/{date}", Delete);
        api.MapGet("/weigh-ins", List);
        api.MapGet("/weight/trend", Trend);
        api.MapGet("/weight/chart", Chart);
        api.MapPost("/weight/fresh-start", FreshStart);
        return api;
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

        if (!TryDate(date, out var localDate))
        {
            return ApiResults.Error("Use a date like 2026-10-24.");
        }

        var body = await ReadBody(http, cancellationToken);
        if (body.Error is not null)
        {
            return ApiResults.Error(body.Error);
        }

        var latestAllowed = await LatestAllowedAsync(principal, body.TimeZone, db, clock, cancellationToken);
        if (localDate > latestAllowed)
        {
            return ApiResults.Error("That date is in the future.");
        }

        if (localDate < new DateOnly(2000, 1, 1))
        {
            return ApiResults.Error("That date is too far in the past.");
        }

        await users.UpsertAsync(principal, cancellationToken);
        var userId = Caller.Id(principal);
        var kg = decimal.Round(body.Kg, 1, MidpointRounding.AwayFromZero);
        if (!body.Confirm)
        {
            var previous = await WeightReader.ReadAsync(db, userId, localDate.AddDays(-1), cancellationToken);
            int? daysSincePrevious = previous.LatestDate is DateOnly last
                ? localDate.DayNumber - last.DayNumber
                : null;
            if (previous.TrendKg is decimal previousTrend
                && Math.Abs(kg - previousTrend) > TrendWeight.TypoLimitKg
                && PartADecisions.TypoGuardApplies(daysSincePrevious))
            {
                return Results.Json(new
                {
                    error = $"Is {kg.ToString("0.0", CultureInfo.InvariantCulture)} kg right?",
                    code = ConfirmWeighIn,
                    kg,
                    localDate,
                    previousTrendKg = previousTrend,
                    limitKg = TrendWeight.TypoLimitKg,
                }, statusCode: StatusCodes.Status409Conflict);
            }
        }

        var existing = await db.WeighIns.FirstOrDefaultAsync(
            row => row.UserId == userId && row.LocalDate == localDate,
            cancellationToken);
        var replaced = existing is not null;
        var now = clock.GetUtcNow();
        if (existing is null)
        {
            existing = new WeighIn
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                LocalDate = localDate,
            };
            db.WeighIns.Add(existing);
        }

        existing.Kg = kg;
        existing.UpdatedAt = now;
        if (PartADecisions.ShouldRewriteFreshStartRow())
        {
            throw new InvalidOperationException(
                "Rewriting a fresh_start target row when a later weigh-in closes the gap is not the current spec.");
        }

        await db.SaveChangesAsync(cancellationToken);

        var today = await TodayAsync(principal, db, clock, cancellationToken);
        var asOf = localDate > today ? localDate : today;
        var weight = await WeightReader.ReadAsync(db, userId, asOf, cancellationToken);
        var status = replaced ? StatusCodes.Status200OK : StatusCodes.Status201Created;
        return Results.Json(new WeighInWriteResponse(
            localDate,
            kg,
            replaced,
            replaced ? "That day's weigh-in was replaced." : null,
            ProfileEndpoints.ToWeight(weight)), statusCode: status);
    }

    private static async Task<IResult> Delete(
        ClaimsPrincipal principal,
        string date,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (!TryDate(date, out var localDate))
        {
            return ApiResults.Error("Use a date like 2026-10-24.");
        }

        var userId = Caller.Id(principal);
        var count = await db.WeighIns.CountAsync(row => row.UserId == userId, cancellationToken);
        if (!PartADecisions.MayDeleteWeighIn(count))
        {
            return ApiResults.Error("Keep your first weigh-in.", StatusCodes.Status409Conflict);
        }

        var existing = await db.WeighIns.FirstOrDefaultAsync(
            row => row.UserId == userId && row.LocalDate == localDate,
            cancellationToken);
        if (existing is null)
        {
            return ApiResults.Error("No weigh-in on that day.", StatusCodes.Status404NotFound);
        }

        db.WeighIns.Remove(existing);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> List(
        ClaimsPrincipal principal,
        DateOnly? from,
        DateOnly? to,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var query = db.WeighIns.AsNoTracking().Where(row => row.UserId == userId);
        if (from is DateOnly start)
        {
            query = query.Where(row => row.LocalDate >= start);
        }

        if (to is DateOnly end)
        {
            query = query.Where(row => row.LocalDate <= end);
        }

        var rows = await query
            .OrderByDescending(row => row.LocalDate)
            .Take(400)
            .Select(row => new { localDate = row.LocalDate, kg = row.Kg })
            .ToListAsync(cancellationToken);
        return Results.Ok(new { weighIns = rows });
    }

    private static async Task<IResult> Trend(
        ClaimsPrincipal principal,
        DateOnly? date,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var today = await TodayAsync(principal, db, clock, cancellationToken);
        var asOf = date ?? today;
        var weight = await WeightReader.ReadAsync(db, userId, asOf, cancellationToken);
        return Results.Ok(ProfileEndpoints.ToWeight(weight));
    }

    private static async Task<IResult> Chart(
        ClaimsPrincipal principal,
        DateOnly? date,
        int? days,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var length = days ?? 30;
        if (length < 1 || length > 366)
        {
            return ApiResults.Error("Ask for between 1 and 366 days.");
        }

        var userId = Caller.Id(principal);
        var today = await TodayAsync(principal, db, clock, cancellationToken);
        var asOf = date ?? today;
        var weight = await WeightReader.ReadAsync(db, userId, asOf, cancellationToken);
        var start = asOf.AddDays(-(length - 1));
        var byDate = weight.Series.Days.ToDictionary(day => day.Date);
        var series = new List<WeightChartPoint>(length);
        for (var cursor = start; cursor <= asOf; cursor = cursor.AddDays(1))
        {
            if (!byDate.TryGetValue(cursor, out var day))
            {
                series.Add(new WeightChartPoint(cursor, null, null, null, false, false, false));
                continue;
            }

            series.Add(new WeightChartPoint(
                cursor,
                day.Gap ? null : day.TrendKg,
                day.WeighInKg,
                day.ReadingKg,
                day.Real,
                day.Estimated,
                day.Gap));
        }

        return Results.Ok(new WeightChartResponse(
            asOf,
            length,
            weight.TrendKg,
            weight.TrendState,
            weight.Reasons,
            weight.GoalReached,
            ProfileEndpoints.ToFreshStart(weight),
            series));
    }

    private static async Task<IResult> FreshStart(
        ClaimsPrincipal principal,
        FreshStartRequest? request,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (request?.Accept is not bool accept)
        {
            return ApiResults.Error("Say whether to recalculate today's targets.");
        }

        var userId = Caller.Id(principal);
        var profile = await db.Profiles.FirstOrDefaultAsync(row => row.UserId == userId, cancellationToken);
        if (profile is null || !LocalDates.TryToday(profile.TimeZone, clock, out var today))
        {
            return ApiResults.Error("Save your profile before recalculating targets.");
        }

        if (!accept)
        {
            return Results.Ok(new FreshStartDecisionResponse(false, false, null));
        }

        var weight = await WeightReader.ReadAsync(db, userId, today, cancellationToken);
        if (weight.FreshStart is null || weight.TrendKg is not decimal trendKg)
        {
            return ApiResults.Error("Today's weight is not a fresh start.", StatusCodes.Status409Conflict);
        }

        var result = NutritionMath.Calculate(ProfileRules.ToInput(profile, trendKg, today.Year));
        var row = await TargetBook.UpsertTodayAsync(
            db,
            userId,
            today,
            result,
            trendKg,
            TargetReasons.FreshStart,
            clock.GetUtcNow(),
            cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new FreshStartDecisionResponse(true, true, ProfileEndpoints.ToTargets(row)));
    }

    private static bool TryDate(string date, out DateOnly localDate) =>
        DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out localDate);

    private static async Task<(decimal Kg, string? TimeZone, bool Confirm, string? Error)> ReadBody(
        HttpRequest http,
        CancellationToken cancellationToken)
    {
        JsonDocument document;
        try
        {
            document = await JsonDocument.ParseAsync(http.Body, cancellationToken: cancellationToken);
        }
        catch (JsonException)
        {
            return (0, null, false, "Enter a weight.");
        }

        using var _ = document;
        if (!document.RootElement.TryGetProperty("kg", out var kgElement) &&
            !document.RootElement.TryGetProperty("Kg", out kgElement))
        {
            return (0, null, false, "Enter a weight.");
        }

        if (!TryKg(kgElement, out var kg))
        {
            return (0, null, false, "Enter a weight, using a comma or a point.");
        }

        if (!NutritionMath.AtMostOneDecimal(kg) || kg < 30 || kg > 300)
        {
            return (0, null, false, "Weight should be between 30 and 300 kg, with one decimal.");
        }

        string? timeZone = null;
        if (document.RootElement.TryGetProperty("timeZone", out var zone) && zone.ValueKind == JsonValueKind.String)
        {
            timeZone = zone.GetString();
        }

        var confirm = document.RootElement.TryGetProperty("confirm", out var confirmElement)
            && confirmElement.ValueKind == JsonValueKind.True;
        return (kg, timeZone, confirm, null);
    }

    private static bool TryKg(JsonElement element, out decimal kg)
    {
        kg = 0;
        if (element.ValueKind == JsonValueKind.Number)
        {
            return element.TryGetDecimal(out kg);
        }

        if (element.ValueKind == JsonValueKind.String)
        {
            return DecimalInput.TryParse(element.GetString(), out kg);
        }

        return false;
    }

    private static async Task<DateOnly> TodayAsync(
        ClaimsPrincipal principal,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var userId = Caller.Id(principal);
        var stored = await db.Profiles.AsNoTracking()
            .Where(row => row.UserId == userId)
            .Select(row => row.TimeZone)
            .FirstOrDefaultAsync(cancellationToken);
        if (LocalDates.TryToday(stored, clock, out var today))
        {
            return today;
        }

        return DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
    }

    private static async Task<DateOnly> LatestAllowedAsync(
        ClaimsPrincipal principal,
        string? timeZone,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (LocalDates.TryToday(timeZone, clock, out var today))
        {
            return today;
        }

        var userId = Caller.Id(principal);
        var stored = await db.Profiles.AsNoTracking()
            .Where(row => row.UserId == userId)
            .Select(row => row.TimeZone)
            .FirstOrDefaultAsync(cancellationToken);
        if (LocalDates.TryToday(stored, clock, out today))
        {
            return today;
        }

        // No zone yet (first weigh-in). Allow the furthest-ahead civil date.
        return DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime).AddDays(1);
    }
}
