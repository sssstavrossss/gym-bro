namespace GymBro.Api.Data;

/// <summary>
/// One catalogue or custom food inside a recipe, with the amount and the
/// nutrition snapshot taken when the recipe was saved. Quick add is not an
/// ingredient. A retired food leaves this row in place so the recipe total
/// can stay.
/// </summary>
public sealed partial class RecipeIngredient
{
    public Guid Id { get; set; }

    public string UserId { get; set; } = "";

    public Guid RecipeId { get; set; }

    public int Position { get; set; }

    public Guid FoodId { get; set; }

    /// <summary>
    /// Empty when <see cref="FoodId"/> is a shared catalogue food.
    /// The owner's id when the food is custom. Must be empty or equal to <see cref="UserId"/>.
    /// </summary>
    public string FoodOwnerKey { get; set; } = Food.CatalogueOwnerKey;

    public string Name { get; set; } = "";

    public decimal Amount { get; set; }

    public string Unit { get; set; } = "";

    /// <summary>Gram equivalent from the food's own basis. Null for millilitres and per-serving foods.</summary>
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
