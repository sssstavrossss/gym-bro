namespace GymBro.Api.Foods;

public sealed record ParsedFood(
    string Source,
    string SourceId,
    string? Barcode,
    string Name,
    string Basis,
    decimal KcalPer100,
    decimal ProteinPer100,
    decimal FatPer100,
    decimal CarbsPer100,
    decimal? ServingQuantity,
    string? ServingLabel,
    decimal? PieceQuantity,
    string? PieceLabel,
    decimal? SaturatedFatPer100 = null,
    decimal? SugarsPer100 = null,
    decimal? FiberPer100 = null,
    decimal? SaltPer100 = null)
{
    public Dictionary<string, decimal?> Panel { get; init; } = [];
}

public enum OffStatus
{
    Ok,
    RateLimited,
    Unavailable,
}

public sealed record OffParse(IReadOnlyList<ParsedFood> Foods, int MissingKcal);

public sealed record OffSearchOutcome(OffStatus Status, IReadOnlyList<ParsedFood> Foods, int MissingKcal = 0);

public sealed record OffProductOutcome(OffStatus Status, ParsedFood? Food);

public interface IOpenFoodFactsClient
{
    Task<OffSearchOutcome> SearchAsync(string query, CancellationToken cancellationToken);

    Task<OffProductOutcome> GetProductAsync(string code, CancellationToken cancellationToken);
}
