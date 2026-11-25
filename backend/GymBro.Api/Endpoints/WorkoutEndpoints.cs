using System.Security.Claims;
using GymBro.Api.Data;
using GymBro.Api.Logging;
using GymBro.Api.Training;
using GymBro.Api.Users;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Endpoints;

public sealed record WorkoutSetView(
    string ExerciseId,
    int Block,
    string Type,
    int? Reps,
    decimal? Kg,
    int? Rir,
    int? Seconds,
    decimal? Metres,
    int? Calories,
    DateTimeOffset? DoneAt);

public sealed record WorkoutView(
    Guid Id,
    string Kind,
    DateOnly Date,
    string? Name,
    string Status,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt,
    string? Notes,
    Guid? PlanWorkoutId,
    int? SequencePosition,
    DateTimeOffset UpdatedAt,
    IReadOnlyList<WorkoutSetView> Sets);

/// <summary>One row of the history: what was trained, and how much.</summary>
public sealed record WorkoutSummary(
    Guid Id,
    string Kind,
    DateOnly Date,
    string? Name,
    string Status,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt,
    Guid? PlanWorkoutId,
    int? SequencePosition,
    DateTimeOffset UpdatedAt,
    IReadOnlyList<string> Exercises,
    int Sets,
    decimal VolumeKg);

/// <summary>The last workout that had an exercise, and that exercise's sets in it.</summary>
public sealed record PreviousSets(Guid WorkoutId, DateOnly Date, IReadOnlyList<WorkoutSetView> Sets);

/// <summary>
/// Workouts (docs/training.md, phase 2). The app makes each workout's id and sends the whole workout with
/// PUT, so a retry after a lost connection replaces it instead of adding a second copy. Every query is
/// scoped by the caller's oid.
/// </summary>
public static class WorkoutEndpoints
{
    public const string UnknownWorkout = "That workout is not known.";
    public const string RangeMessage = "Ask for a range of up to 366 days, from on or before to.";
    public const int MaxRangeDays = 366;
    public const int MaxPreviousExercises = 30;

    public static RouteGroupBuilder MapWorkouts(this RouteGroupBuilder api)
    {
        api.MapGet("/workouts", List);
        api.MapGet("/workouts/previous", Previous);
        api.MapGet("/workouts/{id:guid}", Get);
        api.MapPut("/workouts/{id:guid}", Put);
        api.MapDelete("/workouts/{id:guid}", Delete);
        return api;
    }

