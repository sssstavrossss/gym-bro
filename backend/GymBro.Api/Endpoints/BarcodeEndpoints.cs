using System.Security.Claims;
using GymBro.Api.Data;
using GymBro.Api.Foods;

namespace GymBro.Api.Endpoints;

public static class BarcodeEndpoints
{
    public static RouteGroupBuilder MapBarcode(this RouteGroupBuilder api)
    {
        api.MapGet("/foods/barcode/{code}", Lookup);
        return api;
    }

    /// <summary>The food for a barcode, as <c>{ code, status, food }</c>. A miss is a 200 with status
    /// <c>not_found</c>, so the app can offer to create the food; only a code that isn't 8 to 14 digits is a 400.</summary>
    private static async Task<IResult> Lookup(
        ClaimsPrincipal principal,
        string code,
        AppDbContext db,
        IOpenFoodFactsClient off,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var normalized = BarcodeLookup.Normalize(code);
        if (normalized is null)
        {
            return ApiResults.Error("A barcode is 8 to 14 digits.");
        }

        var userId = Caller.Id(principal);
        var outcome = await BarcodeLookup.FindAsync(db, off, clock, userId, normalized, cancellationToken);
        if (outcome.Food is not { } food)
        {
            return Results.Ok(new { code = normalized, status = outcome.Status, food = (object?)null });
        }

        var confirmed = await FoodEndpoints.ConfirmedBases(db, userId, [food], cancellationToken);
        var servings = await ServingEndpoints.ForFoods(db, userId, [food.Id], cancellationToken);
        return Results.Ok(new
        {
            code = normalized,
            status = outcome.Status,
            food = FoodEndpoints.ToResponse(food, confirmed.GetValueOrDefault(food.Id), servings.GetValueOrDefault(food.Id)),
        });
    }
}
