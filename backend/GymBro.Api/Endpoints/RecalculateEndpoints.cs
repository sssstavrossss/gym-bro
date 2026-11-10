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

    public const string NotEnough = "There is not enough of your own data for an adaptive target.";

    public static RouteGroupBuilder MapRecalculate(this RouteGroupBuilder api)
    {
        api.MapGet("/recalculate", Get);
        api.MapGet("/recalculate/banner", Banner);
        api.MapPost("/recalculate/banner/dismiss", DismissBanner);
        api.MapPost("/recalculate/preview", Preview);
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

        var built = await BuildAsync(Caller.Id(principal), new HashSet<DateOnly>(), db, clock, cancellationToken);
        return built.Error is not null ? ApiResults.Error(built.Error) : Results.Ok(ToResponse(built.Review!));
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

        var built = await BuildAsync(Caller.Id(principal), body.Exclude, db, clock, cancellationToken);
        return built.Error is not null ? ApiResults.Error(built.Error) : Results.Ok(ToResponse(built.Review!));
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
        var built = await BuildAsync(userId, body.Exclude, db, clock, cancellationToken);
        if (built.Error is not null || built.Review is null || built.Profile is null || built.WeightKg is not decimal weightKg)
        {
            return ApiResults.Error(built.Error ?? NeedProfile);
        }

        var review = built.Review;
        NutritionResult result;
        string reason;
        if (body.Mode == "formula")
        {
            result = NutritionMath.Calculate(built.Input!);
            reason = RecalculationReasons.Formula;
        }
        else
        {
            if (!review.Enough || review.Proposed is null || review.Burn is not decimal burn)
            {
                return ApiResults.Error(review.Blocked ?? NotEnough);
            }

            result = NutritionMath.FromExpenditure(built.Input!, burn, built.ManualKcal);
            reason = RecalculationReasons.Adaptive;
        }

        await TargetBook.StageAsync(
            db,
            userId,
            built.Today,
            result,
            weightKg,
            [reason],
            clock.GetUtcNow(),
            cancellationToken);
        await NotificationBook.MarkCurrentWeekReadAsync(db, userId, clock, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        var saved = await BuildAsync(userId, body.Exclude, db, clock, cancellationToken);
        return Results.Ok(ToResponse(saved.Review!));
    }

    private static async Task<Built> BuildAsync(
        string userId,
        IReadOnlySet<DateOnly> excluded,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var profile = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(row => row.UserId == userId, cancellationToken);
        if (profile is null || !LocalDates.TryToday(profile.TimeZone, clock, out var today) || !LocalDates.TryZone(profile.TimeZone, out var zone))
        {
            return new Built(null, null, null, default, null, null, NeedProfile);
        }

        var history = await db.TargetHistories.AsNoTracking()
            .Where(row => row.UserId == userId)
            .OrderBy(row => row.EffectiveDate)
            .ToListAsync(cancellationToken);
        var current = history.LastOrDefault(row => row.EffectiveDate <= today);
        if (current is null)
        {
            return new Built(null, null, null, today, null, null, NeedProfile);
        }

        var last = history.LastOrDefault(row => row.Reasons.Any(RecalculationReasons.IsRecalculation));
        var created = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(profile.CreatedAt, zone).DateTime);
        var firstLog = await db.LogEntries.AsNoTracking()
            .Where(row => row.UserId == userId && row.DeletedAt == null)
            .OrderBy(row => row.LocalDate)
            .Select(row => (DateOnly?)row.LocalDate)
            .FirstOrDefaultAsync(cancellationToken);
        var origin = firstLog is DateOnly logged && logged < created ? logged : created;
        var from = last is null ? origin : last.EffectiveDate.AddDays(1);
        var to = today.AddDays(-1);

        var logs = new List<(DateOnly Date, decimal Kcal)>();
        var fasting = new HashSet<DateOnly>();
        if (from <= to)
        {
            var rawLogs = await db.LogEntries.AsNoTracking()
                .Where(row => row.UserId == userId && row.DeletedAt == null && row.LocalDate >= from && row.LocalDate <= to)
                .Select(row => new { row.LocalDate, row.Kcal })
                .ToListAsync(cancellationToken);
            logs = rawLogs
                .GroupBy(row => row.LocalDate)
                .Select(group => (group.Key, group.Sum(row => row.Kcal)))
                .ToList();
            fasting = (await db.DayStatuses.AsNoTracking()
                .Where(row => row.UserId == userId && row.Fasting && row.LocalDate >= from && row.LocalDate <= to)
                .Select(row => row.LocalDate)
                .ToListAsync(cancellationToken)).ToHashSet();
        }

        var byDay = logs.ToDictionary(row => row.Date, row => row.Kcal);
        var facts = new List<DayFact>();
        if (from <= to)
        {
            for (var day = from; day <= to; day = day.AddDays(1))
            {
                var target = history.LastOrDefault(row => row.EffectiveDate <= day);
                byDay.TryGetValue(day, out var kcal);
                facts.Add(new DayFact(day, kcal, byDay.ContainsKey(day), fasting.Contains(day), target?.Kcal));
            }
        }

        var weighIns = await db.WeighIns.AsNoTracking()
            .Where(row => row.UserId == userId && row.LocalDate <= (to < from ? today : to))
            .OrderBy(row => row.LocalDate)
            .Select(row => new { row.LocalDate, row.Kg })
            .ToListAsync(cancellationToken);
        var series = weighIns.Select(row => (row.LocalDate, row.Kg)).ToList();
        decimal? trendStart = from <= to ? TrendWeight.Compute(series, from).TrendKg : null;
        decimal? trendEnd = from <= to ? TrendWeight.Compute(series, to).TrendKg : null;
        var onOrBefore = weighIns.Any(row => row.LocalDate <= from);
        var inside = weighIns.Any(row => row.LocalDate >= from && row.LocalDate <= to);
        var weight = await WeightReader.ReadAsync(db, userId, today, cancellationToken);
        if (weight.UsedKg is not decimal weightKg)
        {
            return new Built(null, null, null, today, null, null, NeedProfile);
        }

        var manual = current.Reasons.Any(reason => reason is TargetReasons.ManualChanged or TargetReasons.ModeSwitch);
        var input = ProfileRules.ToInput(profile, weightKg, today.Year);
        var review = AdaptiveTarget.Review(
            from,
            to,
            facts,
            excluded,
            trendStart,
            trendEnd,
            onOrBefore,
            inside,
            input,
            manual ? current.Kcal : null);
        return new Built(review, input, profile, today, weightKg, manual ? current.Kcal : null, null);
    }

    private static object ToResponse(AdaptiveReview review) => new
    {
        from = review.From,
        to = review.To,
        periodDays = review.PeriodDays,
        days = review.Days.Select(day => new
        {
            date = day.Date,
            kcal = day.Kcal,
            targetKcal = day.TargetKcal,
            fasting = day.Fasting,
            canExclude = day.CanExclude,
            included = day.Included,
        }),
        includedDays = review.IncludedDays,
        enough = review.Enough,
        blocked = review.Blocked,
        trendStartKg = review.TrendStartKg,
        trendEndKg = review.TrendEndKg,
        trendChangeKg = review.TrendChangeKg,
        averageKcal = review.AverageKcal,
        burn = review.Burn,
        proposed = Target(review.Proposed),
        formula = Target(review.Formula),
    };

    private static object? Target(ProposedTarget? target) => target is null ? null : new
    {
        bmr = target.Bmr,
        tdee = target.Tdee,
        kcal = target.Kcal,
        protein = target.Protein,
        fat = target.Fat,
        carbs = target.Carbs,
        floorApplied = target.FloorApplied,
        manualKept = target.ManualKept,
    };

    private readonly record struct Built(
        AdaptiveReview? Review,
        NutritionInput? Input,
        Profile? Profile,
        DateOnly Today,
        decimal? WeightKg,
        int? ManualKcal,
        string? Error);

    private readonly record struct Body(HashSet<DateOnly> Exclude, string? Mode, string? Error);

    private static async Task<Body> ReadBody(HttpRequest http, CancellationToken cancellationToken)
    {
        try
        {
            using var json = await JsonDocument.ParseAsync(http.Body, cancellationToken: cancellationToken);
            var root = json.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return new Body([], null, NeedMode);
            }

            var exclude = new HashSet<DateOnly>();
            if (root.TryGetProperty("exclude", out var list) && list.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in list.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.String && DateOnly.TryParse(item.GetString(), out var date))
                    {
                        exclude.Add(date);
                    }
                }
            }

            string? mode = null;
            if (root.TryGetProperty("mode", out var modeElement) && modeElement.ValueKind == JsonValueKind.String)
            {
                mode = modeElement.GetString();
            }

            return new Body(exclude, mode, null);
        }
        catch (JsonException)
        {
            return new Body([], null, NeedMode);
        }
    }
}
