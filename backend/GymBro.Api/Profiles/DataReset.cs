using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Profiles;

/// <summary>What Settings → Reset data shows before a reset: the caller's own rows, counted.</summary>
public sealed record ResetSummary(int Workouts, string? PlanGoal, string? PlanSplit, int Entries, int Days, int Foods, int Recipes, int Groups);

/// <summary>What a reset deleted.</summary>
public sealed record ResetDone(int Workouts, bool Plan, int Entries, int Foods, int Recipes, int Groups);

/// <summary>
/// Settings → Reset data (README → Reset data): start training or nutrition over without touching the other.
/// Every query is scoped by the caller's oid. Neither reset touches the profile, settings, weigh-ins or targets.
/// </summary>
public static class DataReset
{
    public static async Task<ResetSummary> SummaryAsync(AppDbContext db, string userId, CancellationToken cancellationToken)
    {
        var workouts = await db.WorkoutSessions.CountAsync(row => row.UserId == userId, cancellationToken);
        var plan = await db.TrainingPlans.AsNoTracking().Where(row => row.UserId == userId)
            .Select(row => new { row.Goal, row.Split }).FirstOrDefaultAsync(cancellationToken);
        var live = db.LogEntries.Where(row => row.UserId == userId && row.DeletedAt == null);
        var entries = await live.CountAsync(cancellationToken);
        var days = await live.Select(row => row.LocalDate).Distinct().CountAsync(cancellationToken);
        var foods = await db.Foods.CountAsync(row => row.UserId == userId && row.RetiredAt == null, cancellationToken);
        var recipes = await db.Recipes.CountAsync(row => row.UserId == userId && row.RetiredAt == null, cancellationToken);
        var groups = await db.EntryGroups.CountAsync(row => row.UserId == userId && row.DeletedAt == null, cancellationToken);
        return new ResetSummary(workouts, plan?.Goal, plan?.Split, entries, days, foods, recipes, groups);
    }

    /// <summary>Every workout (its sets go with it) and the plan. Workout descriptions stay: they count toward Describe's limit.</summary>
    public static async Task<ResetDone> TrainingAsync(AppDbContext db, string userId, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var workouts = await db.WorkoutSessions.CountAsync(row => row.UserId == userId, cancellationToken);
        await db.WorkoutSets.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await db.WorkoutSessions.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        var plans = await db.TrainingPlans.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new ResetDone(workouts, plans > 0, 0, 0, 0, 0);
    }

    /// <summary>
    /// The food log (deleted entries too), closed and fasting days, and the logged-meal list Describe offers again.
    /// With <paramref name="foods"/>, also the caller's own foods (their servings and basis checks go with them),
    /// recipes and saved groups; a serving of their own on a catalogue food stays. Meal
    /// descriptions stay as usage rows (they count toward the daily limit) but are no longer offered as recent.
    /// </summary>
    public static async Task<ResetDone> NutritionAsync(AppDbContext db, string userId, bool foods, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var entries = await db.LogEntries.CountAsync(row => row.UserId == userId && row.DeletedAt == null, cancellationToken);
        await db.LogEntries.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await db.DayStatuses.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        await db.MealDescriptions.Where(row => row.UserId == userId && row.Kind == MealKinds.Meal && row.LoggedAt != null)
            .ExecuteUpdateAsync(set => set.SetProperty(row => row.LoggedAt, (DateTimeOffset?)null), cancellationToken);

        int ownFoods = 0, recipes = 0, groups = 0;
        if (foods)
        {
            groups = await db.EntryGroups.CountAsync(row => row.UserId == userId && row.DeletedAt == null, cancellationToken);
            recipes = await db.Recipes.CountAsync(row => row.UserId == userId && row.RetiredAt == null, cancellationToken);
            ownFoods = await db.Foods.CountAsync(row => row.UserId == userId && row.RetiredAt == null, cancellationToken);
            await db.EntryGroupItems.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
            await db.EntryGroups.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
            await db.RecipeIngredients.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
            await db.Recipes.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
            await db.Foods.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return new ResetDone(0, false, entries, ownFoods, recipes, groups);
    }
}
