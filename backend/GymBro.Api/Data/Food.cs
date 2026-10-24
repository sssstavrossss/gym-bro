namespace GymBro.Api.Data;

public static class NutrientBases
{
    /// <summary>Values in the nutrient columns are per 100 g or per 100 ml.</summary>
    public const string Per100 = "per_100";

    /// <summary>Values in the nutrient columns are for one serving, with no gram weight.</summary>
    public const string PerServing = "per_serving";
}

/// <summary>
/// A food from Matvaretabellen (<c>mvt</c>), a cached Open Food Facts product
/// (<c>off</c>), or a private custom food. Catalog rows have a null
/// <see cref="UserId"/>. Custom rows are owned by one Entra <c>oid</c> and
/// every query that reads them filters on that id.
/// <see cref="KcalPer100"/> is the label kilocalorie value from the source, not a 4/9/4 estimate.
/// When <see cref="NutrientBasis"/> is <see cref="NutrientBases.Per100"/>, nutrients are per 100 g or ml.
/// When it is <see cref="NutrientBases.PerServing"/>, the same columns hold one serving and there is no gram weight.
/// <see cref="OwnerKey"/> is <see cref="UserId"/>, or an empty string for a shared catalogue row,
/// so a log entry can foreign-key either kind of food.
/// </summary>
public sealed class Food
{
    public const string CatalogueOwnerKey = "";

    public Guid Id { get; set; }

    public string? UserId { get; set; }

    /// <summary>Empty for catalogue foods. Equal to <see cref="UserId"/> for a custom food. Database-generated.</summary>
    public string OwnerKey { get; set; } = CatalogueOwnerKey;

    public string Source { get; set; } = "";

    public string SourceId { get; set; } = "";

    public string? Barcode { get; set; }

    public string Name { get; set; } = "";

    /// <summary><c>g</c>, <c>ml</c>, or <c>serving</c>. See <see cref="NutrientBasis"/>.</summary>
    public string Basis { get; set; } = "g";

    public string NutrientBasis { get; set; } = NutrientBases.Per100;

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
