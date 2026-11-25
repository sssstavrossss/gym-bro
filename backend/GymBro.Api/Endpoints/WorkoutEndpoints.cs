using System.Security.Claims;
using GymBro.Api.Data;
using GymBro.Api.Logging;
using GymBro.Api.Progress;
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
/// <summary>An exercise's sets in one earlier workout.</summary>
public sealed record WorkoutSetsOn(Guid WorkoutId, DateOnly Date, IReadOnlyList<WorkoutSetView> Sets);

/// <summary>An exercise's best set so far by estimated max (<see cref="EstimatedMax"/>).</summary>
public sealed record BestSet(Guid WorkoutId, DateOnly Date, decimal Kg, int Reps, int? Rir, decimal EstimatedMax);

/// <summary>
/// The latest done workout with an exercise, the one before it (load suggestions need two), and the best set
/// in any done workout (personal records).
/// </summary>
public sealed record PreviousSets(Guid WorkoutId, DateOnly Date, IReadOnlyList<WorkoutSetView> Sets, WorkoutSetsOn? Earlier, BestSet? Best);

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
        api.MapGet("/workouts/strength", Strength);
        api.MapGet("/workouts/muscles", Muscles);
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
    /// Progress → Strength over a range (7d, 30d, 90d, 6m or all, as Progress): done workouts, their working sets,
    /// and each lift's estimated max per day.
    /// </summary>
    private static async Task<IResult> Strength(
        ClaimsPrincipal principal,
        string? range,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (!ProgressMath.TryRange(range, out var normalized))
        {
            return ApiResults.Error(ProgressMath.BadRange);
        }

        var userId = Caller.Id(principal);
        var today = await ProgressEndpoints.TodayAsync(userId, db, clock, cancellationToken);
        var done = db.WorkoutSessions.AsNoTracking().Where(row => row.UserId == userId && row.Status == WorkoutStatuses.Done && row.LocalDate <= today);
        var first = await done.OrderBy(row => row.LocalDate).Select(row => (DateOnly?)row.LocalDate).FirstOrDefaultAsync(cancellationToken);
        var from = ProgressMath.WindowStart(today, normalized, first);

        var inRange = done.Where(row => row.LocalDate >= from);
        var workouts = await inRange.CountAsync(cancellationToken);
        var sets = await db.WorkoutSets.AsNoTracking()
            .Where(set => set.UserId == userId && set.Type != SetTypes.Warmup)
            .Join(inRange, set => set.SessionId, row => row.Id,
                (set, row) => new ScoredSet(row.LocalDate, set.ExerciseId, set.Type, set.Kg, set.Reps, set.Rir))
            .ToListAsync(cancellationToken);

        return Results.Ok(new
        {
            range = normalized,
            from,
            to = today,
            workouts,
            sets = sets.Count,
            lifts = StrengthProgress.Lifts(sets),
        });
    }

    /// <summary>
    /// Progress → Strength's This week: sets per muscle from Monday to today (the caller's day), against the
    /// weekly target for the plan's experience (some experience with no plan).
    /// </summary>
    private static async Task<IResult> Muscles(
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
        var today = await ProgressEndpoints.TodayAsync(userId, db, clock, cancellationToken);
        var monday = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        var inWeek = db.WorkoutSessions.AsNoTracking()
            .Where(row => row.UserId == userId && row.Status == WorkoutStatuses.Done && row.LocalDate >= monday && row.LocalDate <= today);
        var workouts = await inWeek.CountAsync(cancellationToken);
        var sets = await db.WorkoutSets.AsNoTracking()
            .Where(set => set.UserId == userId && set.Type != SetTypes.Warmup)
            .Join(inWeek, set => set.SessionId, row => row.Id, (set, row) => new { row.LocalDate, set.ExerciseId })
            .ToListAsync(cancellationToken);
        var experience = await db.TrainingPlans.AsNoTracking()
            .Where(row => row.UserId == userId)
            .Select(row => (string?)row.Experience)
            .FirstOrDefaultAsync(cancellationToken);

        return Results.Ok(new
        {
            from = monday,
            to = today,
            workouts,
            experience,
            target = MuscleVolume.TargetFor(experience),
            muscles = MuscleVolume.Count(sets.Select(set => (set.LocalDate, set.ExerciseId)), ExerciseCatalog.Current),
        });
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
                .Select(row => new { row.Id, row.LocalDate, Started = row.StartedAt ?? row.CreatedAt })
                .Distinct()
                .OrderByDescending(row => row.LocalDate).ThenByDescending(row => row.Started)
                .Take(2)
                .ToListAsync(cancellationToken);
            if (latest.Count == 0)
            {
                continue;
            }

            var sessionIds = latest.Select(row => row.Id).ToList();
            var sets = await db.WorkoutSets.AsNoTracking()
                .Where(set => set.UserId == userId && sessionIds.Contains(set.SessionId) && set.ExerciseId == id)
                .OrderBy(set => set.Position)
                .ToListAsync(cancellationToken);
            List<WorkoutSetView> On(Guid session) => sets.Where(set => set.SessionId == session).Select(ToView).ToList();
            var earlier = latest.Count > 1 ? new WorkoutSetsOn(latest[1].Id, latest[1].LocalDate, On(latest[1].Id)) : null;

            // Ordered by kg × (30 + reps + RIR), which ranks like the estimate; the earliest wins a tie.
            var best = await db.WorkoutSets.AsNoTracking()
                .Where(set => set.UserId == userId && set.ExerciseId == id && set.SessionId != except && set.Type == SetTypes.Working
                    && set.Kg > 0 && set.Reps >= 1 && set.Reps <= EstimatedMax.MaxReps)
                .Join(db.WorkoutSessions.Where(row => row.UserId == userId && row.Status == WorkoutStatuses.Done),
                    set => set.SessionId, row => row.Id,
                    (set, row) => new { row.Id, row.LocalDate, Kg = set.Kg!.Value, Reps = set.Reps!.Value, set.Rir })
                .OrderByDescending(row => row.Kg * (30 + row.Reps + (row.Rir > 0 ? row.Rir!.Value : 0)))
                .ThenBy(row => row.LocalDate)
                .FirstOrDefaultAsync(cancellationToken);
            var bestSet = best is null
                ? null
                : new BestSet(best.Id, best.LocalDate, best.Kg, best.Reps, best.Rir, EstimatedMax.Of(SetTypes.Working, best.Kg, best.Reps, best.Rir)!.Value);
            found[id] = new PreviousSets(latest[0].Id, latest[0].LocalDate, On(latest[0].Id), earlier, bestSet);
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
