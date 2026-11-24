using System.Security.Claims;
using GymBro.Api.Data;
using GymBro.Api.Describe;
using GymBro.Api.Users;
using Microsoft.Extensions.Options;

namespace GymBro.Api.Endpoints;

/// <summary>
/// New food's "Fill from a label photo": Claude reads the nutrition table and the app fills the form. Nothing is
/// saved but a usage row (<see cref="MealKinds.Label"/>), which counts toward Describe's daily limit. The photo is
/// passed on and not kept.
/// </summary>
public static class LabelEndpoints
{
    public const string Off = "Reading labels isn't set up on this server.";

    public const string NoTable = "Couldn't find a nutrition table in that photo. Try one closer to the table, in good light.";

    public const string ModelDown = "Couldn't reach Claude just now. Try again, or type the values.";

    public const string DailyLimitReached = "That's the limit for photos for now. You can still type the values.";

    public const string PhotoMissing = "Send a photo of the label.";

    public static RouteGroupBuilder MapLabel(this RouteGroupBuilder api)
    {
        api.MapPost("/foods/label", Read);
        return api;
    }

    private static async Task<IResult> Read(
        ClaimsPrincipal principal,
        LabelRequest request,
        AppDbContext db,
        UserDirectory users,
        DescribeSwitch describe,
        IOptions<DescribeOptions> options,
        ILabelModel model,
        TimeProvider clock,
        ILogger<ClaudeLabelModel> logger,
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

        if (request.Photo is not { } sent)
        {
            return ApiResults.Error(PhotoMissing);
        }

        var (photo, unusable) = MealPhoto.Read(sent.MediaType, sent.Data);
        if (photo is null)
        {
            return ApiResults.Error(unusable ?? MealPhoto.Unreadable);
        }

        var userId = Caller.Id(principal);
        var now = clock.GetUtcNow();
        var quota = await DescribeQuota.ReadAsync(db, userId, options.Value.DailyLimit, now, cancellationToken);
        if (quota.Left == 0)
        {
            logger.LogInformation("Label for {UserId}: over the limit ({Used} of {Limit})", userId, quota.Used, quota.Limit);
            return ApiResults.Error(DailyLimitReached, StatusCodes.Status429TooManyRequests);
        }

        await users.UpsertAsync(principal, cancellationToken);
        var usage = new MealUsage();
        var started = clock.GetTimestamp();
        LabelFill? fill = null;
        string outcome;
        try
        {
            fill = LabelRules.Fill(await model.ReadAsync(photo, usage, cancellationToken));
            outcome = fill is null ? MealOutcomes.Nothing : MealOutcomes.Found;
        }
        catch (MealModelException ex)
        {
            outcome = ex.Refused ? MealOutcomes.Declined : MealOutcomes.Failed;
        }

        var row = new MealDescription
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Kind = MealKinds.Label,
            HasPhoto = true,
            CreatedAt = now,
            Outcome = outcome,
            FoodCount = fill is null ? 0 : 1,
            Kcal = fill?.Kcal ?? 0,
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
            "Label for {UserId}: {Outcome}, {Calls} calls, {InputTokens} input and {OutputTokens} output tokens, {DurationMs} ms, {Left} of {Limit} left",
            userId, outcome, row.Calls, row.InputTokens, row.OutputTokens, row.DurationMs, left, quota.Limit);

        if (fill is not null)
        {
            return Results.Ok(new
            {
                name = fill.Name,
                brand = fill.Brand,
                basis = fill.Basis,
                servingName = fill.ServingName,
                servingGrams = fill.ServingGrams,
                kcal = fill.Kcal,
                protein = fill.Protein,
                fat = fill.Fat,
                carbs = fill.Carbs,
                saturatedFat = fill.SaturatedFat,
                sugars = fill.Sugars,
                fiber = fill.Fiber,
                salt = fill.Salt,
                left,
            });
        }

        return outcome == MealOutcomes.Failed
            ? ApiResults.Error(ModelDown, StatusCodes.Status503ServiceUnavailable)
            : ApiResults.Error(NoTable, StatusCodes.Status422UnprocessableEntity);
    }
}

public sealed record LabelRequest(PhotoRequest? Photo);
