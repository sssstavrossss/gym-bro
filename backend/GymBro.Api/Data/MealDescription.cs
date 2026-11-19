namespace GymBro.Api.Data;

/// <summary>
/// One "Describe a meal" request. A row is saved for each answer so a day's requests can be counted
/// and a logged one can be used again. <see cref="Items"/> is JSON: the foods as last logged (or as matched
/// until then), each with phrase, name, guessed, food id, amount and unit. <see cref="FoodCount"/> and
/// <see cref="Kcal"/> describe it for the recent list. <see cref="LoggedAt"/> is null until the foods are added.
/// </summary>
public sealed class MealDescription
{
    public Guid Id { get; set; }

    public string UserId { get; set; } = "";

    public string Text { get; set; } = "";

    public string Items { get; set; } = "[]";

    public int FoodCount { get; set; }

    public decimal Kcal { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? LoggedAt { get; set; }
}
