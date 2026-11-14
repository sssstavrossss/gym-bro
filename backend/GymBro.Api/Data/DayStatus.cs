namespace GymBro.Api.Data;

/// <summary>
/// A local day the person has marked. <see cref="Complete"/> is kept in the
/// database and is no longer written. <see cref="Fasting"/> is its own mark:
/// the person sets and clears it, and logging food does not clear it.
/// </summary>
public sealed class DayStatus
{
    public string UserId { get; set; } = "";

    public DateOnly LocalDate { get; set; }

    /// <summary>Retired. Left in place so old rows are not destroyed.</summary>
    public bool Complete { get; set; }

    /// <summary>The person marked this day as fasting. The recalculate review does not treat it differently.</summary>
    public bool Fasting { get; set; }
}
