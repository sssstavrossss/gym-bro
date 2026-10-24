namespace GymBro.Api.Data;

/// <summary>
/// Targets in effect from <see cref="EffectiveDate"/>. A later row on the same
/// date wins. Past days keep the row that was in effect then.
/// <see cref="FloorApplied"/> is separate from <see cref="Reason"/>: the reason
/// is what triggered the row, and the flag says the calorie floor raised it to BMR.
/// </summary>
public sealed class TargetHistory
{
    public long Id { get; set; }

    public string UserId { get; set; } = "";

    public DateOnly EffectiveDate { get; set; }

    public int Bmr { get; set; }

    public int Tdee { get; set; }

    public int Kcal { get; set; }

    public int ProteinGrams { get; set; }

    public int FatGrams { get; set; }

    public int CarbGrams { get; set; }

    public bool FloorApplied { get; set; }

    public string Reason { get; set; } = "";

    /// <summary>Body weight the numbers were calculated from, in kilograms.</summary>
    public decimal WeightKg { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}
