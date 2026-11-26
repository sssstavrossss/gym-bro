using System.Security.Claims;
using GymBro.Api.Data;
using GymBro.Api.Profiles;

namespace GymBro.Api.Endpoints;

/// <summary>Settings → Reset data. The rules are in <see cref="DataReset"/>.</summary>
public static class ResetEndpoints
{
    public static RouteGroupBuilder MapReset(this RouteGroupBuilder api)
    {
        api.MapGet("/reset", Summary);
        api.MapPost("/reset/training", Training);
        api.MapPost("/reset/nutrition", Nutrition);
        return api;
    }

    private static async Task<IResult> Summary(ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var summary = await DataReset.SummaryAsync(db, Caller.Id(principal), cancellationToken);
        return Results.Ok(new
        {
            training = new { workouts = summary.Workouts, plan = summary.PlanGoal is null ? null : new { goal = summary.PlanGoal, split = summary.PlanSplit } },
            nutrition = new { entries = summary.Entries, days = summary.Days, foods = summary.Foods, recipes = summary.Recipes, groups = summary.Groups },
        });
    }

    private static async Task<IResult> Training(ClaimsPrincipal principal, AppDbContext db, ILogger<ResetSummary> logger, CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var done = await DataReset.TrainingAsync(db, userId, cancellationToken);
        logger.LogInformation("Training reset for {UserId}: {Workouts} workouts, plan {Plan}", userId, done.Workouts, done.Plan);
        return Results.Ok(new { workouts = done.Workouts, plan = done.Plan });
    }

    private static async Task<IResult> Nutrition(ClaimsPrincipal principal, NutritionResetRequest? request, AppDbContext db, ILogger<ResetSummary> logger, CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var done = await DataReset.NutritionAsync(db, userId, request?.Foods == true, cancellationToken);
        logger.LogInformation(
            "Nutrition reset for {UserId}: {Entries} entries, {Foods} foods, {Recipes} recipes, {Groups} groups",
            userId, done.Entries, done.Foods, done.Recipes, done.Groups);
        return Results.Ok(new { entries = done.Entries, foods = done.Foods, recipes = done.Recipes, groups = done.Groups });
    }
}

public sealed record NutritionResetRequest(bool Foods);
