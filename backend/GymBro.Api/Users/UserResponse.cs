using GymBro.Api.Data;

namespace GymBro.Api.Users;

public sealed record UserResponse(
    string ObjectId,
    string? DisplayName,
    string? Email,
    DateTimeOffset FirstSeenAt,
    DateTimeOffset LastSeenAt)
{
    public static UserResponse From(AppUser user) => new(
        user.ObjectId,
        user.DisplayName,
        user.Email,
        user.FirstSeenAt,
        user.LastSeenAt);
}
