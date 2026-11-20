using System.Security.Claims;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Describe;
using GymBro.Api.Foods;
using GymBro.Api.Logging;
using GymBro.Api.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace GymBro.Api.Endpoints;

/// <summary>Whether this server can describe meals: a key is set, or a test model stands in.</summary>
public sealed record DescribeSwitch(bool On);

public static class DescribeEndpoints
{
    public const string Off = "Describe a meal isn't set up on this server.";

    public const string ModelDown = "Couldn't reach Claude just now. Try again, or use Search.";

    public const string Declined = "Claude couldn't read that as food. Try naming the foods.";

    public const string NothingFound = "No foods in that. Try naming what you ate, like “2 eggs and toast”.";

    public const string NothingInPhoto = "No foods in that photo. Try another, or write what you ate.";

    public const string DailyLimitReached = "That's the limit for Describe for now. Search still works.";

    public const string Missing = "No description with that id.";

    public const string NothingToKeep = "None of those foods can be logged.";

    public const int RecentLimit = 6;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static RouteGroupBuilder MapDescribe(this RouteGroupBuilder api)
    {
        api.MapGet("/describe", Overview);
        api.MapPost("/describe", Describe);
        api.MapGet("/describe/{id:guid}", Get);
        api.MapPost("/describe/{id:guid}/logged", Logged);
        return api;
    }

    private static async Task<IResult> Overview(
        ClaimsPrincipal principal,
        AppDbContext db,
        DescribeSwitch describe,
        IOptions<DescribeOptions> options,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (!describe.On)
        {
            return Results.Ok(new { available = false, limit = 0, left = 0, nextAt = (DateTimeOffset?)null, recent = Array.Empty<object>() });
        }

        var userId = Caller.Id(principal);
        var quota = await DescribeQuota.ReadAsync(db, userId, options.Value.DailyLimit, clock.GetUtcNow(), cancellationToken);
        var logged = await db.MealDescriptions.AsNoTracking()
            .Where(row => row.UserId == userId && row.LoggedAt != null && row.Outcome == MealOutcomes.Found)
            .OrderByDescending(row => row.LoggedAt)
            .Take(RecentLimit * 4)
            .ToListAsync(cancellationToken);
        // The same words twice are one recent. Every photo is its own.
        var recent = logged
            .DistinctBy(row => row.HasPhoto ? row.Id.ToString() : LogEntryRules.Collapse(row.Text).ToLowerInvariant())
            .Take(RecentLimit)
            .Select(row => new
            {
                id = row.Id,
                text = row.Text,
                photo = row.HasPhoto,
                seen = row.HasPhoto ? Seen(Read(row.Items).Select(item => item.Name)) : null,
                foods = row.FoodCount,
                kcal = row.Kcal,
                loggedAt = row.LoggedAt,
            })
            .ToList();
        return Results.Ok(new { available = true, limit = quota.Limit, left = quota.Left, nextAt = quota.NextAt, recent });
    }

    private static async Task<IResult> Describe(
        ClaimsPrincipal principal,
        DescribeRequest request,
        AppDbContext db,
        UserDirectory users,
        DescribeSwitch describe,
        IOptions<DescribeOptions> options,
        IMealModel model,
        MealDescriber describer,
        TimeProvider clock,
        ILogger<MealDescriber> logger,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (!describe.On)
        {
            return ApiResults.Error(Off, StatusCodes.Status404NotFound);
        }

        MealPhoto? photo = null;
        if (request.Photo is { } sent)
        {
            (photo, var unusable) = MealPhoto.Read(sent.MediaType, sent.Data);
            if (unusable is not null)
            {
                return ApiResults.Error(unusable);
            }
        }

        if (MealDescriber.RejectText(request.Text, photo is not null) is { } invalid)
        {
            return ApiResults.Error(invalid);
        }

        var userId = Caller.Id(principal);
        var now = clock.GetUtcNow();
        var quota = await DescribeQuota.ReadAsync(db, userId, options.Value.DailyLimit, now, cancellationToken);
        if (quota.Left == 0)
        {
            logger.LogInformation("Describe for {UserId}: over the limit ({Used} of {Limit})", userId, quota.Used, quota.Limit);
            return ApiResults.Error(DailyLimitReached, StatusCodes.Status429TooManyRequests);
        }

        await users.UpsertAsync(principal, cancellationToken);
        var text = (request.Text ?? "").Trim();
        var retryOf = request.RetryOf is { } earlier
            && await db.MealDescriptions.AnyAsync(row => row.Id == earlier && row.UserId == userId, cancellationToken)
                ? earlier
                : (Guid?)null;
        var usage = new MealUsage();
        var started = clock.GetTimestamp();
        IReadOnlyList<DescribedItem> items = [];
        string outcome;
        try
        {
            items = await describer.DescribeAsync(userId, new MealNote(text, photo), usage, cancellationToken);
            outcome = items.Count == 0 ? MealOutcomes.Nothing : MealOutcomes.Found;
        }
        catch (MealModelException ex)
        {
            outcome = ex.Refused ? MealOutcomes.Declined : MealOutcomes.Failed;
        }

        var row = new MealDescription
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Text = text,
            HasPhoto = photo is not null,
            CreatedAt = now,
            Outcome = outcome,
            Model = Clip(model.Name, 64),
            Calls = usage.Calls,
            InputTokens = usage.InputTokens,
            OutputTokens = usage.OutputTokens,
            DurationMs = (int)Math.Min(int.MaxValue, clock.GetElapsedTime(started).TotalMilliseconds),
            RetryOf = retryOf,
        };
        if (outcome == MealOutcomes.Found)
        {
            var stored = items.Select(item => new StoredItem(item.Phrase, item.Name, item.Guessed, item.Food?.Id, item.Amount, item.Unit)).ToList();
            var matched = items.Where(item => item.Food is not null).Select(item => item.Food!).DistinctBy(food => food.Id).ToList();
            var servings = await ServingEndpoints.ForFoods(db, userId, matched.Select(food => food.Id), cancellationToken);
            Summarize(row, stored, matched.ToDictionary(food => food.Id), servings);
        }

