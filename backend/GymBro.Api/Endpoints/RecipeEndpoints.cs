using System.Security.Claims;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Logging;
using GymBro.Api.Users;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Endpoints;

public static class RecipeEndpoints
{
    public static RouteGroupBuilder MapRecipes(this RouteGroupBuilder api)
    {
        api.MapGet("/recipes", List);
        api.MapGet("/recipes/{id:guid}", One);
        api.MapPost("/recipes", Create);
        api.MapPut("/recipes/{id:guid}", Update);
        api.MapDelete("/recipes/{id:guid}", Retire);
        api.MapPost("/recipes/{id:guid}/log", Log);
        return api;
    }

    private static async Task<IResult> List(
        ClaimsPrincipal principal,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var recipes = await Load(db, Caller.Id(principal), null, cancellationToken);
        return Results.Ok(new RecipeListResponse(recipes));
    }

    private static async Task<IResult> One(
        ClaimsPrincipal principal,
        Guid id,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var recipes = await Load(db, Caller.Id(principal), id, cancellationToken);
        if (recipes.Count == 0)
        {
            return ApiResults.Error(RecipeRules.MissingRecipe, StatusCodes.Status404NotFound);
        }

        return Results.Ok(recipes[0]);
    }

    private static async Task<IResult> Create(
        ClaimsPrincipal principal,
        HttpRequest http,
        AppDbContext db,
        UserDirectory users,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var body = await ReadWrite(http, cancellationToken);
        if (body.Error is not null)
        {
            return ApiResults.Error(body.Error);
        }

        await users.UpsertAsync(principal, cancellationToken);
        var userId = Caller.Id(principal);
        var built = await BuildLines(db, userId, body.Draft!, null, cancellationToken);
        if (built.Error is not null)
        {
            return ApiResults.Error(built.Error, built.Status);
        }

        var now = clock.GetUtcNow();
        var recipe = new Recipe
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Name = body.Draft!.Name,
            Portions = body.Draft.Portions,
            FinishedGrams = body.Draft.FinishedGrams,
            Kcal = built.Totals!.Value.Kcal,
            Protein = built.Totals.Value.Protein,
            Fat = built.Totals.Value.Fat,
            Carbs = built.Totals.Value.Carbs,
            SaturatedFat = built.Totals.Value.SaturatedFat,
            Sugars = built.Totals.Value.Sugars,
            Fiber = built.Totals.Value.Fiber,
            Salt = built.Totals.Value.Salt,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Recipes.Add(recipe);
        AddIngredients(db, userId, recipe.Id, built.Lines!);
        await db.SaveChangesAsync(cancellationToken);
        var saved = await Load(db, userId, recipe.Id, cancellationToken);
        return Results.Json(saved[0], statusCode: StatusCodes.Status201Created);
    }

    private static async Task<IResult> Update(
        ClaimsPrincipal principal,
        Guid id,
        HttpRequest http,
        AppDbContext db,
        UserDirectory users,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var body = await ReadWrite(http, cancellationToken);
        if (body.Error is not null)
        {
            return ApiResults.Error(body.Error);
        }

        await users.UpsertAsync(principal, cancellationToken);
        var userId = Caller.Id(principal);
        var recipe = await db.Recipes.FirstOrDefaultAsync(
            row => row.Id == id && row.UserId == userId && row.RetiredAt == null,
            cancellationToken);
        if (recipe is null)
        {
            return ApiResults.Error(RecipeRules.MissingRecipe, StatusCodes.Status404NotFound);
        }

        var existing = await db.RecipeIngredients
            .Where(row => row.UserId == userId && row.RecipeId == id)
            .ToListAsync(cancellationToken);
        var built = await BuildLines(db, userId, body.Draft!, existing, cancellationToken);
        if (built.Error is not null)
        {
            return ApiResults.Error(built.Error, built.Status);
        }

        recipe.Name = body.Draft!.Name;
        recipe.Portions = body.Draft.Portions;
        recipe.FinishedGrams = body.Draft.FinishedGrams;
        recipe.Kcal = built.Totals!.Value.Kcal;
        recipe.Protein = built.Totals.Value.Protein;
        recipe.Fat = built.Totals.Value.Fat;
        recipe.Carbs = built.Totals.Value.Carbs;
        recipe.SaturatedFat = built.Totals.Value.SaturatedFat;
        recipe.Sugars = built.Totals.Value.Sugars;
        recipe.Fiber = built.Totals.Value.Fiber;
        recipe.Salt = built.Totals.Value.Salt;
        recipe.UpdatedAt = clock.GetUtcNow();
        // Delete the old rows before inserting the replacements. One save would
        // collide on (recipe_id, position). The transaction keeps the previous
        // ingredients if the new rows fail.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        db.RecipeIngredients.RemoveRange(existing);
        await db.SaveChangesAsync(cancellationToken);
        AddIngredients(db, userId, recipe.Id, built.Lines!);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        var saved = await Load(db, userId, recipe.Id, cancellationToken);
        return Results.Ok(saved[0]);
    }

