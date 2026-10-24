namespace GymBro.Api.Data;

/// <summary>
/// Targets in effect on <see cref="EffectiveDate"/>. One row per user per date.
/// A later change the same day updates this row: the numbers are the latest
/// calculation, and <see cref="Reasons"/> keeps every reason that applied.
/// <see cref="FloorApplied"/> is separate from the reasons: a reason says what
/// triggered the row, and the flag says the calorie floor raised it to BMR.
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

    /// <summary>
    /// Every reason that wrote this date, in the order they first applied.
    /// Known values: <c>profile_change</c>, <c>macro_balance_change</c>, <c>weekly_recalculation</c>.
    /// </summary>
    public string[] Reasons { get; set; } = [];

    /// <summary>Body weight the numbers were calculated from, in kilograms.</summary>
    public decimal WeightKg { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public string LatestReason => Reasons.Length == 0 ? "" : Reasons[^1];
}
