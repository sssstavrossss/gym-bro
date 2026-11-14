namespace GymBro.Api.Data;

public static class NutrientBases
{
    /// <summary>Values in the nutrient columns are per 100 g or per 100 ml.</summary>
    public const string Per100 = "per_100";

    /// <summary>Values in the nutrient columns are for one serving, with no gram weight.</summary>
    public const string PerServing = "per_serving";

    /// <summary>Kassalapp did not say whether the numbers are per 100 g or per 100 ml. A log uses the unit chosen for that entry.</summary>
    public const string Unconfirmed = "unconfirmed";
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

    /// <summary>Optional label on a custom food so two foods with the same name can be told apart. Null on catalogue rows.</summary>
    public string? Brand { get; set; }

    public string Name { get; set; } = "";

    /// <summary>English name from Matvaretabellen. Null when the source has no English name. Search matches this as well as <see cref="Name"/>.</summary>
    public string? NameEn { get; set; }

    /// <summary>Folded <see cref="Name"/> used only for search. Null until startup or the next save fills it. Not shown in the API.</summary>
    public string? SearchName { get; set; }

    /// <summary>Folded <see cref="NameEn"/> used only for search.</summary>
    public string? SearchNameEn { get; set; }

    /// <summary>Folded <see cref="Brand"/> used only for search. Empty when the food has no brand.</summary>
    public string? SearchBrand { get; set; }

    /// <summary><c>g</c>, <c>ml</c>, or <c>serving</c>. Null when <see cref="NutrientBasis"/> is <see cref="NutrientBases.Unconfirmed"/>.</summary>
    public string? Basis { get; set; } = "g";

    public string NutrientBasis { get; set; } = NutrientBases.Per100;

    public decimal KcalPer100 { get; set; }

    public decimal ProteinPer100 { get; set; }

    public decimal FatPer100 { get; set; }

    public decimal CarbsPer100 { get; set; }

    /// <summary>Saturated fat, grams per 100 g or per serving. Null when the source did not publish it.</summary>
    public decimal? SaturatedFatPer100 { get; set; }

    /// <summary>Total sugars, grams. Null when unknown. Not added sugar alone.</summary>
    public decimal? SugarsPer100 { get; set; }

    /// <summary>Fibre, grams. Null when unknown.</summary>
    public decimal? FiberPer100 { get; set; }

    /// <summary>Salt, grams. Null when unknown. Never derived from sodium.</summary>
    public decimal? SaltPer100 { get; set; }

    public decimal? ServingQuantity { get; set; }

    public string? ServingLabel { get; set; }

    public decimal? PieceQuantity { get; set; }

    public string? PieceLabel { get; set; }

    public DateTimeOffset? RetiredAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
