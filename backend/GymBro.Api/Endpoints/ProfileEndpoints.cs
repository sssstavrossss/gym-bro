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
        api.MapGet("/profile/history", History);
        api.MapPut("/profile", Put);
        api.MapPut("/profile/settings", PutSettings);
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
        return Results.Ok(new ProfileStateResponse(ToResponse(profile), ToWeight(weight), ToTargets(targets), Matvaretabellen.Citation, OpenFoodFactsCredit.Citation));
    }

    public const int HistoryPage = 20;

    public const int HistoryPageMax = 100;

    /// <summary>
    /// Target rows and declined recalculations, newest first, a page at a time.
    /// Each target row carries the kcal and burn of the row before it, so the
    /// app can show the change. A decline is dated in the person's time zone.
    /// </summary>
    private static async Task<IResult> History(
        ClaimsPrincipal principal,
        int? offset,
        int? limit,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var zoneId = await db.Profiles.AsNoTracking()
            .Where(row => row.UserId == userId)
            .Select(row => row.TimeZone)
            .FirstOrDefaultAsync(cancellationToken);
        var zone = LocalDates.TryZone(zoneId, out var found) ? found : TimeZoneInfo.Utc;
        var rows = await db.TargetHistories.AsNoTracking()
            .Where(row => row.UserId == userId)
            .OrderByDescending(row => row.EffectiveDate)
            .ThenByDescending(row => row.CreatedAt)
            .ThenByDescending(row => row.Id)
            .ToListAsync(cancellationToken);
        var declines = await db.RecalculationDeclines.AsNoTracking()
            .Where(row => row.UserId == userId)
            .ToListAsync(cancellationToken);
        var targets = rows.Select((row, index) =>
        {
            var previous = index + 1 < rows.Count ? rows[index + 1] : null;
            return new HistoryRow(
                row.CreatedAt,
                row.Id,
                "target",
                row.EffectiveDate,
                row.Kcal,
                null,
                row.ProteinGrams,
                row.FatGrams,
                row.CarbGrams,
                row.Tdee,
                previous?.Kcal,
                previous?.Tdee,
                row.WeightKg,
                row.Reasons,
                row.FloorApplied,
                TargetDetails.Parse(row.Details),
                null,
                null);
        });
        var declined = declines.Select(row => new HistoryRow(
            row.CreatedAt,
            row.Id,
            "declined",
            DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(row.CreatedAt, zone).DateTime),
            row.KeptKcal,
            row.SuggestedKcal,
            row.SuggestedProtein,
            row.SuggestedFat,
            row.SuggestedCarbs,
            row.SuggestedTdee,
            null,
            null,
            null,
            ["recalculation_declined"],
            false,
            null,
            row.PeriodFrom,
            row.PeriodTo));
        var all = targets.Concat(declined)
            .OrderByDescending(row => row.Date)
            .ThenByDescending(row => row.Sort)
            .ThenByDescending(row => row.Id)
            .ToList();
        var skip = Math.Max(0, offset ?? 0);
        var take = Math.Clamp(limit ?? HistoryPage, 1, HistoryPageMax);
        var page = all.Skip(skip).Take(take).Select(row => new
        {
            kind = row.Kind,
            date = row.Date,
            kcal = row.Kcal,
            suggestedKcal = row.SuggestedKcal,
            protein = row.Protein,
            fat = row.Fat,
            carbs = row.Carbs,
            burn = row.Burn,
            previousKcal = row.PreviousKcal,
            previousBurn = row.PreviousBurn,
            weightKg = row.WeightKg,
            reasons = row.Reasons,
            floorApplied = row.FloorApplied,
            recalculation = row.Details?.Recalculation,
            changes = row.Details?.Changes,
            periodFrom = row.PeriodFrom,
            periodTo = row.PeriodTo,
        });
        return Results.Ok(new { rows = page, total = all.Count, more = skip + take < all.Count });
    }

    private sealed record HistoryRow(
        DateTimeOffset Sort,
        long Id,
        string Kind,
        DateOnly Date,
        int Kcal,
        int? SuggestedKcal,
        int Protein,
        int Fat,
        int Carbs,
        int Burn,
        int? PreviousKcal,
        int? PreviousBurn,
        decimal? WeightKg,
        string[] Reasons,
        bool FloorApplied,
        TargetDetails? Details,
        DateOnly? PeriodFrom,
        DateOnly? PeriodTo);

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
            return Results.Ok(new ProfileStateResponse(ToResponse(profile), ToWeight(weight), ToTargets(current), Matvaretabellen.Citation, OpenFoodFactsCredit.Citation));
        }

        var reasons = ProfileRules.ReasonFor(profile, normalized);
        TargetHistory? inEffect = null;
        TargetDetails? details = null;
        if (profile is null)
        {
            profile = new Profile { UserId = userId, CreatedAt = now };
            db.Profiles.Add(profile);
        }
        else
        {
            inEffect = await TargetBook.InEffectAsync(db, userId, today, cancellationToken);
            var changes = ProfileChange.Between(profile, normalized);
            details = changes.Count == 0 ? null : new TargetDetails(null, changes);
        }

        ProfileRules.Apply(profile, normalized);
        profile.UpdatedAt = now;
        var (result, burn) = Retarget(ProfileRules.ToInput(normalized, weightKg, today.Year), inEffect, details);
        await TargetBook.StageAsync(db, userId, today, result, burn, weightKg, reasons, now, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        var saved = await TargetBook.InEffectAsync(db, userId, today, cancellationToken);
        return Results.Ok(new ProfileStateResponse(ToResponse(profile), ToWeight(weight), ToTargets(saved), Matvaretabellen.Citation, OpenFoodFactsCredit.Citation));
    }

    /// <summary>
    /// New targets for an edited profile. A measured burn is kept: it moves by
    /// as much as the formula moves, so activity, weight, and age still count.
    /// Only a fresh start or choosing the formula goes back to Mifflin-St Jeor.
    /// </summary>
    private static (NutritionResult Result, TargetBurn Burn) Retarget(NutritionInput input, TargetHistory? inEffect, TargetDetails? details)
    {
        var formula = NutritionMath.Calculate(input);
        var (burn, sd) = TargetBook.CarriedBurn(inEffect, formula);
        return (NutritionMath.FromExpenditure(input, burn), new TargetBurn(formula.Tdee, sd, details));
    }

    private static async Task<IResult> PutSettings(
        ClaimsPrincipal principal,
        SettingsRequest request,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var profile = await db.Profiles.FirstOrDefaultAsync(row => row.UserId == Caller.Id(principal), cancellationToken);
        if (profile is null)
        {
            return ApiResults.Error(RecalculateEndpoints.NeedProfile);
        }

        if (request.TimeZone is not null)
        {
            var zone = request.TimeZone.Trim();
            if (zone.Length > 64 || !LocalDates.TryToday(zone, clock, out _))
            {
                return ApiResults.Error("That time zone is not known.");
            }

            profile.TimeZone = zone;
        }

        if (request.TimeZoneFollowsDevice is { } follows)
        {
            profile.TimeZoneFollowsDevice = follows;
        }

        if (request.FoodCountry is { } country)
        {
            var code = country.Trim().ToUpperInvariant();
            if (!FoodCountries.IsKnown(code))
            {
                return ApiResults.Error(FoodCountries.Invalid);
            }

            profile.FoodCountry = code;
        }

        if (request.FoodCountryFollowsZone is { } followsZone)
        {
            profile.FoodCountryFollowsZone = followsZone;
        }

        if (request.WeightUnit is { } weightUnit)
        {
            if (!Units.IsWeight(weightUnit))
            {
                return ApiResults.Error("Weight is shown in kg or lb.");
            }

            profile.WeightUnit = weightUnit;
        }

        if (request.HeightUnit is { } heightUnit)
        {
            if (!Units.IsHeight(heightUnit))
            {
                return ApiResults.Error("Height is shown in cm or ftin.");
            }

            profile.HeightUnit = heightUnit;
        }

        if (request.FoodUnit is { } foodUnit)
        {
            if (!Units.IsFood(foodUnit))
            {
                return ApiResults.Error("Food is shown in g or oz.");
            }

            profile.FoodUnit = foodUnit;
        }

        if (request.FatLimits is { } fatLimits)
        {
            if (!FatLimits.IsValid(fatLimits))
            {
                return ApiResults.Error("Fat limits are normal or lower.");
            }

            profile.FatLimits = fatLimits;
        }

        if (request.SodiumLimit is { } sodiumLimit)
        {
            if (!SodiumLimits.IsValid(sodiumLimit))
            {
                return ApiResults.Error("The sodium limit is normal or lower.");
            }

            profile.SodiumLimit = sodiumLimit;
        }

        foreach (var (ids, apply) in new (string?[]?, Action<string[]>)[]
        {
            (request.HomeHidden, clean => profile.HomeHidden = clean),
            (request.MacrosHidden, clean => profile.MacrosHidden = clean),
            (request.ProgressHidden, clean => profile.ProgressHidden = clean),
        })
        {
            if (ids is null)
            {
                continue;
            }

            if (HiddenIds.Clean(ids) is not { } clean)
            {
                return ApiResults.Error(HiddenIds.Invalid);
            }

            apply(clean);
        }

        profile.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new SettingsResponse(
            profile.TimeZone, profile.TimeZoneFollowsDevice, FoodCountries.Home(profile), profile.FoodCountryFollowsZone, profile.WeightUnit, profile.HeightUnit, profile.FoodUnit, profile.FatLimits, profile.SodiumLimit,
            profile.HomeHidden, profile.MacrosHidden, profile.ProgressHidden));
    }

    /// <summary>
    /// The targets a saved profile would give. A profile edit keeps the measured burn;
    /// <paramref name="fresh"/> previews a fresh start instead, which goes back to the formula
    /// at the restarted trend, as accepting one does.
    /// </summary>
    private static async Task<IResult> Preview(
        ClaimsPrincipal principal,
        ProfileRequest request,
        bool? fresh,
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

        NutritionResult result;
        if (fresh == true)
        {
            weightKg = weight.TrendKg ?? weightKg;
            result = NutritionMath.Calculate(ProfileRules.ToInput(normalized, weightKg, today.Year));
        }
        else
        {
            var inEffect = await TargetBook.InEffectAsync(db, userId, today, cancellationToken);
            (result, _) = Retarget(ProfileRules.ToInput(normalized, weightKg, today.Year), inEffect, null);
        }

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
        var firstTargetDate = await TargetBook.FirstDateAsync(db, userId, cancellationToken);
        return Results.Ok(new { date = asOf, firstTargetDate, targets = ToTargets(targets) });
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
            profile.TimeZone,
            profile.TimeZoneFollowsDevice,
            FoodCountries.Home(profile),
            profile.FoodCountryFollowsZone,
            profile.WeightUnit,
            profile.HeightUnit,
            profile.FoodUnit,
            profile.FatLimits,
            profile.SodiumLimit,
            profile.HomeHidden,
            profile.MacrosHidden,
            profile.ProgressHidden);

    public static WeightResponse ToWeight(WeightSnapshot weight) => new(
        weight.AsOf,
        weight.TrendKg,
        weight.TrendState,
        weight.Reasons,
        weight.LatestKg,
        weight.LatestDate,
        weight.WeighInsInWindow,
        TrendWeight.WindowDays,
        weight.Series.BandKg,
        weight.Series.RateKgPerWeek,
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
            row.LatestReason,
            row.Reasons,
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
    string TimeZone,
    bool TimeZoneFollowsDevice,
    string FoodCountry,
    bool FoodCountryFollowsZone,
    string WeightUnit,
    string HeightUnit,
    string FoodUnit,
    string FatLimits,
    string SodiumLimit,
    string[]? HomeHidden,
    string[]? MacrosHidden,
    string[]? ProgressHidden);

