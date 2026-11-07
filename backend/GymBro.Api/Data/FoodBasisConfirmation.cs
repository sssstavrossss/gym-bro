namespace GymBro.Api.Data;

/// <summary>
/// One person's choice that a Kassalapp food's numbers are per 100 g or per 100 ml.
/// It does not change the shared catalogue row.
/// </summary>
public sealed class FoodBasisConfirmation
{
    public Guid Id { get; set; }

    public string UserId { get; set; } = "";

    public Guid FoodId { get; set; }

    public string Basis { get; set; } = "";

    /// <summary>The kcal and macros this choice was made for. A later nutrition change does not reuse it.</summary>
    public string NutritionStamp { get; set; } = "";

    public DateTimeOffset ConfirmedAt { get; set; }
}
