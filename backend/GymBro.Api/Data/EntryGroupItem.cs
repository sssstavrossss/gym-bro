namespace GymBro.Api.Data;

/// <summary>
/// One food or quick-add inside a saved group. This is enough to log the item
/// again: the food when there is one, the amount, the unit, and the gram
/// equivalent. Quick-add rows have no food and keep the typed calories and macros.
/// A group is not a recipe; re-adding writes separate log entries.
/// </summary>
public sealed partial class EntryGroupItem
{
    public Guid Id { get; set; }

    public string UserId { get; set; } = "";

    public Guid GroupId { get; set; }

    public int Position { get; set; }

    public Guid? FoodId { get; set; }

    /// <summary>
    /// Empty when <see cref="FoodId"/> is a shared catalogue food.
    /// The owner's id when the food is custom. Must be empty or equal to <see cref="UserId"/>.
    /// </summary>
    public string FoodOwnerKey { get; set; } = Food.CatalogueOwnerKey;

    public string Name { get; set; } = "";

    public decimal Amount { get; set; }

    public string Unit { get; set; } = "";

    /// <summary>Gram equivalent saved with the item. Null for quick add, millilitres, and per-serving foods.</summary>
    public decimal? Grams { get; set; }

    public decimal Kcal { get; set; }

    public decimal Protein { get; set; }

    public decimal Fat { get; set; }

    public decimal Carbs { get; set; }

    public decimal? SaturatedFat { get; set; }

    public decimal? Sugars { get; set; }

    public decimal? Fiber { get; set; }

    public decimal? Salt { get; set; }
}
