using System.Security.Claims;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using GymBro.Api.Nutrition;
using GymBro.Api.Profiles;
using GymBro.Api.Users;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Endpoints;

public static class ProfileEndpoints
{
    public static RouteGroupBuilder MapProfile(this RouteGroupBuilder api)
    {
        api.MapGet("/profile", Get);
        api.MapPut("/profile", Put);
        api.MapPost("/targets/preview", Preview);
        api.MapGet("/targets", GetTargets);
        return api;
    }

    private static async Task<IResult> Get(
        ClaimsPrincipal principal,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var profile = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(row => row.UserId == userId, cancellationToken);
        var zone = profile?.TimeZone ?? "UTC";
        var today = LocalDates.TryToday(zone, clock, out var local) ? local : DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var weight = await WeightReader.ReadAsync(db, userId, today, cancellationToken);
        var targets = profile is null ? null : await TargetBook.InEffectAsync(db, userId, today, cancellationToken);
        return Results.Ok(new ProfileStateResponse(ToResponse(profile), ToWeight(weight), ToTargets(targets), Matvaretabellen.Citation));
    }

    private static async Task<IResult> Put(
        ClaimsPrincipal principal,
        ProfileRequest request,
        AppDbContext db,
        UserDirectory users,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        await users.UpsertAsync(principal, cancellationToken);
        var userId = Caller.Id(principal);
        var zoneHint = request.TimeZone;
        if (!LocalDates.TryToday(zoneHint, clock, out var today))
        {
            var existingZone = await db.Profiles.AsNoTracking()
                .Where(row => row.UserId == userId)
                .Select(row => row.TimeZone)
                .FirstOrDefaultAsync(cancellationToken);
            if (!LocalDates.TryToday(existingZone, clock, out today))
            {
                return ApiResults.Error("Choose a time zone.");
            }
        }

        var error = ProfileRules.Validate(request, today.Year, out var normalized);
        if (error is not null)
        {
            return ApiResults.Error(error);
        }

        if (!LocalDates.TryToday(normalized.TimeZone, clock, out today))
        {
            return ApiResults.Error("Choose a time zone.");
        }

        var weight = await WeightReader.ReadAsync(db, userId, today, cancellationToken);
        if (weight.UsedKg is not decimal weightKg)
        {
            return ApiResults.Error("Add a weigh-in before saving your profile.");
        }

        var profile = await db.Profiles.FirstOrDefaultAsync(row => row.UserId == userId, cancellationToken);
        var now = clock.GetUtcNow();
        if (profile is not null && ProfileRules.Matches(profile, normalized))
        {
            var current = await TargetBook.InEffectAsync(db, userId, today, cancellationToken);
            return Results.Ok(new ProfileStateResponse(ToResponse(profile), ToWeight(weight), ToTargets(current), Matvaretabellen.Citation));
        }

        var reason = ProfileRules.ReasonFor(profile, normalized);
        if (profile is null)
        {
            profile = new Profile { UserId = userId, CreatedAt = now };
            db.Profiles.Add(profile);
        }

        ProfileRules.Apply(profile, normalized);
        profile.UpdatedAt = now;
        var result = NutritionMath.Calculate(ProfileRules.ToInput(normalized, weightKg, today.Year));
        db.TargetHistories.Add(TargetBook.NewRow(userId, today, result, weightKg, reason, now));
        await db.SaveChangesAsync(cancellationToken);

        var saved = await TargetBook.InEffectAsync(db, userId, today, cancellationToken);
        return Results.Ok(new ProfileStateResponse(ToResponse(profile), ToWeight(weight), ToTargets(saved), Matvaretabellen.Citation));
    }

    private static async Task<IResult> Preview(
        ClaimsPrincipal principal,
        ProfileRequest request,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (!LocalDates.TryToday(request.TimeZone, clock, out var today))
        {
            return ApiResults.Error("Choose a time zone.");
        }

        var error = ProfileRules.Validate(request, today.Year, out var normalized);
        if (error is not null)
        {
            return ApiResults.Error(error);
        }

        var userId = Caller.Id(principal);
        var weight = await WeightReader.ReadAsync(db, userId, today, cancellationToken);
        if (weight.UsedKg is not decimal weightKg)
        {
            return ApiResults.Error("Add a weigh-in before targets can be calculated.");
        }

        var result = NutritionMath.Calculate(ProfileRules.ToInput(normalized, weightKg, today.Year));
        return Results.Ok(new PreviewResponse(
            today.Year - normalized.BirthYear,
            result.Bmr,
            result.Tdee,
            result.Kcal,
            result.Protein,
            result.Fat,
            result.Carbs,
            result.FloorApplied,
            weightKg,
            weight.Source));
    }

