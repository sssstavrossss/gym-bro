namespace GymBro.Api.Data;

/// <summary>
/// A named set of foods or quick-adds, private to one user.
/// Re-adding it writes new log entries; it is not a combined recipe food.
/// </summary>
public sealed class EntryGroup
{
    public Guid Id { get; set; }

    public string UserId { get; set; } = "";

    public string Name { get; set; } = "";

    public DateTimeOffset CreatedAt { get; set; }
}
