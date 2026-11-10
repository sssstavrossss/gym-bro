namespace GymBro.Api.Data;

/// <summary>
/// One in-app notification. <see cref="Type"/> is <c>recalculate</c> for the weekly
/// reminder. Later news can use another type with the same title, body, and link.
/// </summary>
public sealed class UserNotification
{
    public long Id { get; set; }

    public string UserId { get; set; } = "";

    public string Type { get; set; } = "";

    public string Title { get; set; } = "";

    public string Body { get; set; } = "";

    public string Link { get; set; } = "";

    /// <summary>Set for the weekly reminder so a week has one row. Null for other types.</summary>
    public DateOnly? WeekStart { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? ReadAt { get; set; }
}
