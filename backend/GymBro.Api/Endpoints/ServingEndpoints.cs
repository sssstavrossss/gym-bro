using System.Security.Claims;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Logging;
using GymBro.Api.Users;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Endpoints;

public static class ServingEndpoints
{
    public const string MissingServing = "No serving with that id.";

    public static RouteGroupBuilder MapServings(this RouteGroupBuilder api)
    {
        api.MapPost("/foods/{id:guid}/servings", Create);
        api.MapPut("/foods/{id:guid}/servings/{servingId:guid}", Update);
        api.MapDelete("/foods/{id:guid}/servings/{servingId:guid}", Delete);
        return api;
    }

    public static async Task<Dictionary<Guid, List<UserServing>>> ForFoods(
        AppDbContext db,
        string userId,
        IEnumerable<Guid> foodIds,
        CancellationToken cancellationToken)
    {
        var ids = foodIds.Distinct().ToArray();
        if (ids.Length == 0)
        {
            return [];
        }

        var rows = await db.UserServings.AsNoTracking()
            .Where(row => row.UserId == userId && ids.Contains(row.FoodId))
            .OrderBy(row => row.Name)
            .ThenBy(row => row.Id)
            .ToListAsync(cancellationToken);
        return rows.GroupBy(row => row.FoodId).ToDictionary(group => group.Key, group => group.ToList());
    }

    public static object ToJson(UserServing serving) => new
    {
        id = serving.Id,
        name = serving.Name,
        grams = serving.Grams,
    };

    public static IReadOnlyList<object> ToJsonList(IReadOnlyList<UserServing>? servings) =>
        (servings ?? []).Select(ToJson).ToList();

    private static async Task<IResult> Create(
        ClaimsPrincipal principal,
        Guid id,
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

        var body = await Read(http, cancellationToken);
        if (body.Error is not null)
        {
            return ApiResults.Error(body.Error);
        }

        await users.UpsertAsync(principal, cancellationToken);
        var userId = Caller.Id(principal);
        var food = await VisibleFood(db, userId, id, cancellationToken);
        if (food is null)
        {
            return ApiResults.Error(LogEntryEndpoints.MissingFood, StatusCodes.Status404NotFound);
        }

        var basis = RejectBasis(food);
        if (basis is not null)
        {
            return ApiResults.Error(basis);
        }

        var name = body.Name!;
        var key = name.ToLowerInvariant();
        var taken = await db.UserServings.AnyAsync(
            row => row.UserId == userId && row.FoodId == food.Id && row.NameKey == key,
            cancellationToken);
        if (taken)
        {
            return ApiResults.Error(LogEntryRules.DuplicateServing);
        }

        var serving = new UserServing
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            FoodId = food.Id,
            Name = name,
            NameKey = key,
            Grams = LogEntryRules.Round2(body.Grams),
            UpdatedAt = clock.GetUtcNow(),
        };
        db.UserServings.Add(serving);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            return ApiResults.Error(LogEntryRules.DuplicateServing);
        }

        return Results.Json(ToJson(serving), statusCode: StatusCodes.Status201Created);
    }

    private static async Task<IResult> Update(
        ClaimsPrincipal principal,
        Guid id,
        Guid servingId,
        HttpRequest http,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var body = await Read(http, cancellationToken);
        if (body.Error is not null)
        {
            return ApiResults.Error(body.Error);
        }

        var userId = Caller.Id(principal);
        var food = await VisibleFood(db, userId, id, cancellationToken);
        if (food is null)
        {
            return ApiResults.Error(LogEntryEndpoints.MissingFood, StatusCodes.Status404NotFound);
        }

        var basis = RejectBasis(food);
        if (basis is not null)
        {
            return ApiResults.Error(basis);
        }

        var serving = await db.UserServings.FirstOrDefaultAsync(
            row => row.Id == servingId && row.UserId == userId && row.FoodId == food.Id,
            cancellationToken);
        if (serving is null)
        {
            return ApiResults.Error(MissingServing, StatusCodes.Status404NotFound);
        }

        var name = body.Name!;
        var key = name.ToLowerInvariant();
        var taken = await db.UserServings.AnyAsync(
            row => row.UserId == userId && row.FoodId == food.Id && row.NameKey == key && row.Id != serving.Id,
            cancellationToken);
        if (taken)
        {
            return ApiResults.Error(LogEntryRules.DuplicateServing);
        }

        serving.Name = name;
        serving.NameKey = key;
        serving.Grams = LogEntryRules.Round2(body.Grams);
        serving.UpdatedAt = clock.GetUtcNow();
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            return ApiResults.Error(LogEntryRules.DuplicateServing);
        }

        return Results.Ok(ToJson(serving));
    }

    private static async Task<IResult> Delete(
        ClaimsPrincipal principal,
        Guid id,
        Guid servingId,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var serving = await db.UserServings.FirstOrDefaultAsync(
            row => row.Id == servingId && row.UserId == userId && row.FoodId == id,
            cancellationToken);
        if (serving is null)
        {
            return ApiResults.Error(MissingServing, StatusCodes.Status404NotFound);
        }

        db.UserServings.Remove(serving);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// A gram serving needs a food stored per 100 g. Liquids and per-serving foods have no gram basis.
    /// </summary>
    public static string? RejectBasis(Food food)
    {
        if (food.NutrientBasis == NutrientBases.PerServing)
        {
            return LogEntryRules.PerServingUnit;
        }

        if (food.Basis == "ml")
        {
            return LogEntryRules.MeasuredInMillilitres;
        }

        if (food.NutrientBasis != NutrientBases.Per100 || food.Basis != "g")
        {
            return LogEntryRules.NoGramBasis;
        }

        return null;
    }

    private static async Task<Food?> VisibleFood(AppDbContext db, string userId, Guid id, CancellationToken cancellationToken) =>
        await db.Foods.AsNoTracking().FirstOrDefaultAsync(
            row => row.Id == id && row.RetiredAt == null && (row.UserId == null || row.UserId == userId),
            cancellationToken);

    private static async Task<(string? Name, decimal Grams, string? Error)> Read(HttpRequest http, CancellationToken cancellationToken)
    {
        JsonDocument json;
        try
        {
            json = await JsonDocument.ParseAsync(http.Body, cancellationToken: cancellationToken);
        }
        catch (JsonException)
        {
            return (null, 0, LogEntryRules.BadNumber);
        }

        using (json)
        {
            var root = json.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return (null, 0, LogEntryRules.BadNumber);
            }

            var nameError = LogEntryRules.RejectServingName(Text(root, "name"), out var name);
            if (nameError is not null)
            {
                return (null, 0, nameError);
            }

            if (!root.TryGetProperty("grams", out var gramsElement) || !LogEntryRules.TryFlexible(gramsElement, out var grams))
            {
                return (null, 0, LogEntryRules.BadNumber);
            }

            var gramsError = LogEntryRules.RejectServingGrams(grams);
            if (gramsError is not null)
            {
                return (null, 0, gramsError);
            }

            return (name, grams, null);
        }
    }

    private static string? Text(JsonElement json, string name) =>
        json.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
