namespace GymBro.Api.Data;

/// <summary>A reminder already sent for one local day, so Monday does not fire twice.</summary>
public sealed class ReminderSend
{
    public string UserId { get; set; } = "";

    public DateOnly LocalDate { get; set; }

    public string Kind { get; set; } = "";

    public DateTimeOffset SentAt { get; set; }
}
