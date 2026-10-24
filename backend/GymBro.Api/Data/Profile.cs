namespace GymBro.Api.Data;

/// <summary>
/// One profile per signed-in person. <see cref="UserId"/> is the Entra <c>oid</c>.
/// Macro defaults live here too: protein Normal is 2.0 g/kg and fat Normal is 25%.
/// </summary>
public sealed class Profile
{
    public string UserId { get; set; } = "";

    public string Sex { get; set; } = "";

    public int BirthYear { get; set; }

    public decimal HeightCm { get; set; }

    public string Activity { get; set; } = "";

    public string Goal { get; set; } = "";

    /// <summary>Null while the goal is maintain. Otherwise 0.25, 0.5, 0.75, or 1.0.</summary>
    public decimal? RateKgPerWeek { get; set; }

    public decimal GoalWeightKg { get; set; }

    public string ProteinSetting { get; set; } = "";

    public decimal ProteinGramsPerKg { get; set; }

    public string FatSetting { get; set; } = "";

    public decimal FatPercent { get; set; }

    /// <summary>IANA time zone. Monday and "today" are decided in this zone.</summary>
    public string TimeZone { get; set; } = "";

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