/// <summary>
/// Display preferences. None of them changes the targets, so saving one writes no target history.
/// <see cref="FoodCountry"/> is an ISO code picked by hand; send <see cref="FoodCountryFollowsZone"/> false with it.
/// </summary>
public sealed record SettingsRequest(string? TimeZone, bool? TimeZoneFollowsDevice, string? WeightUnit = null, string? HeightUnit = null, string? FatLimits = null, string? FoodUnit = null, string? SodiumLimit = null,
    string?[]? HomeHidden = null, string?[]? MacrosHidden = null, string?[]? ProgressHidden = null, string? FoodCountry = null, bool? FoodCountryFollowsZone = null);

/// <summary>The hidden lists are null until the app first saves them. <see cref="FoodCountry"/> is the one in use.</summary>
public sealed record SettingsResponse(
    string TimeZone, bool TimeZoneFollowsDevice, string FoodCountry, bool FoodCountryFollowsZone, string WeightUnit, string HeightUnit, string FoodUnit, string FatLimits, string SodiumLimit,
    string[]? HomeHidden, string[]? MacrosHidden, string[]? ProgressHidden);

public sealed record WeightResponse(
    DateOnly AsOf,
    decimal? TrendKg,
    string? TrendState,
    IReadOnlyList<string> Reasons,
    decimal? LatestKg,
    DateOnly? LatestDate,
    int WeighInsInWindow,
    int WindowDays,
    decimal? BandKg,
    decimal? RateKgPerWeek,
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
    decimal? BandKg,
    bool RealWeighIn,
    bool Estimated,
    bool Gap,
    bool Measured);

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
    IReadOnlyList<string> Reasons,
    decimal WeightKg);

public sealed record ProfileStateResponse(
    ProfileResponse? Profile,
    WeightResponse Weight,
    TargetsResponse? Targets,
    string Citation,
    string OpenFoodFacts);

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