    private static async Task<IResult> Retire(
        ClaimsPrincipal principal,
        Guid id,
        AppDbContext db,
        UserDirectory users,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        await users.UpsertAsync(principal, cancellationToken);
        var userId = Caller.Id(principal);
        var recipe = await db.Recipes.FirstOrDefaultAsync(
            row => row.Id == id && row.UserId == userId && row.RetiredAt == null,
            cancellationToken);
        if (recipe is null)
        {
            return ApiResults.Error(RecipeRules.MissingRecipe, StatusCodes.Status404NotFound);
        }

        var now = clock.GetUtcNow();
        recipe.RetiredAt = now;
        recipe.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> Log(
        ClaimsPrincipal principal,
        Guid id,
        HttpRequest http,
        AppDbContext db,
        UserDirectory users,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var body = await ReadLog(http, cancellationToken);
        if (body.Error is not null)
        {
            return ApiResults.Error(body.Error);
        }

        await users.UpsertAsync(principal, cancellationToken);
        var draft = body.Draft!;
        var userId = Caller.Id(principal);
        var existing = await db.LogEntries.AsNoTracking().FirstOrDefaultAsync(
            row => row.UserId == userId && row.IdempotencyKey == draft.IdempotencyKey,
            cancellationToken);
        if (existing is not null)
        {
            return Results.Ok(ToLog(existing));
        }

        var recipe = await db.Recipes.AsNoTracking().FirstOrDefaultAsync(
            row => row.Id == id && row.UserId == userId && row.RetiredAt == null,
            cancellationToken);
        if (recipe is null)
        {
            return ApiResults.Error(RecipeRules.MissingRecipe, StatusCodes.Status404NotFound);
        }

        var window = await LogWindow.OpenAsync(userId, draft.TimeZone, db, clock, cancellationToken);
        if (window.Error is not null)
        {
            return ApiResults.Error(window.Error);
        }

        var dateError = LogEntryRules.RejectDate(draft.LocalDate, window.SetupDate, window.ClientToday, window.ServerToday);
        if (dateError is not null)
        {
            return ApiResults.Error(dateError);
        }

        if (draft.Time is null && draft.LocalDate != window.ClientToday)
        {
            return ApiResults.Error(RecipeRules.PickTime);
        }

        var scaled = RecipeRules.ScaleLog(
            new RecipeRules.Totals(recipe.Kcal, recipe.Protein, recipe.Fat, recipe.Carbs, recipe.SaturatedFat, recipe.Sugars, recipe.Fiber, recipe.Salt),
            recipe.Portions,
            recipe.FinishedGrams,
            draft.Amount,
            draft.Mode);
        if (scaled.Error is not null)
        {
            return ApiResults.Error(scaled.Error);
        }

        var time = draft.Time ?? LogEntryRules.NowIn(window.Zone, clock);
        var entry = new LogEntry
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            LocalDate = draft.LocalDate,
            LoggedAt = LogEntryRules.LocalTimestamp(draft.LocalDate, time),
            TimeZone = draft.TimeZone.Trim(),
            FoodId = null,
            FoodOwnerKey = Food.CatalogueOwnerKey,
            Source = RecipeRules.Source,
            SourceId = recipe.Id.ToString("D"),
            Grams = scaled.Grams,
            Name = recipe.Name,
            Amount = scaled.Amount,
            Unit = scaled.Unit,
            Kcal = scaled.Nutrients.Kcal,
            Protein = scaled.Nutrients.Protein,
            Fat = scaled.Nutrients.Fat,
            Carbs = scaled.Nutrients.Carbs,
            SaturatedFat = scaled.Nutrients.SaturatedFat,
            Sugars = scaled.Nutrients.Sugars,
            Fiber = scaled.Nutrients.Fiber,
            Salt = scaled.Nutrients.Salt,
            IdempotencyKey = draft.IdempotencyKey,
        };
        db.LogEntries.Add(entry);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            var raced = await db.LogEntries.AsNoTracking().FirstOrDefaultAsync(
                row => row.UserId == userId && row.IdempotencyKey == draft.IdempotencyKey,
                cancellationToken);
            if (raced is null)
            {
                throw;
            }

            return Results.Ok(ToLog(raced));
        }