    private static async Task<IResult> GetTargets(
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
        var profile = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(row => row.UserId == userId, cancellationToken);
        var today = profile is not null && LocalDates.TryToday(profile.TimeZone, clock, out var local)
            ? local
            : DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var asOf = date ?? today;
        var targets = await TargetBook.InEffectAsync(db, userId, asOf, cancellationToken);
        return Results.Ok(new { date = asOf, targets = ToTargets(targets) });
    }

    public static ProfileResponse? ToResponse(Profile? profile) => profile is null
        ? null
        : new ProfileResponse(
            profile.Sex,
            profile.BirthYear,
            profile.HeightCm,
            profile.Activity,
            profile.Goal,
            profile.RateKgPerWeek,
            profile.GoalWeightKg,
            profile.ProteinSetting,
            profile.ProteinGramsPerKg,
            profile.FatSetting,
            profile.FatPercent,
            profile.TimeZone);

    public static WeightResponse ToWeight(WeightSnapshot weight) => new(
        weight.AsOf,
        weight.TrendKg,
        weight.TrendState,
        weight.Reasons,
        weight.LatestKg,
        weight.LatestDate,
        weight.WeighInsInWindow,
        TrendWeight.WindowDays,
        TrendWeight.SmoothingShare,
        weight.UsedKg,
        weight.Source,
        weight.GoalReached,
        ToFreshStart(weight));

    public static FreshStartResponse? ToFreshStart(WeightSnapshot weight) => weight.FreshStart is { } fresh
        ? new FreshStartResponse(
            fresh.Date,
            fresh.PreviousDate,
            fresh.DaysSincePrevious,
            fresh.WeeksSincePrevious,
            weight.RecalculatePending)
        : null;

    public static TargetsResponse? ToTargets(TargetHistory? row) => row is null
        ? null
        : new TargetsResponse(
            row.EffectiveDate,
            row.Bmr,
            row.Tdee,
            row.Kcal,
            row.ProteinGrams,
            row.FatGrams,
            row.CarbGrams,
            row.FloorApplied,
            row.Reason,
            row.WeightKg);
}

public sealed record ProfileResponse(
    string Sex,
    int BirthYear,
    decimal HeightCm,
    string Activity,
    string Goal,
    decimal? RateKgPerWeek,
    decimal GoalWeightKg,
    string ProteinSetting,
    decimal ProteinGramsPerKg,
    string FatSetting,
    decimal FatPercent,
    string TimeZone);

public sealed record WeightResponse(
    DateOnly AsOf,
    decimal? TrendKg,
    string? TrendState,
    IReadOnlyList<string> Reasons,
    decimal? LatestKg,
    DateOnly? LatestDate,
    int WeighInsInWindow,
    int WindowDays,
    decimal SmoothingShare,
    decimal? UsedKg,
    string Source,
    bool GoalReached,
    FreshStartResponse? FreshStart);

public sealed record FreshStartResponse(
    DateOnly Date,
    DateOnly PreviousDate,
    int DaysSincePrevious,
    int WeeksSincePrevious,
    bool RecalculatePending);

public sealed record WeightChartResponse(
    DateOnly AsOf,
    int Days,
    decimal? TrendKg,
    string? TrendState,
    IReadOnlyList<string> Reasons,
    bool GoalReached,
    FreshStartResponse? FreshStart,
    IReadOnlyList<WeightChartPoint> Series);

public sealed record WeightChartPoint(
    DateOnly Date,
    decimal? TrendKg,
    decimal? WeighInKg,
    decimal? ReadingKg,
    bool RealWeighIn,
    bool Estimated);

public sealed record WeighInWriteResponse(
    DateOnly LocalDate,
    decimal Kg,
    bool Replaced,
    string? Notice,
    WeightResponse Trend);

public sealed record FreshStartDecisionResponse(
    bool Accepted,
    bool Wrote,
    TargetsResponse? Targets);

public sealed record TargetsResponse(
    DateOnly EffectiveDate,
    int Bmr,
    int Tdee,
    int Kcal,
    int Protein,
    int Fat,
    int Carbs,
    bool FloorApplied,
    string Reason,
    decimal WeightKg);

public sealed record ProfileStateResponse(
    ProfileResponse? Profile,
    WeightResponse Weight,
    TargetsResponse? Targets,
    string Citation);

public sealed record PreviewResponse(
    int Age,
    int Bmr,
    int Tdee,
    int Kcal,
    int Protein,
    int Fat,
    int Carbs,
    bool FloorApplied,
    decimal WeightKg,
    string WeightSource);
