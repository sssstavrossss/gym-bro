using System.Security.Claims;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using GymBro.Api.Users;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Endpoints;

public sealed class CustomFoodRequest
{
    public string? Name { get; set; }

    public decimal KcalPer100 { get; set; }

    public decimal ProteinPer100 { get; set; }

    public decimal FatPer100 { get; set; }

    public decimal CarbsPer100 { get; set; }

    public string? Basis { get; set; }

    public string? Barcode { get; set; }

    public decimal? ServingQuantity { get; set; }

    public string? ServingLabel { get; set; }

    public decimal? PieceQuantity { get; set; }

    public string? PieceLabel { get; set; }
}

public sealed class OffSearchRequest
{
    public string? Query { get; set; }
}

public static class FoodEndpoints
{
    public static RouteGroupBuilder MapFoods(this RouteGroupBuilder api)
    {
        api.MapGet("/foods/search", Search);
        api.MapPost("/foods/search/open-food-facts", SearchOpenFoodFacts);
        api.MapPost("/foods", Create);
        api.MapGet("/foods/{id:guid}", Get);
        api.MapPut("/foods/{id:guid}", Update);
        api.MapDelete("/foods/{id:guid}", Delete);
        api.MapGet("/about", About);
        return api;
    }

    private static async Task<IResult> Search(
        ClaimsPrincipal principal,
        string? q,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var query = (q ?? "").Trim();
        var error = FoodCatalog.ValidateQuery(query);
        if (error is not null)
        {
            return ApiResults.Error(error);
        }

        var foods = await FoodCatalog.SearchAsync(db, Caller.Id(principal), query, cancellationToken);
        return Results.Ok(new { query, foods = foods.Select(ToResponse).ToList() });
    }

    private static async Task<IResult> SearchOpenFoodFacts(
        ClaimsPrincipal principal,
        OffSearchRequest request,
        AppDbContext db,
        IOpenFoodFactsClient off,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var query = (request.Query ?? "").Trim();
        var error = FoodCatalog.ValidateQuery(query);
        if (error is not null)
        {
            return ApiResults.Error(error);
        }

        var userId = Caller.Id(principal);
        var localBefore = await FoodCatalog.SearchAsync(db, userId, query, cancellationToken);
        var outcome = await off.SearchAsync(query, cancellationToken);
        IReadOnlyDictionary<string, Guid> cachedIds = new Dictionary<string, Guid>();
        if (outcome.Status == OffStatus.Ok && outcome.Foods.Count > 0)
        {
            cachedIds = await FoodCatalog.UpsertCatalogAsync(db, outcome.Foods, clock, cancellationToken);
        }

        return Results.Ok(new
        {
            query,
            local = localBefore.Select(ToResponse).ToList(),
            openFoodFacts = new
            {
                status = outcome.Status switch
                {
                    OffStatus.Ok => "ok",
                    OffStatus.RateLimited => "rate_limited",
                    _ => "unavailable",
                },
                results = outcome.Foods.Select(food => ToParsedResponse(
                    food,
                    cachedIds.TryGetValue(food.SourceId, out var id) ? id : null)).ToList(),
            },
        });
    }

    private static async Task<IResult> Create(
        ClaimsPrincipal principal,
        CustomFoodRequest request,
        AppDbContext db,
        UserDirectory users,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var error = ValidateCustom(request, out var normalized);
        if (error is not null)
        {
            return ApiResults.Error(error);
        }

        await users.UpsertAsync(principal, cancellationToken);
        var userId = Caller.Id(principal);
        var id = Guid.NewGuid();
        var food = new Food
        {
            Id = id,
            UserId = userId,
            Source = "custom",
            SourceId = id.ToString("N"),
            UpdatedAt = clock.GetUtcNow(),
        };
        Apply(food, normalized);
        db.Foods.Add(food);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Json(ToResponse(food), statusCode: StatusCodes.Status201Created);
    }

    private static async Task<IResult> Get(
        ClaimsPrincipal principal,
        Guid id,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var food = await FindVisible(db, Caller.Id(principal), id, cancellationToken);
        return food is null
            ? ApiResults.Error("No food with that id.", StatusCodes.Status404NotFound)
            : Results.Ok(ToResponse(food));
    }

    private static async Task<IResult> Update(
        ClaimsPrincipal principal,
        Guid id,
        CustomFoodRequest request,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var error = ValidateCustom(request, out var normalized);
        if (error is not null)
        {
            return ApiResults.Error(error);
        }

        var userId = Caller.Id(principal);
        var food = await db.Foods.FirstOrDefaultAsync(
            row => row.Id == id && row.UserId == userId && row.Source == "custom" && row.RetiredAt == null,
            cancellationToken);
        if (food is null)
        {
            return ApiResults.Error("No food with that id.", StatusCodes.Status404NotFound);
        }

        Apply(food, normalized);
        food.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(ToResponse(food));
    }

