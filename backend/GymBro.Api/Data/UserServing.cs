namespace GymBro.Api.Data;

/// <summary>
/// A serving size one person added to a food ("1 slice = 35 g").
/// It belongs to that person only. Log entries keep their own gram snapshot,
/// so editing or removing this row does not rewrite history.
/// </summary>
public sealed class UserServing
{
    public Guid Id { get; set; }

    public string UserId { get; set; } = "";

    public Guid FoodId { get; set; }

    /// <summary>The name as the person typed it, with extra spaces collapsed.</summary>
    public string Name { get; set; } = "";

    /// <summary>Lowercase <see cref="Name"/>, so "Slice" and "slice" are the same serving.</summary>
    public string NameKey { get; set; } = "";

    public decimal Grams { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
