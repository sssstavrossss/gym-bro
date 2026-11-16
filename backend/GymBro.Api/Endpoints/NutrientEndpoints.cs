using System.Security.Claims;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using GymBro.Api.Logging;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Endpoints;

/// <summary>Read-only views of the nutrient panel across days and foods, for the Home nutrient detail sheet.</summary>
public static class NutrientEndpoints
{
    public const string UnknownNutrient = "That nutrient is not known.";

    public static RouteGroupBuilder MapNutrients(this RouteGroupBuilder api)
    {
        api.MapGet("/nutrients/week", Week);
        api.MapGet("/nutrients/{key}/sources", Sources);
        return api;
    }

    private static async Task<IResult> Week(
        ClaimsPrincipal principal,
        string? date,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (!LogEntryRules.TryDate(date, out var to))
        {
            return ApiResults.Error(LogEntryRules.BadDate);
        }

        var userId = Caller.Id(principal);
        var from = NutrientWeek.FirstDay(to);
        var rows = await db.LogEntries.AsNoTracking()
            .Where(row => row.UserId == userId && row.DeletedAt == null && row.LocalDate >= from && row.LocalDate <= to)
            .ToListAsync(cancellationToken);
        var week = NutrientWeek.Average(rows);
        return Results.Ok(new { from, to, loggedDays = week.LoggedDays, average = week.Average });
    }

    private static async Task<IResult> Sources(
        ClaimsPrincipal principal,
        string key,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (!NutrientSources.IsKnown(key))
        {
            return ApiResults.Error(UnknownNutrient, StatusCodes.Status404NotFound);
        }

        var userId = Caller.Id(principal);
        var foodIds = await db.LogEntries.AsNoTracking()
            .Where(row => row.UserId == userId && row.DeletedAt == null && row.FoodId != null)
            .Select(row => row.FoodId!.Value)
            .Distinct()
            .ToListAsync(cancellationToken);
        // Catalogue foods, or this person's own. Another person's custom food never shows.
        var foods = await db.Foods.AsNoTracking()
            .Where(food => foodIds.Contains(food.Id) && (food.OwnerKey == Food.CatalogueOwnerKey || food.OwnerKey == userId))
            .ToListAsync(cancellationToken);
        return Results.Ok(new { nutrient = key, foods = NutrientSources.Rank(foods, key) });
    }
}
