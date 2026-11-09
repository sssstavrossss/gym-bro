namespace GymBro.Api.Data;

/// <summary>
/// Whether the person marked the local day complete. An unmarked day is missing,
/// not a zero. No row means unmarked. Unticking deletes the row.
/// Fasting is only stored with a complete empty day. It is not a separate control,
/// and changing that day's entries does not clear either flag.
/// </summary>
public sealed class DayStatus
{
    public string UserId { get; set; } = "";

    public DateOnly LocalDate { get; set; }

    public bool Complete { get; set; }

    /// <summary>
    /// A fasting day is a complete day the person confirmed as 0 kcal.
    /// Entries added afterwards are kept and do not clear this flag.
    /// </summary>
    public bool Fasting { get; set; }
}
