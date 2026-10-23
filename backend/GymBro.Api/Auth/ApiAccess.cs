using System.Security.Claims;

namespace GymBro.Api.Auth;

public static class ApiAccess
{
    public const string PolicyName = "ApiAccess";

    public const string ScopeName = "access_as_user";

    /// <summary>
    /// The SPA requests <c>api://&lt;api-client-id&gt;/access_as_user</c>.
    /// Entra puts the short name in the <c>scp</c> claim (space-separated when
    /// there is more than one). Accept the short name or the full scope value.
    /// </summary>
    public static bool HasAcceptedScope(ClaimsPrincipal user)
    {
        var scopeClaims = user.FindAll("scp")
            .Concat(user.FindAll("http://schemas.microsoft.com/identity/claims/scope"));

        foreach (var claim in scopeClaims)
        {
            foreach (var part in claim.Value.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (part.Equals(ScopeName, StringComparison.Ordinal) ||
                    part.EndsWith("/" + ScopeName, StringComparison.Ordinal))
                {
                    return true;
                }
            }
        }

        return false;
    }
}
