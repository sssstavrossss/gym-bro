namespace GymBro.Api.Data;

/// <summary>
/// A named dish belonging to one person. The kcal and macro columns are the
/// summed ingredient snapshot from the last save. Later food edits do not
/// change this row until the recipe is saved again, and a logged entry keeps
/// its own copy. <see cref="RetiredAt"/> hides it from Add food. Past logs stay.
/// </summary>
public sealed class Recipe
{
    public Guid Id { get; set; }

    public string UserId { get; set; } = "";

    public string Name { get; set; } = "";

    /// <summary>How many portions the ingredient list makes. Greater than 0.</summary>
    public decimal Portions { get; set; }

    /// <summary>Optional cooked weight of the whole recipe, in grams. Null when the person did not enter one.</summary>
    public decimal? FinishedGrams { get; set; }

    public decimal Kcal { get; set; }

    public decimal Protein { get; set; }

    public decimal Fat { get; set; }

    public decimal Carbs { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public DateTimeOffset? RetiredAt { get; set; }
}