    private static async Task<IResult> Delete(
        ClaimsPrincipal principal,
        Guid id,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var food = await db.Foods.FirstOrDefaultAsync(
            row => row.Id == id && row.UserId == userId && row.Source == "custom" && row.RetiredAt == null,
            cancellationToken);
        if (food is null)
        {
            return ApiResults.Error("No food with that id.", StatusCodes.Status404NotFound);
        }

        food.RetiredAt = clock.GetUtcNow();
        food.UpdatedAt = food.RetiredAt.Value;
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> About(ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var credit = await db.FoodSourceCredits.AsNoTracking()
            .FirstOrDefaultAsync(row => row.Source == Matvaretabellen.Source, cancellationToken);
        return Results.Ok(new
        {
            matvaretabellen = Matvaretabellen.Citation,
            importedAt = credit?.ImportedAt,
            foodCount = credit?.FoodCount ?? 0,
        });
    }

    private static async Task<Food?> FindVisible(AppDbContext db, string userId, Guid id, CancellationToken cancellationToken) =>
        await FoodCatalog.Visible(db.Foods.AsNoTracking(), userId)
            .FirstOrDefaultAsync(food => food.Id == id, cancellationToken);

    private static string? ValidateCustom(CustomFoodRequest request, out CustomFoodRequest normalized)
    {
        normalized = request;
        var name = (request.Name ?? "").Trim();
        if (name.Length is < 1 or > 200)
        {
            return "Give the food a name.";
        }

        if (request.KcalPer100 < 0 || request.KcalPer100 > 1200)
        {
            return "Calories per 100 should be between 0 and 1,200.";
        }

        if (request.ProteinPer100 < 0 || request.FatPer100 < 0 || request.CarbsPer100 < 0
            || request.ProteinPer100 > 100 || request.FatPer100 > 100 || request.CarbsPer100 > 100)
        {
            return "Protein, fat, and carbs per 100 should be between 0 and 100 g.";
        }

        var basis = (request.Basis ?? "g").Trim().ToLowerInvariant();
        if (basis is not ("g" or "ml"))
        {
            return "Choose grams or millilitres.";
        }

        var barcode = (request.Barcode ?? "").Trim();
        if (barcode.Length > 0 && (barcode.Length > 32 || barcode.Any(ch => !char.IsAsciiDigit(ch))))
        {
            return "A barcode should be digits only.";
        }

        if (request.ServingQuantity is < 0 or > 5000 || request.PieceQuantity is < 0 or > 5000)
        {
            return "Serving and piece sizes should be between 0 and 5,000.";
        }

        normalized = new CustomFoodRequest
        {
            Name = name,
            KcalPer100 = request.KcalPer100,
            ProteinPer100 = request.ProteinPer100,
            FatPer100 = request.FatPer100,
            CarbsPer100 = request.CarbsPer100,
            Basis = basis,
            Barcode = barcode.Length == 0 ? null : barcode,
            ServingQuantity = request.ServingQuantity is > 0 ? request.ServingQuantity : null,
            ServingLabel = string.IsNullOrWhiteSpace(request.ServingLabel) ? null : request.ServingLabel.Trim(),
            PieceQuantity = request.PieceQuantity is > 0 ? request.PieceQuantity : null,
            PieceLabel = string.IsNullOrWhiteSpace(request.PieceLabel) ? null : request.PieceLabel.Trim(),
        };
        return null;
    }

    private static void Apply(Food food, CustomFoodRequest request)
    {
        food.Name = request.Name ?? "";
        food.KcalPer100 = request.KcalPer100;
        food.ProteinPer100 = request.ProteinPer100;
        food.FatPer100 = request.FatPer100;
        food.CarbsPer100 = request.CarbsPer100;
        food.Basis = request.Basis ?? "g";
        food.Barcode = request.Barcode;
        food.ServingQuantity = request.ServingQuantity;
        food.ServingLabel = request.ServingLabel;
        food.PieceQuantity = request.PieceQuantity;
        food.PieceLabel = request.PieceLabel;
    }

    public static object ToResponse(Food food) => new
    {
        id = food.Id,
        source = food.Source,
        sourceId = food.SourceId,
        barcode = food.Barcode,
        name = food.Name,
        basis = food.Basis,
        kcalPer100 = food.KcalPer100,
        proteinPer100 = food.ProteinPer100,
        fatPer100 = food.FatPer100,
        carbsPer100 = food.CarbsPer100,
        servingQuantity = food.ServingQuantity,
        servingLabel = food.ServingLabel,
        pieceQuantity = food.PieceQuantity,
        pieceLabel = food.PieceLabel,
        owned = food.UserId is not null,
    };

    private static object ToParsedResponse(ParsedFood food, Guid? id) => new
    {
        id,
        source = food.Source,
        sourceId = food.SourceId,
        barcode = food.Barcode,
        name = food.Name,
        basis = food.Basis,
        kcalPer100 = food.KcalPer100,
        proteinPer100 = food.ProteinPer100,
        fatPer100 = food.FatPer100,
        carbsPer100 = food.CarbsPer100,
        servingQuantity = food.ServingQuantity,
        servingLabel = food.ServingLabel,
        pieceQuantity = food.PieceQuantity,
        pieceLabel = food.PieceLabel,
    };
}
