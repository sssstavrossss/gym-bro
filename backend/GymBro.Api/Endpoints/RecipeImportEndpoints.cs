using System.Security.Claims;
using GymBro.Api.Data;
using GymBro.Api.Describe;
using GymBro.Api.Logging;
using GymBro.Api.Profiles;
using GymBro.Api.Users;
using Microsoft.Extensions.Options;

namespace GymBro.Api.Endpoints;

/// <summary>
/// New recipe's "Import a recipe": a link to a recipe page, or its ingredients pasted, matched to foods the way
/// Describe a meal matches a meal (<see cref="MealDescriber"/> with <see cref="MealNote.Recipe"/>). From a link,
/// only the page's recipe data is read (<see cref="RecipePage"/>); the page itself never goes to Claude. Nothing is
/// saved but a usage row (<see cref="MealKinds.Recipe"/>), which counts toward Describe's daily limit. A link that
/// can't be read, or has no recipe, costs nothing.
/// </summary>
public static class RecipeImportEndpoints
{
    public const int TextMax = 4000;

    public const int UrlMax = 2000;

    public const string Off = "Importing recipes isn't set up on this server.";

    public const string Missing = "Paste a link to a recipe, or its ingredients.";

    public const string TooLong = "That's a long list. Keep it under 4,000 characters, or import it in two parts.";

    public const string BadLink = "That link can't be opened. Paste the ingredients instead.";

    public const string Unreadable = "Couldn't open that page. Paste the ingredients instead.";

    public const string NoRecipe = "Couldn't find a recipe on that page. Paste the ingredients instead.";

    public const string NothingFound = "Couldn't find ingredients in that. Paste them one per line, with amounts.";

    public const string ModelDown = "Couldn't reach Claude just now. Try again, or add the ingredients yourself.";

    public const string DailyLimitReached = "That's the limit for Claude for now. You can still add the ingredients yourself.";

    public static RouteGroupBuilder MapRecipeImport(this RouteGroupBuilder api)
    {
        api.MapPost("/recipes/import", Import);
        return api;
    }

    private static async Task<IResult> Import(
        ClaimsPrincipal principal,
        RecipeImportRequest request,
        AppDbContext db,
        UserDirectory users,
        DescribeSwitch describe,
        IOptions<DescribeOptions> options,
        IMealModel model,
        MealDescriber describer,
        IRecipePageFetcher fetcher,
        TimeProvider clock,
        ILogger<RecipePage> logger,
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

        var link = (request.Url ?? "").Trim();
        var pasted = (request.Text ?? "").Trim();
        Uri? url = null;
        if (link.Length > 0)
        {
            if (link.Length > UrlMax || !Uri.TryCreate(link, UriKind.Absolute, out url) || !PublicPageFetcher.Allowed(url))
            {
                return ApiResults.Error(BadLink);
            }
        }
        else if (pasted.Length == 0)
        {
            return ApiResults.Error(Missing);
        }
        else if (pasted.Length > TextMax)
        {
            return ApiResults.Error(TooLong);
        }

        var userId = Caller.Id(principal);
        var now = clock.GetUtcNow();
        var quota = await DescribeQuota.ReadAsync(db, userId, options.Value.DailyLimit, now, cancellationToken);
        if (quota.Left == 0)
        {
            logger.LogInformation("Recipe import for {UserId}: over the limit ({Used} of {Limit})", userId, quota.Used, quota.Limit);
            return ApiResults.Error(DailyLimitReached, StatusCodes.Status429TooManyRequests);
        }

        RecipePage page;
        if (url is not null)
        {
            var html = await fetcher.FetchAsync(url, cancellationToken);
            if (html is null)
            {
                logger.LogInformation("Recipe import for {UserId}: {Host} couldn't be read", userId, url.Host);
                return ApiResults.Error(Unreadable, StatusCodes.Status422UnprocessableEntity);
            }

            if (RecipePage.Read(html) is not { } found)
            {
                logger.LogInformation("Recipe import for {UserId}: no recipe on {Host}", userId, url.Host);
                return ApiResults.Error(NoRecipe, StatusCodes.Status422UnprocessableEntity);
            }

            page = found;
        }
        else
        {
            var lines = pasted.Split('\n')
                .Select(line => RecipePage.Clean(line, RecipePage.LineMax))
                .Where(line => line.Length > 0)
                .Take(RecipePage.IngredientsMax)
                .ToList();
            page = new RecipePage("", null, lines);
        }

        await users.UpsertAsync(principal, cancellationToken);
        var text = string.Join('\n', page.Ingredients);
        var usage = new MealUsage();
        var started = clock.GetTimestamp();
        IReadOnlyList<DescribedItem> items = [];
        string outcome;
        try
        {
            var home = await FoodCountries.HomeAsync(db, userId, cancellationToken);
            items = await describer.DescribeAsync(userId, new MealNote(text, Home: home, Recipe: true), usage, cancellationToken);
            outcome = items.Count == 0 ? MealOutcomes.Nothing : MealOutcomes.Found;
        }
        catch (MealModelException ex)
        {
            outcome = ex.Refused ? MealOutcomes.Declined : MealOutcomes.Failed;
        }

        var row = new MealDescription
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Kind = MealKinds.Recipe,
            // The link, or the start of the pasted list: what was imported, for the export.
            Text = Clip(url?.AbsoluteUri ?? text, 500),
            CreatedAt = now,
            Outcome = outcome,
            FoodCount = items.Count(item => item.Food is not null),
            Model = Clip(model.Name, 64),
            Calls = usage.Calls,
            InputTokens = usage.InputTokens,
            OutputTokens = usage.OutputTokens,
            DurationMs = (int)Math.Min(int.MaxValue, clock.GetElapsedTime(started).TotalMilliseconds),
        };
        db.MealDescriptions.Add(row);
        await db.SaveChangesAsync(cancellationToken);
        var left = outcome == MealOutcomes.Failed ? quota.Left : quota.Left - 1;
        logger.LogInformation(
            "Recipe import for {UserId}: {Outcome}, from {Source}, {Found} of {Lines} ingredients matched, {Calls} calls, {InputTokens} input and {OutputTokens} output tokens, {DurationMs} ms, {Left} of {Limit} left",
            userId, outcome, url?.Host ?? "text", row.FoodCount, page.Ingredients.Count, row.Calls, row.InputTokens, row.OutputTokens, row.DurationMs, left, quota.Limit);

        return outcome switch
        {
            MealOutcomes.Found => Results.Ok(new
            {
                name = page.Name,
                portions = page.Portions,
                site = url is null ? null : Site(url),
                items = await DescribeEndpoints.ItemsAsync(db, userId, items, cancellationToken),
                left,
            }),
            MealOutcomes.Failed => ApiResults.Error(ModelDown, StatusCodes.Status503ServiceUnavailable),
            _ => ApiResults.Error(NothingFound, StatusCodes.Status422UnprocessableEntity),
        };
    }

    /// <summary>"matprat.no" for www.matprat.no.</summary>
    public static string Site(Uri url) =>
        url.Host.StartsWith("www.", StringComparison.OrdinalIgnoreCase) ? url.Host[4..] : url.Host;

    private static string Clip(string? value, int max)
    {
        var text = LogEntryRules.Collapse(value);
        return text.Length <= max ? text : text[..max];
    }
}

public sealed record RecipeImportRequest(string? Url, string? Text);
