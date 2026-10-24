namespace GymBro.Api.Data;

/// <summary>
/// Whether the person marked the local day complete. An unmarked day is missing,
/// not a zero. The food-log screen that toggles this arrives in a later PR.
/// </summary>
public sealed class DayStatus
{
    public string UserId { get; set; } = "";

    public DateOnly LocalDate { get; set; }

    public bool Complete { get; set; }
}