    private static async Task<IResult> Put(
        ClaimsPrincipal principal,
        Guid id,
        WorkoutRequest body,
        AppDbContext db,
        UserDirectory users,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (LogEntryRules.RejectZone(body.TimeZone, clock, out _, out var clientToday, out var serverToday) is { } zoneError)
        {
            return ApiResults.Error(zoneError);
        }

        var (draft, error) = WorkoutRules.Check(body, ExerciseCatalog.Current, clientToday, serverToday);
        if (draft is null)
        {
            return ApiResults.Error(error!);
        }

        await users.UpsertAsync(principal, cancellationToken);
        var userId = Caller.Id(principal);
        var existing = await db.WorkoutSessions.Include(row => row.Sets).FirstOrDefaultAsync(row => row.Id == id, cancellationToken);
        if (existing is not null && existing.UserId != userId)
        {
            // Ids are random, so this is someone else's workout: don't say so, and don't touch it.
            return ApiResults.Error(UnknownWorkout, StatusCodes.Status404NotFound);
        }

        var now = clock.GetUtcNow();
        var created = existing is null;
        var session = existing ?? new WorkoutSession { Id = id, UserId = userId, CreatedAt = now };
        if (created)
        {
            db.WorkoutSessions.Add(session);
        }
        else
        {
            db.WorkoutSets.RemoveRange(session.Sets);
            session.Sets.Clear();
        }

        session.Kind = draft.Kind;
        session.LocalDate = draft.Date;
        session.Name = draft.Name;
        session.Status = draft.Status;
        session.StartedAt = draft.StartedAt;
        session.EndedAt = draft.EndedAt;
        session.Notes = draft.Notes;
        session.PlanWorkoutId = draft.PlanWorkoutId;
        session.SequencePosition = draft.SequencePosition;
        session.UpdatedAt = now;
        for (var index = 0; index < draft.Sets.Count; index++)
        {
            var set = draft.Sets[index];
            var row = new WorkoutSet
            {
                Id = Guid.NewGuid(),
                SessionId = session.Id,
                UserId = userId,
                ExerciseId = set.ExerciseId,
                Block = set.Block,
                Position = index,
                Type = set.Type,
                Reps = set.Reps,
                Kg = set.Kg,
                Rir = set.Rir,
                Seconds = set.Seconds,
                Metres = set.Metres,
                Calories = set.Calories,
                DoneAt = set.DoneAt,
            };
            session.Sets.Add(row);
            db.WorkoutSets.Add(row);
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.Json(ToView(session), statusCode: created ? StatusCodes.Status201Created : StatusCodes.Status200OK);
    }

    private static async Task<IResult> Get(ClaimsPrincipal principal, Guid id, AppDbContext db, CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var session = await db.WorkoutSessions.AsNoTracking().Include(row => row.Sets)
            .FirstOrDefaultAsync(row => row.Id == id && row.UserId == userId, cancellationToken);
        return session is null ? ApiResults.Error(UnknownWorkout, StatusCodes.Status404NotFound) : Results.Ok(ToView(session));
    }

    /// <summary>Workouts from one date through another, newest first.</summary>
    private static async Task<IResult> List(
        ClaimsPrincipal principal,
        DateOnly from,
        DateOnly to,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (to < from || to.DayNumber - from.DayNumber >= MaxRangeDays)
        {
            return ApiResults.Error(RangeMessage);
        }

        var userId = Caller.Id(principal);
        var sessions = await db.WorkoutSessions.AsNoTracking().Include(row => row.Sets)
            .Where(row => row.UserId == userId && row.LocalDate >= from && row.LocalDate <= to)
            .OrderByDescending(row => row.LocalDate).ThenByDescending(row => row.StartedAt ?? row.CreatedAt)
            .ToListAsync(cancellationToken);
        return Results.Ok(new { workouts = sessions.Select(ToSummary) });
    }

    /// <summary>
    /// For each exercise asked about, its sets in the latest done workout that had it, so the set table can show
    /// "last time". <paramref name="except"/> leaves out the workout being edited.
    /// </summary>
    private static async Task<IResult> Previous(
        ClaimsPrincipal principal,
        string[]? exercise,
        Guid? except,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var ids = (exercise ?? []).Where(id => !string.IsNullOrWhiteSpace(id)).Distinct().ToList();
        if (ids.Count > MaxPreviousExercises)
        {
            return ApiResults.Error($"Ask about up to {MaxPreviousExercises} exercises at a time.");
        }

        var userId = Caller.Id(principal);
        var found = new Dictionary<string, PreviousSets>();
        foreach (var id in ids)
        {
            var latest = await db.WorkoutSets.AsNoTracking()
                .Where(set => set.UserId == userId && set.ExerciseId == id && set.SessionId != except)
                .Join(db.WorkoutSessions.Where(row => row.UserId == userId && row.Status == WorkoutStatuses.Done),
                    set => set.SessionId, row => row.Id, (set, row) => row)
                .OrderByDescending(row => row.LocalDate).ThenByDescending(row => row.StartedAt ?? row.CreatedAt)
                .Select(row => new { row.Id, row.LocalDate })
                .FirstOrDefaultAsync(cancellationToken);
            if (latest is null)
            {
                continue;
            }

            var sets = await db.WorkoutSets.AsNoTracking()
                .Where(set => set.SessionId == latest.Id && set.ExerciseId == id)
                .OrderBy(set => set.Position)
                .ToListAsync(cancellationToken);
            found[id] = new PreviousSets(latest.Id, latest.LocalDate, sets.Select(ToView).ToList());
        }

        return Results.Ok(new { exercises = found });
    }

    private static async Task<IResult> Delete(ClaimsPrincipal principal, Guid id, AppDbContext db, CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        // Gone already is fine: a delete sent twice (offline, then again) does the same as once.
        var userId = Caller.Id(principal);
        await db.WorkoutSessions.Where(row => row.Id == id && row.UserId == userId).ExecuteDeleteAsync(cancellationToken);
        return Results.NoContent();
    }

    private static WorkoutView ToView(WorkoutSession session) => new(
        session.Id,
        session.Kind,
        session.LocalDate,
        session.Name,
        session.Status,
        session.StartedAt,
        session.EndedAt,
        session.Notes,
        session.PlanWorkoutId,
        session.SequencePosition,
        session.UpdatedAt,
        session.Sets.OrderBy(set => set.Position).Select(ToView).ToList());

    private static WorkoutSetView ToView(WorkoutSet set) => new(
        set.ExerciseId, set.Block, set.Type, set.Reps, set.Kg, set.Rir, set.Seconds, set.Metres, set.Calories, set.DoneAt);

    private static WorkoutSummary ToSummary(WorkoutSession session)
    {
        var ordered = session.Sets.OrderBy(set => set.Position).ToList();
        return new WorkoutSummary(
            session.Id,
            session.Kind,
            session.LocalDate,
            session.Name,
            session.Status,
            session.StartedAt,
            session.EndedAt,
            session.PlanWorkoutId,
            session.SequencePosition,
            session.UpdatedAt,
            ordered.Select(set => set.ExerciseId).Distinct().ToList(),
            ordered.Count(WorkoutRules.Counts),
            WorkoutRules.Volume(ordered));
    }
}
