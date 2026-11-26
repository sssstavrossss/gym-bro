using System.Security.Claims;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Describe;
using GymBro.Api.Training;
using GymBro.Api.Users;
using Microsoft.Extensions.Options;

namespace GymBro.Api.Endpoints;

/// <summary>
/// The workout screen's "Describe": the person types what they did and Claude names the exercises and sets
/// (README → Describe a workout). Nothing is logged here; the app adds the exercises to the workout. A usage row
/// (<see cref="MealKinds.Workout"/>) is kept, and counts toward Describe's daily limit.
/// </summary>
public static class WorkoutDescribeEndpoints
{
    public const string Off = "Describing workouts isn't set up on this server.";

    public const string TextMissing = "Write what you did.";

    public const string TooLong = "That's a lot of words. Keep it under 500 characters.";

    public const string NothingFound = "Couldn't find exercises in that. Name each one with its sets, like: squat 3x5 100 kg.";

    public const string ModelDown = "Couldn't reach Claude just now. Try again, or add the exercises yourself.";

    public const string DailyLimitReached = "That's the limit for describing for now. You can still add the exercises yourself.";

    public static RouteGroupBuilder MapWorkoutDescribe(this RouteGroupBuilder api)
    {
        api.MapPost("/workouts/describe", Describe);
        return api;
    }

    private static async Task<IResult> Describe(
        ClaimsPrincipal principal,
        WorkoutDescribeRequest request,
        AppDbContext db,
        UserDirectory users,
        DescribeSwitch describe,
        IOptions<DescribeOptions> options,
        IWorkoutModel model,
        TimeProvider clock,
        ILogger<ClaudeWorkoutModel> logger,
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

        var text = request.Text?.Trim() ?? "";
        if (text.Length == 0)
        {
            return ApiResults.Error(TextMissing);
        }

        if (text.Length > WorkoutDescriber.MaxText)
        {
            return ApiResults.Error(TooLong);
        }

        var userId = Caller.Id(principal);
        var now = clock.GetUtcNow();
        var quota = await DescribeQuota.ReadAsync(db, userId, options.Value.DailyLimit, now, cancellationToken);
        if (quota.Left == 0)
        {
            logger.LogInformation("Workout for {UserId}: over the limit ({Used} of {Limit})", userId, quota.Used, quota.Limit);
            return ApiResults.Error(DailyLimitReached, StatusCodes.Status429TooManyRequests);
        }

        await users.UpsertAsync(principal, cancellationToken);
        var library = ExerciseCatalog.Current;
        var usage = new MealUsage();
        var started = clock.GetTimestamp();
        IReadOnlyList<DescribedExercise> exercises = [];
        IReadOnlyList<string> unmatched = [];
        string outcome;
        try
        {
            (exercises, unmatched) = WorkoutDescriber.Resolve(await model.ReadAsync(text, library, usage, cancellationToken), library);
            outcome = exercises.Count == 0 ? MealOutcomes.Nothing : MealOutcomes.Found;
        }
        catch (MealModelException ex)
        {
            outcome = ex.Refused ? MealOutcomes.Declined : MealOutcomes.Failed;
        }

        var found = exercises.Select(item => new
        {
            exerciseId = item.ExerciseId,
            superset = item.Superset,
            sets = item.Sets.Select(set => new { kg = set.Kg, reps = set.Reps, seconds = set.Seconds, metres = set.Metres }),
        }).ToList();
        var row = new MealDescription
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Kind = MealKinds.Workout,
            Text = text,
            Items = JsonSerializer.Serialize(found, JsonSerializerOptions.Web),
            CreatedAt = now,
            Outcome = outcome,
            FoodCount = exercises.Count,
            Model = model.Name.Length <= 64 ? model.Name : model.Name[..64],
            Calls = usage.Calls,
            InputTokens = usage.InputTokens,
            OutputTokens = usage.OutputTokens,
            DurationMs = (int)Math.Min(int.MaxValue, clock.GetElapsedTime(started).TotalMilliseconds),
        };
        db.MealDescriptions.Add(row);
        await db.SaveChangesAsync(cancellationToken);
        var left = outcome == MealOutcomes.Failed ? quota.Left : quota.Left - 1;
        logger.LogInformation(
            "Workout for {UserId}: {Outcome}, {Exercises} exercises, {Unmatched} unmatched, {Calls} calls, {InputTokens} input and {OutputTokens} output tokens, {DurationMs} ms, {Left} of {Limit} left",
            userId, outcome, exercises.Count, unmatched.Count, row.Calls, row.InputTokens, row.OutputTokens, row.DurationMs, left, quota.Limit);

        return outcome switch
        {
            MealOutcomes.Found => Results.Ok(new { exercises = found, unmatched, left }),
            MealOutcomes.Failed => ApiResults.Error(ModelDown, StatusCodes.Status503ServiceUnavailable),
            _ => ApiResults.Error(NothingFound, StatusCodes.Status422UnprocessableEntity),
        };
    }
}

public sealed record WorkoutDescribeRequest(string? Text);
