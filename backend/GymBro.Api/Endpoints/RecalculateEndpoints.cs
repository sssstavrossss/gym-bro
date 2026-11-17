using System.Security.Claims;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Notifications;
using GymBro.Api.Nutrition;
using GymBro.Api.Profiles;
using GymBro.Api.Users;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Endpoints;

public static class RecalculateEndpoints
{
    public const string NeedProfile = "Save your profile before recalculating.";

    public const string NeedMode = "Say whether to use the adaptive target or the formula.";

    public static RouteGroupBuilder MapRecalculate(this RouteGroupBuilder api)
    {
        api.MapGet("/recalculate", Get);
        api.MapGet("/recalculate/banner", Banner);
        api.MapPost("/recalculate/banner/dismiss", DismissBanner);
        api.MapPost("/recalculate/preview", Preview);
        api.MapPost("/recalculate/decline", Decline);
        api.MapPost("/recalculate", Save);
        return api;
    }

    private static async Task<IResult> Banner(
        ClaimsPrincipal principal,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var state = await BannerState(Caller.Id(principal), db, clock, cancellationToken);
        return Results.Ok(new { show = state.Show, weekStart = state.WeekStart });
    }

    private static async Task<IResult> DismissBanner(
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
        var profile = await db.Profiles.FirstOrDefaultAsync(row => row.UserId == userId, cancellationToken);
        if (profile is null)
        {
            return ApiResults.Error(NeedProfile);
        }

        await NotificationBook.MarkCurrentWeekReadAsync(db, userId, clock, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private readonly record struct BannerView(bool Show, DateOnly? WeekStart);

    private static async Task<BannerView> BannerState(
        string userId,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var profile = await db.Profiles.FirstOrDefaultAsync(row => row.UserId == userId, cancellationToken);
        if (profile is null || !LocalDates.TryToday(profile.TimeZone, clock, out var today))
        {
            return new BannerView(false, null);
        }

        var week = RecalculateBanner.WeekStart(today);
        var row = await NotificationBook.EnsureCurrentWeekAsync(db, profile, clock, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        var show = row is not null && row.ReadAt is null;
        return new BannerView(show, week);
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

        var built = await BuildAsync(Caller.Id(principal), new HashSet<DateOnly>(), new HashSet<DateOnly>(), db, clock, cancellationToken);
        return built.Error is not null ? ApiResults.Error(built.Error) : Results.Ok(ToResponse(built));
    }

    private static async Task<IResult> Preview(
        ClaimsPrincipal principal,
        HttpRequest http,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var body = await ReadBody(http, cancellationToken);
        if (body.Error is not null)
        {
            return ApiResults.Error(body.Error);
        }

        var built = await BuildAsync(Caller.Id(principal), body.Exclude, body.IncludeZero, db, clock, cancellationToken);
        return built.Error is not null ? ApiResults.Error(built.Error) : Results.Ok(ToResponse(built));
    }

    private static async Task<IResult> Save(
        ClaimsPrincipal principal,
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

        var body = await ReadBody(http, cancellationToken);
        if (body.Error is not null)
        {
            return ApiResults.Error(body.Error);
        }

        if (body.Mode is not ("adaptive" or "formula"))
        {
            return ApiResults.Error(NeedMode);
        }

        await users.UpsertAsync(principal, cancellationToken);
        var userId = Caller.Id(principal);
        var built = await BuildAsync(userId, body.Exclude, body.IncludeZero, db, clock, cancellationToken);
        if (built.Error is not null || built.Review is null || built.WeightKg is not decimal weightKg)
        {
            return ApiResults.Error(built.Error ?? NeedProfile);
        }

        var review = built.Review;
        NutritionResult result;
        TargetBurn burn;
        string reason;
        if (body.Mode == "formula")
        {
            result = NutritionMath.Calculate(built.Input!);
            burn = TargetBurn.Formula(result, TargetDetails.From(review));
            reason = RecalculationReasons.Formula;
        }
        else
        {
            result = NutritionMath.FromExpenditure(built.Input!, review.Burn);
            burn = new TargetBurn(review.Formula.Tdee, review.BurnSdKcal, TargetDetails.From(review));
            reason = review.Measured ? RecalculationReasons.Adaptive : RecalculationReasons.Kept;
        }

        // Always a row, even with the same numbers: it is what starts the next period.
        var row = await TargetBook.StageAsync(
            db,
            userId,
            built.Today,
            result,
            burn,
            weightKg,
            [reason],
            clock.GetUtcNow(),
            cancellationToken);
        await NotificationBook.MarkCurrentWeekReadAsync(db, userId, clock, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { reason, burn = result.Tdee, targets = ProfileEndpoints.ToTargets(row) });
    }

    private static async Task<IResult> Decline(
        ClaimsPrincipal principal,
        HttpRequest http,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var body = await ReadBody(http, cancellationToken);
        if (body.Error is not null)
        {
            return ApiResults.Error(body.Error);
        }

        var userId = Caller.Id(principal);
        var built = await BuildAsync(userId, body.Exclude, body.IncludeZero, db, clock, cancellationToken);
        if (built.Error is not null || built.Review is null)
        {
            return ApiResults.Error(built.Error ?? NeedProfile);
        }

        var review = built.Review;
        var suggestion = review.Proposed;
        var kept = await TargetBook.InEffectAsync(db, userId, built.Today, cancellationToken);
        db.RecalculationDeclines.Add(new RecalculationDecline
        {
            UserId = userId,
            PeriodFrom = review.From,
            PeriodTo = review.To,
            SuggestedBmr = suggestion.Bmr,
            SuggestedTdee = suggestion.Tdee,
            SuggestedKcal = suggestion.Kcal,
            SuggestedProtein = suggestion.Protein,
            SuggestedFat = suggestion.Fat,
            SuggestedCarbs = suggestion.Carbs,
            KeptKcal = kept?.Kcal ?? suggestion.Kcal,
            CreatedAt = clock.GetUtcNow(),
        });
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { saved = false, suggestedKcal = suggestion.Kcal, keptKcal = kept?.Kcal ?? suggestion.Kcal });
    }

    private static async Task<Built> BuildAsync(
        string userId,
        IReadOnlySet<DateOnly> excluded,
        IReadOnlySet<DateOnly> includeZero,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var profile = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(row => row.UserId == userId, cancellationToken);
        if (profile is null || !LocalDates.TryToday(profile.TimeZone, clock, out var today) || !LocalDates.TryZone(profile.TimeZone, out var zone))
        {
            return Built.Failed(NeedProfile);
        }

        var history = await db.TargetHistories.AsNoTracking()
            .Where(row => row.UserId == userId)
            .OrderBy(row => row.EffectiveDate)
            .ToListAsync(cancellationToken);
        var current = history.LastOrDefault(row => row.EffectiveDate <= today);
        var weight = await WeightReader.ReadAsync(db, userId, today, cancellationToken);
        if (current is null || weight.UsedKg is not decimal weightKg)
        {
            return Built.Failed(NeedProfile);
        }

        var created = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(profile.CreatedAt, zone).DateTime);
        var firstLog = await db.LogEntries.AsNoTracking()
            .Where(row => row.UserId == userId && row.DeletedAt == null)
            .OrderBy(row => row.LocalDate)
            .Select(row => (DateOnly?)row.LocalDate)
            .FirstOrDefaultAsync(cancellationToken);
        var weighIns = weight.Series.Days
            .Where(day => day.Real && day.WeighInKg is not null)
            .Select(day => (day.Date, Kg: day.WeighInKg!.Value))
            .ToList();
        var lastStart = history.LastOrDefault(row => row.Reasons.Any(RecalculationReasons.StartsPeriod));
        var period = RecalculatePeriod.For(
            today,
            created,
            firstLog,
            lastStart?.EffectiveDate,
            RecalculatePeriod.LatestFreshStart(weighIns, today));

        var facts = new List<DayFact>();
        if (period.From <= period.To)
        {
            var rawLogs = await db.LogEntries.AsNoTracking()
                .Where(row => row.UserId == userId && row.DeletedAt == null && row.LocalDate >= period.From && row.LocalDate <= period.To)
                .Select(row => new { row.LocalDate, row.Kcal })
                .ToListAsync(cancellationToken);
            var byDay = rawLogs
                .GroupBy(row => row.LocalDate)
                .ToDictionary(group => group.Key, group => group.Sum(row => row.Kcal));
            for (var day = period.From; day <= period.To; day = day.AddDays(1))
            {
                var target = history.LastOrDefault(row => row.EffectiveDate <= day);
                var logged = byDay.TryGetValue(day, out var kcal);
                facts.Add(new DayFact(day, kcal, logged, target?.Kcal));
            }
        }

        var slope = weighIns.Where(row => row.Date >= period.SlopeFrom && row.Date <= today).ToList();
        var input = ProfileRules.ToInput(profile, weightKg, today.Year);
        var (prior, priorSd) = TargetBook.CarriedBurn(current, NutritionMath.Calculate(input));
        var review = AdaptiveTarget.Review(
            new ReviewInput(period.From, period.To, facts, slope, input, prior, priorSd),
            excluded,
            includeZero);
        return new Built(review, period, input, today, weightKg, null);
    }

    private static object ToResponse(Built built)
    {
        var review = built.Review!;
        var period = built.Period!;
        return new
        {
            from = review.From,
            to = review.To,
            periodDays = review.PeriodDays,
            capped = period.Capped,
            lastUpdate = period.LastUpdate,
            settledFrom = period.SettledFrom,
            lowDays = review.LowDays.Select(day => new
            {
                date = day.Date,
                kcal = day.Kcal,
                targetKcal = day.TargetKcal,
                included = day.Included,
            }),
            includedDays = review.IncludedDays,
            measured = review.Measured,
            blocked = review.Blocked,
            weighInsNeeded = review.WeighInsNeeded,
            averageKcal = review.AverageKcal is decimal eaten ? NutritionMath.Round(eaten) : (int?)null,
            fit = review.Fit is { } fit ? new
            {
                weighIns = fit.WeighIns,
                first = fit.First,
                last = fit.Last,
                rateKgPerWeek = decimal.Round(fit.RateKgPerWeek, 2, MidpointRounding.AwayFromZero),
            } : null,
            step = review.Step is { } step ? new
            {
                prior = NutritionMath.Round(step.Prior),
                measured = NutritionMath.Round(step.Measured),
                measuredSd = NutritionMath.Round(step.MeasuredSd),
                burn = NutritionMath.Round(step.Burn),
                gain = decimal.Round(step.Gain, 2, MidpointRounding.AwayFromZero),
            } : null,
            burn = review.Burn,
            burnSdKcal = review.BurnSdKcal,
            proposed = Target(review.Proposed),
            formula = Target(review.Formula),
            countedKcal = review.CountedKcal,
            leftOutKcal = review.LeftOutKcal,
            calendar = review.Calendar.Select(day => new
            {
                date = day.Date,
                kcal = day.Kcal,
                targetKcal = day.TargetKcal,
                status = day.Status,
                counted = day.Counted,
            }),
        };
    }

    private static object Target(ProposedTarget target) => new
    {
        bmr = target.Bmr,
        tdee = target.Tdee,
        kcal = target.Kcal,
        protein = target.Protein,
        fat = target.Fat,
        carbs = target.Carbs,
        floorApplied = target.FloorApplied,
    };

    private readonly record struct Built(
        AdaptiveReview? Review,
        RecalculatePeriod? Period,
        NutritionInput? Input,
        DateOnly Today,
        decimal? WeightKg,
        string? Error)
    {
        public static Built Failed(string error) => new(null, null, null, default, null, error);
    }

    private readonly record struct Body(HashSet<DateOnly> Exclude, HashSet<DateOnly> IncludeZero, string? Mode, string? Error);

    private static async Task<Body> ReadBody(HttpRequest http, CancellationToken cancellationToken)
    {
        try
        {
            using var json = await JsonDocument.ParseAsync(http.Body, cancellationToken: cancellationToken);
            var root = json.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return new Body([], [], null, NeedMode);
            }

            var exclude = ReadDates(root, "exclude");
            var includeZero = ReadDates(root, "includeZero");

            string? mode = null;
            if (root.TryGetProperty("mode", out var modeElement) && modeElement.ValueKind == JsonValueKind.String)
            {
                mode = modeElement.GetString();
            }

            return new Body(exclude, includeZero, mode, null);
        }
        catch (JsonException)
        {
            return new Body([], [], null, NeedMode);
        }
    }

    private static HashSet<DateOnly> ReadDates(JsonElement root, string name)
    {
        var dates = new HashSet<DateOnly>();
        if (root.TryGetProperty(name, out var list) && list.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in list.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String && DateOnly.TryParse(item.GetString(), out var date))
                {
                    dates.Add(date);
                }
            }
        }

        return dates;
    }
}
