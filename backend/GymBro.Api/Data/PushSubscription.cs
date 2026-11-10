namespace GymBro.Api.Data;

/// <summary>One browser push subscription. The endpoint is unique across the whole database.</summary>
public sealed class PushSubscription
{
    public long Id { get; set; }

    public string UserId { get; set; } = "";

    public string Endpoint { get; set; } = "";

    public string P256dh { get; set; } = "";

    public string Auth { get; set; } = "";

    public DateTimeOffset CreatedAt { get; set; }
}
