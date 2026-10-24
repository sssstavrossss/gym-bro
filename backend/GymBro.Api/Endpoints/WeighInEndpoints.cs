using System.Globalization;
using System.Security.Claims;
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
}

public static class WeighInEndpoints
{
    public static RouteGroupBuilder MapWeighIns(this RouteGroupBuilder api)
    {
        api.MapPut("/weigh-ins/{date}", Put);
        api.MapDelete("/weigh-ins/{date}", Delete);
        api.MapGet("/weigh-ins", List);
        api.MapGet("/weight/trend", Trend);
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
        await db.SaveChangesAsync(cancellationToken);
        var status = replaced ? StatusCodes.Status200OK : StatusCodes.Status201Created;
        return Results.Json(new
        {
            localDate,
            kg,
            replaced,
            notice = replaced ? "That day's weigh-in was replaced." : null,
        }, statusCode: status);
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
        var profileZone = await db.Profiles.AsNoTracking()
            .Where(row => row.UserId == userId)
            .Select(row => row.TimeZone)
            .FirstOrDefaultAsync(cancellationToken);
        var today = LocalDates.TryToday(profileZone, clock, out var local)
            ? local
            : DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var asOf = date ?? today;
        var weight = await WeightReader.ReadAsync(db, userId, asOf, cancellationToken);
        return Results.Ok(new
        {
            asOf,
            trendKg = weight.TrendKg,
            trendVisible = weight.TrendVisible,
            usedKg = weight.UsedKg,
            source = weight.Source,
            weighInsInWindow = weight.WeighInsInWindow,
            minimumWeighIns = TrendWeight.MinimumWeighIns,
            windowDays = TrendWeight.WindowDays,
            smoothingShare = TrendWeight.SmoothingShare,
        });
    }

    private static bool TryDate(string date, out DateOnly localDate) =>
        DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out localDate);

    private static async Task<(decimal Kg, string? TimeZone, string? Error)> ReadBody(
        HttpRequest http,
        CancellationToken cancellationToken)
    {
        System.Text.Json.JsonDocument document;
        try
        {
            document = await System.Text.Json.JsonDocument.ParseAsync(http.Body, cancellationToken: cancellationToken);
        }
        catch (System.Text.Json.JsonException)
        {
            return (0, null, "Enter a weight.");
        }

        using var _ = document;
        if (!document.RootElement.TryGetProperty("kg", out var kgElement) &&
            !document.RootElement.TryGetProperty("Kg", out kgElement))
        {
            return (0, null, "Enter a weight.");
        }

        if (!TryKg(kgElement, out var kg))
        {
            return (0, null, "Enter a weight, using a comma or a point.");
        }

        if (!NutritionMath.AtMostOneDecimal(kg) || kg < 30 || kg > 300)
        {
            return (0, null, "Weight should be between 30 and 300 kg, with one decimal.");
        }

        string? timeZone = null;
        if (document.RootElement.TryGetProperty("timeZone", out var zone) && zone.ValueKind == System.Text.Json.JsonValueKind.String)
        {
            timeZone = zone.GetString();
        }

        return (kg, timeZone, null);
    }

    private static bool TryKg(System.Text.Json.JsonElement element, out decimal kg)
    {
        kg = 0;
        if (element.ValueKind == System.Text.Json.JsonValueKind.Number)
        {
            return element.TryGetDecimal(out kg);
        }

        if (element.ValueKind == System.Text.Json.JsonValueKind.String)
        {
            return DecimalInput.TryParse(element.GetString(), out kg);
        }

        return false;
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