        return Results.Json(ToLog(entry), statusCode: StatusCodes.Status201Created);
    }

    private static void AddIngredients(AppDbContext db, string userId, Guid recipeId, IReadOnlyList<RecipeRules.BuiltLine> lines)
    {
        for (var i = 0; i < lines.Count; i++)
        {
            var line = lines[i];
            db.RecipeIngredients.Add(new RecipeIngredient
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                RecipeId = recipeId,
                Position = i,
                FoodId = line.FoodId,
                FoodOwnerKey = line.FoodOwnerKey,
                Name = line.Name,
                Amount = line.Amount,
                Unit = line.Unit,
                Grams = line.Grams,
                Kcal = line.Nutrients.Kcal,
                Protein = line.Nutrients.Protein,
                Fat = line.Nutrients.Fat,
                Carbs = line.Nutrients.Carbs,
                SaturatedFat = line.Nutrients.SaturatedFat,
                Sugars = line.Nutrients.Sugars,
                Fiber = line.Nutrients.Fiber,
                Salt = line.Nutrients.Salt,
            });
        }
    }

    private static async Task<Built> BuildLines(
        AppDbContext db,
        string userId,
        WriteDraft draft,
        List<RecipeIngredient>? existing,
        CancellationToken cancellationToken)
    {
        var ids = draft.Ingredients.Select(row => row.FoodId).Distinct().ToList();
        var foods = await db.Foods
            .Where(food => ids.Contains(food.Id) && (food.UserId == null || food.UserId == userId))
            .ToListAsync(cancellationToken);
        var byId = foods.ToDictionary(food => food.Id);
        var servings = await db.UserServings.AsNoTracking()
            .Where(row => row.UserId == userId && ids.Contains(row.FoodId))
            .ToListAsync(cancellationToken);
        var pool = existing is null ? [] : existing.ToList();
        var keptByIndex = new RecipeIngredient?[draft.Ingredients.Count];
        if (existing is not null)
        {
            var pending = new List<int>();
            for (var i = 0; i < draft.Ingredients.Count; i++)
            {
                var input = draft.Ingredients[i];
                if (!byId.TryGetValue(input.FoodId, out var food) || food.RetiredAt is null)
                {
                    continue;
                }

                var exact = TakeKept(pool, food.Id, input.Amount, input.Unit, exactAmount: true);
                if (exact is not null)
                {
                    keptByIndex[i] = exact;
                }
                else
                {
                    pending.Add(i);
                }
            }

            foreach (var index in pending)
            {
                var input = draft.Ingredients[index];
                keptByIndex[index] = TakeKept(pool, input.FoodId, input.Amount, input.Unit, exactAmount: false);
            }
        }

        var lines = new List<RecipeRules.BuiltLine>(draft.Ingredients.Count);
        for (var i = 0; i < draft.Ingredients.Count; i++)
        {
            var input = draft.Ingredients[i];
            byId.TryGetValue(input.FoodId, out var food);
            var unit = input.Unit;
            decimal? ownGrams = null;
            if (food is not null && LogEntryRules.NormalizeUnit(unit) is null && unit.Trim().Length > 0)
            {
                var key = unit.Trim().ToLowerInvariant();
                var serving = servings.FirstOrDefault(row => row.FoodId == food.Id && row.NameKey == key);
                if (serving is not null)
                {
                    unit = serving.Name;
                    ownGrams = serving.Grams;
                }
            }

            var built = existing is null
                ? RecipeRules.BuildNew(food, userId, input.Amount, unit, ownGrams)
                : RecipeRules.BuildEdit(food, userId, input.Amount, unit, ownGrams, keptByIndex[i]);
            if (built.Status == RecipeRules.BuildStatus.NotFound)
            {
                return Built.Fail(built.Error ?? RecipeRules.MissingFood, StatusCodes.Status404NotFound);
            }

            if (built.Status != RecipeRules.BuildStatus.Ok)
            {
                return Built.Fail(built.Error ?? RecipeRules.NeedFood, StatusCodes.Status400BadRequest);
            }

            lines.Add(built);
        }

        var totals = RecipeRules.Sum(lines.Select(line => line.Nutrients));
        if (totals is null)
        {
            return Built.Fail(RecipeRules.TooLarge, StatusCodes.Status400BadRequest);
        }

        return new Built(null, StatusCodes.Status200OK, lines, totals);
    }

    private static RecipeIngredient? TakeKept(List<RecipeIngredient> pool, Guid foodId, decimal amount, string unit, bool exactAmount)
    {
        var kind = LogEntryRules.CanonicalUnit(unit);
        var rounded = LogEntryRules.Round2(amount);
        var index = pool.FindIndex(row =>
            row.FoodId == foodId
            && kind is not null
            && string.Equals(LogEntryRules.CanonicalUnit(row.Unit), kind, StringComparison.OrdinalIgnoreCase)
            && (!exactAmount || row.Amount == rounded));
        if (index < 0)
        {
            return null;
        }

        var kept = pool[index];
        pool.RemoveAt(index);
        return kept;
    }

    private static async Task<List<RecipeResponse>> Load(
        AppDbContext db,
        string userId,
        Guid? id,
        CancellationToken cancellationToken)
    {
        var recipes = await db.Recipes.AsNoTracking()
            .Where(row => row.UserId == userId && row.RetiredAt == null && (id == null || row.Id == id))
            .OrderByDescending(row => row.UpdatedAt)
            .ThenByDescending(row => row.Id)
            .ToListAsync(cancellationToken);
        if (recipes.Count == 0)
        {
            return [];
        }

        var recipeIds = recipes.Select(row => row.Id).ToList();
        var ingredients = await db.RecipeIngredients.AsNoTracking()
            .Where(row => row.UserId == userId && recipeIds.Contains(row.RecipeId))
            .OrderBy(row => row.Position)
            .ToListAsync(cancellationToken);
        var foodIds = ingredients.Select(row => row.FoodId).Distinct().ToList();
        var foods = foodIds.Count == 0
            ? []
            : await db.Foods.AsNoTracking()
                .Where(food => foodIds.Contains(food.Id) && (food.UserId == null || food.UserId == userId))
                .ToListAsync(cancellationToken);
        var byFood = foods.ToDictionary(food => food.Id);
        var byRecipe = ingredients.GroupBy(row => row.RecipeId).ToDictionary(group => group.Key, group => group.ToList());
        return recipes.Select(recipe => Project(recipe, byRecipe.GetValueOrDefault(recipe.Id) ?? [], byFood)).ToList();
    }

    private static RecipeResponse Project(Recipe recipe, IReadOnlyList<RecipeIngredient> ingredients, Dictionary<Guid, Food> foods)
    {
        var rows = ingredients.Select(item =>
        {
            var available = foods.TryGetValue(item.FoodId, out var food)
                && food.RetiredAt is null
                && (food.UserId is null || food.UserId == recipe.UserId);
            return new IngredientResponse(
                item.Id,
                item.FoodId,
                item.Name,
                item.Amount,
                item.Unit,
                item.Grams,
                item.Kcal,
                item.Protein,
                item.Fat,
                item.Carbs,
                available,
                item.SaturatedFat,
                item.Sugars,
                item.Fiber,
                item.Salt);
        }).ToList();
        var totals = new RecipeRules.Totals(recipe.Kcal, recipe.Protein, recipe.Fat, recipe.Carbs, recipe.SaturatedFat, recipe.Sugars, recipe.Fiber, recipe.Salt);
        var perPortion = RecipeRules.PerPortion(totals, recipe.Portions);
        var perGram = RecipeRules.PerGram(totals, recipe.FinishedGrams);
        return new RecipeResponse(
            recipe.Id,
            recipe.Name,
            recipe.Portions,
            recipe.FinishedGrams,
            recipe.Kcal,
            recipe.Protein,
            recipe.Fat,
            recipe.Carbs,
            Macro(perPortion),
            perGram is { } gram ? Macro(gram) : null,
            RecipeRules.RetiredNotice(rows.Where(row => !row.Available).Select(row => row.Name)),
            recipe.CreatedAt,
            recipe.UpdatedAt,
            rows,
            recipe.SaturatedFat,
            recipe.Sugars,
            recipe.Fiber,
            recipe.Salt);
    }

    private static MacroResponse Macro(RecipeRules.Totals totals) =>
        new(totals.Kcal, totals.Protein, totals.Fat, totals.Carbs, totals.SaturatedFat, totals.Sugars, totals.Fiber, totals.Salt);

    private static object ToLog(LogEntry entry) => new
    {
        id = entry.Id,
        localDate = entry.LocalDate,
        loggedAt = entry.LoggedAt,
        time = TimeOnly.FromDateTime(entry.LoggedAt).ToString("HH:mm"),
        timeZone = entry.TimeZone,
        foodId = entry.FoodId,
        groupId = entry.GroupId,
        source = entry.Source,
        sourceId = entry.SourceId,
        grams = entry.Grams,
        name = entry.Name,
        amount = entry.Amount,
        unit = entry.Unit,
        kcal = entry.Kcal,
        protein = entry.Protein,
        fat = entry.Fat,
        carbs = entry.Carbs,
        saturatedFat = entry.SaturatedFat,
        sugars = entry.Sugars,
        fiber = entry.Fiber,
        salt = entry.Salt,
        idempotencyKey = entry.IdempotencyKey,
        deletedAt = entry.DeletedAt,
    };

    private sealed record RecipeListResponse(IReadOnlyList<RecipeResponse> Recipes);

    private sealed record RecipeResponse(
        Guid Id,
        string Name,
        decimal Portions,
        decimal? FinishedGrams,
        decimal Kcal,
        decimal Protein,
        decimal Fat,
        decimal Carbs,
        MacroResponse PerPortion,
        MacroResponse? PerGram,
        string Notice,
        DateTimeOffset CreatedAt,
        DateTimeOffset UpdatedAt,
        IReadOnlyList<IngredientResponse> Ingredients,
        decimal? SaturatedFat = null,
        decimal? Sugars = null,
        decimal? Fiber = null,
        decimal? Salt = null);

    private sealed record IngredientResponse(
        Guid Id,
        Guid FoodId,
        string Name,
        decimal Amount,
        string Unit,
        decimal? Grams,
        decimal Kcal,
        decimal Protein,
        decimal Fat,
        decimal Carbs,
        bool Available,
        decimal? SaturatedFat = null,
        decimal? Sugars = null,
        decimal? Fiber = null,
        decimal? Salt = null);

    private sealed record MacroResponse(
        decimal Kcal,
        decimal Protein,
        decimal Fat,
        decimal Carbs,
        decimal? SaturatedFat = null,
        decimal? Sugars = null,
        decimal? Fiber = null,
        decimal? Salt = null);

    private sealed class WriteDraft
    {
        public string Name { get; init; } = "";

        public decimal Portions { get; init; }

        public decimal? FinishedGrams { get; init; }

        public List<IngredientDraft> Ingredients { get; init; } = [];
    }

    private sealed class IngredientDraft
    {
        public Guid FoodId { get; init; }

        public decimal Amount { get; init; }

        public string Unit { get; init; } = "";
    }

    private sealed class LogDraft
    {
        public DateOnly LocalDate { get; init; }

        public string TimeZone { get; init; } = "";

        public TimeOnly? Time { get; init; }

        public string IdempotencyKey { get; init; } = "";

        public decimal Amount { get; init; }

        public RecipeRules.LogMode Mode { get; init; }
    }

    private sealed record Built(
        string? Error,
        int Status,
        List<RecipeRules.BuiltLine>? Lines,
        RecipeRules.Totals? Totals)
    {
        public static Built Fail(string error, int status) => new(error, status, null, null);
    }

    private static async Task<(WriteDraft? Draft, string? Error)> ReadWrite(HttpRequest http, CancellationToken cancellationToken)
    {
        var root = await ReadRoot(http, cancellationToken);
        if (root.Error is not null)
        {
            return (null, root.Error);
        }

        using var json = root.Json;
        var body = json!.RootElement;
        var nameError = RecipeRules.RejectName(Text(body, "name"), out var name);
        if (nameError is not null)
        {
            return (null, nameError);
        }

        if (!body.TryGetProperty("portions", out var portionsElement) || !LogEntryRules.TryFlexible(portionsElement, out var portions))
        {
            return (null, RecipeRules.PortionsLimit);
        }

        portions = LogEntryRules.Round2(portions);
        var portionsError = RecipeRules.RejectPortions(portions);
        if (portionsError is not null)
        {
            return (null, portionsError);
        }

        decimal? finished = null;
        if (body.TryGetProperty("finishedGrams", out var finishedElement) && finishedElement.ValueKind != JsonValueKind.Null)
        {
            if (!LogEntryRules.TryFlexible(finishedElement, out var parsedFinished))
            {
                return (null, LogEntryRules.BadNumber);
            }

            finished = LogEntryRules.Round2(parsedFinished);
            var finishedError = RecipeRules.RejectFinished(finished);
            if (finishedError is not null)
            {
                return (null, finishedError);
            }
        }

        if (!body.TryGetProperty("ingredients", out var items) || items.ValueKind != JsonValueKind.Array)
        {
            return (null, RecipeRules.NeedIngredient);
        }

        if (items.GetArrayLength() == 0)
        {
            return (null, RecipeRules.NeedIngredient);
        }

        if (items.GetArrayLength() > RecipeRules.MaxIngredients)
        {
            return (null, RecipeRules.TooMany);
        }

        var list = new List<IngredientDraft>();
        foreach (var element in items.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                return (null, RecipeRules.NeedFood);
            }

            if (!element.TryGetProperty("foodId", out var foodElement)
                || foodElement.ValueKind != JsonValueKind.String
                || !Guid.TryParse(foodElement.GetString(), out var foodId))
            {
                return (null, RecipeRules.NeedFood);
            }

            if (!element.TryGetProperty("amount", out var amountElement) || !LogEntryRules.TryFlexible(amountElement, out var amount))
            {
                return (null, LogEntryRules.BadNumber);
            }

            var unit = Text(element, "unit") ?? "";
            if (LogEntryRules.CanonicalUnit(unit) is null)
            {
                return (null, LogEntryRules.NeedUnit);
            }

            list.Add(new IngredientDraft { FoodId = foodId, Amount = amount, Unit = unit.Trim() });
        }

        return (new WriteDraft
        {
            Name = name,
            Portions = portions,
            FinishedGrams = finished,
            Ingredients = list,
        }, null);
    }

    private static async Task<(LogDraft? Draft, string? Error)> ReadLog(HttpRequest http, CancellationToken cancellationToken)
    {
        var root = await ReadRoot(http, cancellationToken);
        if (root.Error is not null)
        {
            return (null, root.Error);
        }

        using var json = root.Json;
        var body = json!.RootElement;
        if (!LogEntryRules.TryDate(Text(body, "localDate"), out var localDate))
        {
            return (null, LogEntryRules.BadDate);
        }

        var zone = Text(body, "timeZone");
        if (string.IsNullOrWhiteSpace(zone))
        {
            return (null, LogEntryRules.UnknownZone);
        }

        TimeOnly? time = null;
        if (body.TryGetProperty("time", out var timeElement) && timeElement.ValueKind != JsonValueKind.Null)
        {
            if (timeElement.ValueKind != JsonValueKind.String || !LogEntryRules.TryTime(timeElement.GetString(), out var parsed))
            {
                return (null, LogEntryRules.BadTime);
            }

            time = parsed;
        }

        var key = Text(body, "idempotencyKey");
        if (string.IsNullOrWhiteSpace(key) || key.Trim().Length > 64)
        {
            return (null, LogEntryRules.NeedKey);
        }

        if (!body.TryGetProperty("amount", out var amountElement) || !LogEntryRules.TryFlexible(amountElement, out var amount))
        {
            return (null, LogEntryRules.BadNumber);
        }

        if (!RecipeRules.TryLogUnit(Text(body, "unit"), out var mode))
        {
            return (null, RecipeRules.NeedUnit);
        }

        return (new LogDraft
        {
            LocalDate = localDate,
            TimeZone = zone.Trim(),
            Time = time,
            IdempotencyKey = key.Trim(),
            Amount = amount,
            Mode = mode,
        }, null);
    }

    private static async Task<(JsonDocument? Json, string? Error)> ReadRoot(HttpRequest http, CancellationToken cancellationToken)
    {
        try
        {
            var document = await JsonDocument.ParseAsync(http.Body, cancellationToken: cancellationToken);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                document.Dispose();
                return (null, LogEntryRules.BadNumber);
            }

            return (document, null);
        }
        catch (JsonException)
        {
            return (null, LogEntryRules.BadNumber);
        }
    }

    private static string? Text(JsonElement json, string name)
    {
        if (!json.TryGetProperty(name, out var element) || element.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return element.GetString();
    }
}