        db.MealDescriptions.Add(row);
        await db.SaveChangesAsync(cancellationToken);
        var left = outcome == MealOutcomes.Failed ? quota.Left : quota.Left - 1;
        logger.LogInformation(
            "Describe for {UserId}: {Outcome}, photo {Photo}, {Found} of {Foods} foods matched, {Calls} calls, {InputTokens} input and {OutputTokens} output tokens, {DurationMs} ms, {Left} of {Limit} left, retry of {RetryOf}",
            userId, outcome, row.HasPhoto, items.Count(item => item.Food is not null), items.Count, row.Calls, row.InputTokens, row.OutputTokens, row.DurationMs, left, quota.Limit, retryOf);

        return outcome switch
        {
            MealOutcomes.Found => Results.Ok(await ResponseAsync(db, userId, row, items, left, cancellationToken)),
            MealOutcomes.Nothing => ApiResults.Error(row.HasPhoto ? NothingInPhoto : NothingFound, StatusCodes.Status422UnprocessableEntity),
            MealOutcomes.Declined => ApiResults.Error(Declined, StatusCodes.Status422UnprocessableEntity),
            _ => ApiResults.Error(ModelDown, StatusCodes.Status503ServiceUnavailable),
        };
    }

    private static async Task<IResult> Get(
        ClaimsPrincipal principal,
        Guid id,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var row = await db.MealDescriptions.AsNoTracking()
            .FirstOrDefaultAsync(found => found.Id == id && found.UserId == userId && found.Outcome == MealOutcomes.Found, cancellationToken);
        if (row is null)
        {
            return ApiResults.Error(Missing, StatusCodes.Status404NotFound);
        }

        var stored = Read(row.Items);
        var foods = await FoodsAsync(db, userId, stored, cancellationToken);
        var items = stored
            .Select(item => item.FoodId is { } foodId && foods.TryGetValue(foodId, out var food)
                ? new DescribedItem(item.Phrase, item.Name, item.Guessed, food, item.Amount, item.Unit)
                : new DescribedItem(item.Phrase, item.Name, item.Guessed, null, 0, ""))
            .ToList();
        return Results.Ok(await ResponseAsync(db, userId, row, items, null, cancellationToken));
    }

    /// <summary>The foods as they were added, so using this description again gives the same amounts.</summary>
    private static async Task<IResult> Logged(
        ClaimsPrincipal principal,
        Guid id,
        LoggedRequest request,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var row = await db.MealDescriptions
            .FirstOrDefaultAsync(found => found.Id == id && found.UserId == userId && found.Outcome == MealOutcomes.Found, cancellationToken);
        if (row is null)
        {
            return ApiResults.Error(Missing, StatusCodes.Status404NotFound);
        }

        var sent = (request.Items ?? [])
            .Take(MealDescriber.PartsMax)
            .Select(item => new StoredItem(
                Clip(item.Phrase, 200),
                Clip(item.Name, 120),
                item.Guessed,
                item.FoodId,
                item.Amount,
                LogEntryRules.CanonicalUnit(item.Unit) ?? ""))
            .ToList();
        var foods = await FoodsAsync(db, userId, sent, cancellationToken);
        var servings = await ServingEndpoints.ForFoods(db, userId, foods.Keys, cancellationToken);
        var kept = sent
            .Where(item => item.FoodId is { } foodId
                && foods.TryGetValue(foodId, out var food)
                && UnitKcal(food, item, servings.GetValueOrDefault(foodId)) is not null)
            .ToList();
        if (kept.Count == 0)
        {
            return ApiResults.Error(NothingToKeep);
        }

        Summarize(row, kept, foods, servings);
        row.LoggedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static void Summarize(
        MealDescription row,
        IReadOnlyList<StoredItem> items,
        IReadOnlyDictionary<Guid, Food> foods,
        IReadOnlyDictionary<Guid, List<UserServing>> servings)
    {
        row.Items = JsonSerializer.Serialize(items, Json);
        var matched = items.Where(item => item.FoodId is { } foodId && foods.ContainsKey(foodId)).ToList();
        row.FoodCount = matched.Count;
        row.Kcal = decimal.Round(
            matched.Sum(item => UnitKcal(foods[item.FoodId!.Value], item, servings.GetValueOrDefault(item.FoodId!.Value)) ?? 0),
            1,
            MidpointRounding.AwayFromZero);
    }

    private static decimal? UnitKcal(Food food, StoredItem item, IReadOnlyList<UserServing>? servings)
    {
        var own = LogEntryRules.NormalizeUnit(item.Unit) is null
            ? servings?.FirstOrDefault(serving => string.Equals(serving.Name, item.Unit, StringComparison.OrdinalIgnoreCase))?.Grams
            : null;
        return MealDescriber.Kcal(food, item.Amount, item.Unit, own);
    }

    private static async Task<object> ResponseAsync(
        AppDbContext db,
        string userId,
        MealDescription row,
        IReadOnlyList<DescribedItem> items,
        int? left,
        CancellationToken cancellationToken)
    {
        var foods = items.Where(item => item.Food is not null).Select(item => item.Food!).DistinctBy(food => food.Id).ToList();
        var confirmed = await FoodEndpoints.ConfirmedBases(db, userId, foods, cancellationToken);
        var servings = await ServingEndpoints.ForFoods(db, userId, foods.Select(food => food.Id), cancellationToken);
        return new
        {
            id = row.Id,
            text = row.Text,
            photo = row.HasPhoto,
            seen = row.HasPhoto ? Seen(items.Select(item => item.Name)) : null,
            left,
            items = items.Select(item => new
            {
                phrase = item.Phrase,
                name = item.Name,
                guessed = item.Guessed,
                food = item.Food is { } food
                    ? FoodEndpoints.ToResponse(food, confirmed.GetValueOrDefault(food.Id), servings.GetValueOrDefault(food.Id))
                    : null,
                amount = item.Amount,
                unit = item.Unit,
            }).ToList(),
        };
    }

    private static async Task<Dictionary<Guid, Food>> FoodsAsync(
        AppDbContext db,
        string userId,
        IEnumerable<StoredItem> items,
        CancellationToken cancellationToken)
    {
        var ids = items.Where(item => item.FoodId is not null).Select(item => item.FoodId!.Value).Distinct().ToArray();
        if (ids.Length == 0)
        {
            return [];
        }

        return await FoodCatalog.Visible(db.Foods.AsNoTracking(), userId)
            .Where(food => ids.Contains(food.Id))
            .ToDictionaryAsync(food => food.Id, cancellationToken);
    }

    private static List<StoredItem> Read(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<List<StoredItem>>(json, Json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>
    /// What Claude saw in a photo, from the foods' plain names: "Fried egg, rice, cherry tomatoes". The photo
    /// isn't kept, so this is how a recent one is told apart.
    /// </summary>
    public static string Seen(IEnumerable<string> names)
    {
        var seen = string.Join(", ", names
            .Select(name => LogEntryRules.Collapse(name))
            .Where(name => name.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase));
        return Clip(seen.Length > 0 ? char.ToUpperInvariant(seen[0]) + seen[1..] : seen, 120);
    }

    private static string Clip(string? value, int max)
    {
        var text = LogEntryRules.Collapse(value);
        return text.Length <= max ? text : text[..max];
    }

    private sealed record StoredItem(string Phrase, string Name, bool Guessed, Guid? FoodId, decimal Amount, string Unit);
}

/// <summary>Words, a photo, or both. <see cref="Photo"/> is base64 with its image type.</summary>
public sealed record DescribeRequest(string? Text, Guid? RetryOf = null, PhotoRequest? Photo = null);

public sealed record PhotoRequest(string? MediaType, string? Data);

public sealed record LoggedRequest(List<LoggedItem>? Items);

public sealed record LoggedItem(string? Phrase, string? Name, bool Guessed, Guid? FoodId, decimal Amount, string? Unit);
