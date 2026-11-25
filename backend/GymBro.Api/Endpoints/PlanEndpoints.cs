using System.Security.Claims;
using GymBro.Api.Data;
using GymBro.Api.Logging;
using GymBro.Api.Training;
using GymBro.Api.Users;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Endpoints;

public sealed record PlanView(
    Guid Id,
    string Goal,
    IReadOnlyList<int> Weekdays,
    int Minutes,
    string Experience,
    IReadOnlyList<string> Equipment,
    IReadOnlyList<string> GoEasy,
    bool EaseIn,
    string Split,
    int BlockWeeks,
    DateOnly StartDate,
    DateTimeOffset UpdatedAt,
    IReadOnlyList<PlanWorkout> Workouts,
    int? LastPosition);

/// <summary>What a set of answers would make, before it's saved.</summary>
public sealed record PlanPreview(string Split, bool EaseIn, int BlockWeeks, IReadOnlyList<PlanWorkout> Workouts);

/// <summary>
/// The training plan (docs/training.md, phase 3). One per person: PUT makes it from the setup's answers or
/// remakes it after a change, and the generator's rules live in <see cref="PlanGenerator"/>. Every query is
/// scoped by the caller's oid.
/// </summary>
public static class PlanEndpoints
{
    public static RouteGroupBuilder MapPlans(this RouteGroupBuilder api)
    {
        api.MapGet("/plan", Get);
        api.MapPost("/plan/preview", Preview);
        api.MapPut("/plan", Put);
        api.MapDelete("/plan", Delete);
        return api;
    }

    private static async Task<IResult> Get(ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var plan = await db.TrainingPlans.AsNoTracking().FirstOrDefaultAsync(row => row.UserId == userId, cancellationToken);
        return Results.Ok(new { plan = plan is null ? null : await ViewAsync(db, plan, cancellationToken) });
    }

    /// <summary>The plan the answers would make, not saved, so the setup can show it before Create.</summary>
    private static IResult Preview(ClaimsPrincipal principal, PlanRequest body)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var (answers, error) = PlanRules.Check(body);
        if (answers is null)
        {
            return ApiResults.Error(error!);
        }

        return Results.Ok(new PlanPreview(answers.Split, answers.EaseIn, PlanRules.BlockWeeks, PlanGenerator.Generate(answers, ExerciseCatalog.Current)));
    }

    private static async Task<IResult> Put(
        ClaimsPrincipal principal,
        PlanRequest body,
        AppDbContext db,
        UserDirectory users,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (LogEntryRules.RejectZone(body.TimeZone, clock, out _, out var clientToday, out _) is { } zoneError)
        {
            return ApiResults.Error(zoneError);
        }

        var (answers, error) = PlanRules.Check(body);
        if (answers is null)
        {
            return ApiResults.Error(error!);
        }

        await users.UpsertAsync(principal, cancellationToken);
        var userId = Caller.Id(principal);
        var now = clock.GetUtcNow();
        var plan = await db.TrainingPlans.FirstOrDefaultAsync(row => row.UserId == userId, cancellationToken);
        var created = plan is null;
        if (plan is null)
        {
            plan = new TrainingPlan { Id = Guid.NewGuid(), UserId = userId, StartDate = clientToday, CreatedAt = now };
            db.TrainingPlans.Add(plan);
        }

        // The same split keeps its workout ids, so the sequence and the block carry on after a change.
        var keep = plan.Split == answers.Split ? PlanWorkouts.Parse(plan.Workouts).Select(item => item.Id).ToList() : null;
        var workouts = PlanGenerator.Generate(answers, ExerciseCatalog.Current, keep);
        plan.Goal = answers.Goal;
        plan.Weekdays = [.. answers.Weekdays];
        plan.Minutes = answers.Minutes;
        plan.Experience = answers.Experience;
        plan.Equipment = [.. answers.Equipment];
        plan.GoEasy = [.. answers.GoEasy];
        plan.EaseIn = answers.EaseIn;
        plan.Split = answers.Split;
        plan.BlockWeeks = PlanRules.BlockWeeks;
        plan.Workouts = PlanWorkouts.Serialize(workouts);
        plan.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        return Results.Json(await ViewAsync(db, plan, cancellationToken), statusCode: created ? StatusCodes.Status201Created : StatusCodes.Status200OK);
    }

    /// <summary>Ends the plan. Workouts done from it stay in the history.</summary>
    private static async Task<IResult> Delete(ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        await db.TrainingPlans.Where(row => row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// The plan with how far its sequence has got: the highest place done or skipped from one of its workouts.
    /// A new split has new workout ids, so it starts again at the first workout.
    /// </summary>
    private static async Task<PlanView> ViewAsync(AppDbContext db, TrainingPlan plan, CancellationToken cancellationToken)
    {
        var workouts = PlanWorkouts.Parse(plan.Workouts);
        var ids = workouts.Select(item => (Guid?)item.Id).ToList();
        var last = await db.WorkoutSessions
            .Where(row => row.UserId == plan.UserId && row.PlanWorkoutId != null && ids.Contains(row.PlanWorkoutId))
            .MaxAsync(row => row.SequencePosition, cancellationToken);
        return ToView(plan, workouts, last);
    }

    private static PlanView ToView(TrainingPlan plan, IReadOnlyList<PlanWorkout> workouts, int? lastPosition) => new(
        plan.Id,
        plan.Goal,
        plan.Weekdays,
        plan.Minutes,
        plan.Experience,
        plan.Equipment,
        plan.GoEasy,
        plan.EaseIn,
        plan.Split,
        plan.BlockWeeks,
        plan.StartDate,
        plan.UpdatedAt,
        workouts,
        lastPosition);
}
