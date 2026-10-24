namespace GymBro.Api.Data;

/// <summary>A named set of entries that were logged together. Optional.</summary>
public sealed class EntryGroup
{
    public Guid Id { get; set; }

    public string UserId { get; set; } = "";

    public string Name { get; set; } = "";

    public DateTimeOffset CreatedAt { get; set; }
}
