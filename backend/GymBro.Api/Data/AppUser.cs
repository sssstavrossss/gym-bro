namespace GymBro.Api.Data;

/// <summary>
/// One row per signed-in person. <see cref="ObjectId"/> is the Entra <c>oid</c> claim.
/// Column names are snake_case; the JSON API is camelCase.
/// </summary>
public sealed class AppUser
{
    public string ObjectId { get; set; } = "";

    public string? DisplayName { get; set; }

    public string? Email { get; set; }

    public DateTimeOffset FirstSeenAt { get; set; }

    public DateTimeOffset LastSeenAt { get; set; }
}
