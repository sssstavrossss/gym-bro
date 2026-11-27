using System.Security.Claims;
using GymBro.Api.Data;
using GymBro.Api.Logging;
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
        string? to,
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

        DateOnly? askedEnd = null;
        if (!string.IsNullOrWhiteSpace(to))
        {
            if (!LogEntryRules.TryDate(to, out var parsed))
            {
                return ApiResults.Error(LogEntryRules.BadDate);
            }

            askedEnd = parsed;
        }

        var userId = Caller.Id(principal);
        var today = await TodayAsync(userId, db, clock, cancellationToken);
        // A fixed range can end on an earlier day (the card's ‹ ›); All always runs to today.
        var end = ProgressMath.WindowEnd(today, normalized, askedEnd);

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
                // A food without a fibre, saturated fat or sodium figure counts as 0, like the day totals on Home.
                Fiber = group.Sum(row => row.Fiber ?? 0m),
                SaturatedFat = group.Sum(row => row.SaturatedFat ?? 0m),
                SodiumMg = group.Sum(row => row.Sodium ?? (row.Salt ?? 0m) * ProgressMath.SodiumMgPerSaltGram),
            })
            .ToListAsync(cancellationToken);

        var targets = await db.TargetHistories.AsNoTracking()
            .Where(row => row.UserId == userId && row.EffectiveDate <= today)
            .OrderBy(row => row.EffectiveDate)
            .ThenBy(row => row.CreatedAt)
            .ThenBy(row => row.Id)
            .Select(row => new { row.EffectiveDate, row.Kcal, row.ProteinGrams, row.FatGrams, row.CarbGrams, row.Bmr, row.Tdee, row.FormulaTdee, row.BurnSdKcal, row.Reasons })
            .ToListAsync(cancellationToken);

        DateOnly? earliest = null;
        if (weighIns.Count > 0) earliest = weighIns[0].LocalDate;
        if (logged.Count > 0)
        {
            var firstLog = logged.Min(row => row.Date);
            earliest = earliest is DateOnly have && have < firstLog ? have : firstLog;
        }

        var from = ProgressMath.WindowStart(end, normalized, earliest);
        var byLog = logged.ToDictionary(row => row.Date);
        var targetRows = targets.Select(row => (row.EffectiveDate, row.Kcal, row.ProteinGrams, row.FatGrams, row.CarbGrams)).ToList();
        var burnRows = targets.Select(row => new BurnRow(row.EffectiveDate, row.Bmr, row.Tdee, row.FormulaTdee, row.BurnSdKcal, row.Reasons)).ToList();
        // The trend as it stood on the last day shown: a past window draws and counts only the weigh-ins up to then,
        // so its line, its end label and its Trend and Rate agree.
        var upToEnd = weighIns.Where(row => row.LocalDate <= end).ToList();
        var trend = TrendWeight.Compute(upToEnd.Select(row => (row.LocalDate, row.Kg)).ToList(), end);
        var trendByDate = trend.Days.ToDictionary(day => day.Date);
        var days = new List<ProgressDay>(end.DayNumber - from.DayNumber + 1);
        decimal kcalSum = 0;
        decimal proteinSum = 0;
        var loggedDays = 0;
        for (var date = from; date <= end; date = date.AddDays(1))
        {
            var target = ProgressMath.TargetMacrosAt(targetRows, date);
            var burn = BurnSeries.At(burnRows, date);
            var shown = trendByDate.TryGetValue(date, out var trendDay) && !trendDay.Gap ? trendDay : null;
            decimal? trendKg = shown?.TrendKg;
            if (!byLog.TryGetValue(date, out var intake))
            {
                days.Add(new ProgressDay(date, false, null, null, target?.Kcal, target?.Protein, trendKg, null, null, target?.Fat, target?.Carbs, null, shown?.BandKg, shown?.Measured ?? false, null, null, burn?.Kcal, burn?.BmrKcal, burn?.SdKcal, burn?.Measured ?? false));
                continue;
            }

            loggedDays++;
            kcalSum += intake.Kcal;
            proteinSum += intake.Protein;
            days.Add(new ProgressDay(date, true, intake.Kcal, intake.Protein, target?.Kcal, target?.Protein, trendKg, intake.Fat, intake.Carbs, target?.Fat, target?.Carbs, intake.Fiber, shown?.BandKg, shown?.Measured ?? false, intake.SaturatedFat, intake.SodiumMg, burn?.Kcal, burn?.BmrKcal, burn?.SdKcal, burn?.Measured ?? false));
        }

        var inRange = weighIns.Where(row => row.LocalDate >= from && row.LocalDate <= end).ToList();
        var current = upToEnd.Count == 0 ? null : upToEnd[^1];
        var burnNow = BurnSeries.At(burnRows, end);
        return Results.Ok(new ProgressResponse(
            normalized,
            from,
            end,
            today,
            new ProgressWeight(
                current?.Kg,
                current?.LocalDate,
                ProgressMath.Change(inRange.Select(row => row.Kg).ToList()),
                inRange.Count,
                inRange.Select(row => new ProgressWeighIn(row.LocalDate, row.Kg)).ToList(),
                ProgressMath.TrendChange(days.Select(day => day.TrendKg).ToList()),
                trend.TrendKg,
                trend.BandKg,
                trend.RateKgPerWeek),
            new ProgressIntake(
                loggedDays,
                ProgressMath.Average(kcalSum, loggedDays, 0),
                ProgressMath.Average(proteinSum, loggedDays, 1)),
            days,
            burnNow is null ? null : new ProgressBurn(burnNow.Kcal, burnNow.BmrKcal, burnNow.SdKcal, burnNow.Measured, burnNow.SetOn),
            earliest));
    }

    /// <summary>The caller's today in their saved time zone, else UTC.</summary>
    internal static async Task<DateOnly> TodayAsync(
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
    IReadOnlyList<ProgressDay> Days,
    ProgressBurn? Burn = null,
    DateOnly? Earliest = null);

/// <summary>Today's daily burn and BMR, the spread around the burn, and the day it was last set.</summary>
public sealed record ProgressBurn(int Kcal, int BmrKcal, int SdKcal, bool Measured, DateOnly SetOn);

public sealed record ProgressWeight(
    decimal? CurrentKg,
    DateOnly? CurrentDate,
    decimal? ChangeKg,
    int Count,
    IReadOnlyList<ProgressWeighIn> WeighIns,
    decimal? TrendChangeKg,
    decimal? TrendKg,
    decimal? BandKg,
    decimal? RateKgPerWeek);

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
    int? TargetCarbs,
    decimal? Fiber = null,
    decimal? TrendBandKg = null,
    bool TrendMeasured = false,
    decimal? SaturatedFat = null,
    decimal? SodiumMg = null,
    int? BurnKcal = null,
    int? BmrKcal = null,
    int? BurnSdKcal = null,
    bool BurnMeasured = false);
