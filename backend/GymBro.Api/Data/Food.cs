namespace GymBro.Api.Data;

/// <summary>
/// A food from Matvaretabellen (<c>mvt</c>), a cached Open Food Facts product
/// (<c>off</c>), or a private custom food. Catalog rows have a null
/// <see cref="UserId"/>. Custom rows are owned by one Entra <c>oid</c> and
/// every query that reads them filters on that id.
/// Nutrients are per 100 g or per 100 ml. <see cref="KcalPer100"/> is the
/// label kilocalorie value from the source, not a 4/9/4 estimate.
/// </summary>
public sealed class Food
{
    public Guid Id { get; set; }

    public string? UserId { get; set; }

    public string Source { get; set; } = "";

    public string SourceId { get; set; } = "";

    public string? Barcode { get; set; }

    public string Name { get; set; } = "";

    /// <summary><c>g</c> or <c>ml</c>. Nutrients are per 100 of this unit.</summary>
    public string Basis { get; set; } = "g";

    public decimal KcalPer100 { get; set; }

    public decimal ProteinPer100 { get; set; }

    public decimal FatPer100 { get; set; }

    public decimal CarbsPer100 { get; set; }

    public decimal? ServingQuantity { get; set; }

    public string? ServingLabel { get; set; }

    public decimal? PieceQuantity { get; set; }

    public string? PieceLabel { get; set; }

    public DateTimeOffset? RetiredAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
