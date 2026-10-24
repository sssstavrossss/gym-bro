namespace GymBro.Api.Data;

/// <summary>Citation stored when a catalog source is imported.</summary>
public sealed class FoodSourceCredit
{
    public string Source { get; set; } = "";

    public string Citation { get; set; } = "";

    public DateTimeOffset ImportedAt { get; set; }

    public int FoodCount { get; set; }
}
