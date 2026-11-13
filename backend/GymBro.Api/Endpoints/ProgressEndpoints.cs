using System.Security.Claims;
using GymBro.Api.Data;
using GymBro.Api.Nutrition;
using GymBro.Api.Progress;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Endpoints;

public static class ProgressEndpoints
{
    public static RouteGroupBuilder MapProgress(this RouteGroupBuilder api)
    {
        api.MapGet("/progress", Get);
        return api;
    }

    private static async Task<IResult> Get(
        ClaimsPrincipal principal,
        string? range,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (!ProgressMath.TryRange(range, out var normalized))
        {
            return ApiResults.Error(ProgressMath.BadRange);
        }

        var userId = Caller.Id(principal);
        var today = await TodayAsync(userId, db, clock, cancellationToken);

        var weighIns = await db.WeighIns.AsNoTracking()
            .Where(row => row.UserId == userId && row.LocalDate <= today)
            .OrderBy(row => row.LocalDate)
            .Select(row => new { row.LocalDate, row.Kg })
            .ToListAsync(cancellationToken);

        var logged = await db.LogEntries.AsNoTracking()
            .Where(row => row.UserId == userId && row.DeletedAt == null && row.LocalDate <= today)
            .GroupBy(row => row.LocalDate)
            .Select(group => new
            {
                Date = group.Key,
                Kcal = group.Sum(row => row.Kcal),
                Protein = group.Sum(row => row.Protein),
                Fat = group.Sum(row => row.Fat),
                Carbs = group.Sum(row => row.Carbs),
            })
            .ToListAsync(cancellationToken);

        var targets = await db.TargetHistories.AsNoTracking()
            .Where(row => row.UserId == userId && row.EffectiveDate <= today)
            .OrderBy(row => row.EffectiveDate)
            .ThenBy(row => row.CreatedAt)
            .ThenBy(row => row.Id)
            .Select(row => new { row.EffectiveDate, row.Kcal, row.ProteinGrams, row.FatGrams, row.CarbGrams })
            .ToListAsync(cancellationToken);

        DateOnly? earliest = null;
        if (weighIns.Count > 0) earliest = weighIns[0].LocalDate;
        if (logged.Count > 0)
        {
            var firstLog = logged.Min(row => row.Date);
            earliest = earliest is DateOnly have && have < firstLog ? have : firstLog;
        }

        var from = ProgressMath.WindowStart(today, normalized, earliest);
        var byLog = logged.ToDictionary(row => row.Date);
        var targetRows = targets.Select(row => (row.EffectiveDate, row.Kcal, row.ProteinGrams, row.FatGrams, row.CarbGrams)).ToList();
        var trend = TrendWeight.Compute(weighIns.Select(row => (row.LocalDate, row.Kg)).ToList(), today);
        var trendByDate = trend.Days.ToDictionary(day => day.Date);
        var days = new List<ProgressDay>(today.DayNumber - from.DayNumber + 1);
        decimal kcalSum = 0;
        decimal proteinSum = 0;
        var loggedDays = 0;
        for (var date = from; date <= today; date = date.AddDays(1))
        {
            var target = ProgressMath.TargetMacrosAt(targetRows, date);
            decimal? trendKg = trendByDate.TryGetValue(date, out var trendDay) && !trendDay.Gap ? trendDay.TrendKg : null;
            if (!byLog.TryGetValue(date, out var intake))
            {
                days.Add(new ProgressDay(date, false, null, null, target?.Kcal, target?.Protein, trendKg, null, null, target?.Fat, target?.Carbs));
                continue;
            }

            loggedDays++;
            kcalSum += intake.Kcal;
            proteinSum += intake.Protein;
            days.Add(new ProgressDay(date, true, intake.Kcal, intake.Protein, target?.Kcal, target?.Protein, trendKg, intake.Fat, intake.Carbs, target?.Fat, target?.Carbs));
        }

        var inRange = weighIns.Where(row => row.LocalDate >= from && row.LocalDate <= today).ToList();
        var current = weighIns.Count == 0 ? null : weighIns[^1];
        return Results.Ok(new ProgressResponse(
            normalized,
            from,
            today,
            today,
            new ProgressWeight(
                current?.Kg,
                current?.LocalDate,
                ProgressMath.Change(inRange.Select(row => row.Kg).ToList()),
                inRange.Count,
                inRange.Select(row => new ProgressWeighIn(row.LocalDate, row.Kg)).ToList(),
                ProgressMath.TrendChange(days.Select(day => day.TrendKg).ToList())),
            new ProgressIntake(
                loggedDays,
                ProgressMath.Average(kcalSum, loggedDays, 0),
                ProgressMath.Average(proteinSum, loggedDays, 1)),
            days));
    }

    private static async Task<DateOnly> TodayAsync(
        string userId,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var zone = await db.Profiles.AsNoTracking()
            .Where(row => row.UserId == userId)
            .Select(row => row.TimeZone)
            .FirstOrDefaultAsync(cancellationToken);
        if (LocalDates.TryToday(zone, clock, out var today))
        {
            return today;
        }

        return DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
    }
}

public sealed record ProgressResponse(
    string Range,
    DateOnly From,
    DateOnly To,
    DateOnly Today,
    ProgressWeight Weight,
    ProgressIntake Intake,
    IReadOnlyList<ProgressDay> Days);

public sealed record ProgressWeight(
    decimal? CurrentKg,
    DateOnly? CurrentDate,
    decimal? ChangeKg,
    int Count,
    IReadOnlyList<ProgressWeighIn> WeighIns,
    decimal? TrendChangeKg);

public sealed record ProgressWeighIn(DateOnly Date, decimal Kg);

public sealed record ProgressIntake(int LoggedDays, decimal? AverageKcal, decimal? AverageProtein);

public sealed record ProgressDay(
    DateOnly Date,
    bool Logged,
    decimal? Kcal,
    decimal? Protein,
    int? TargetKcal,
    int? TargetProtein,
    decimal? TrendKg,
    decimal? Fat,
    decimal? Carbs,
    int? TargetFat,
    int? TargetCarbs);
