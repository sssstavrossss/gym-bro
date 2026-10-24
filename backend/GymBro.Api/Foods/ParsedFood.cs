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
    string? PieceLabel);

public enum OffStatus
{
    Ok,
    RateLimited,
    Unavailable,
}

public sealed record OffSearchOutcome(OffStatus Status, IReadOnlyList<ParsedFood> Foods);

public interface IOpenFoodFactsClient
{
    Task<OffSearchOutcome> SearchAsync(string query, CancellationToken cancellationToken);
}
