using System.Security.Claims;
using System.Text.Json;

namespace GymBro.Api.Auth;

/// <summary>
/// Reads the claims we store on the user. Entra's access token uses the short
/// names (<c>oid</c>, <c>name</c>, <c>preferred_username</c>) when inbound claim
/// mapping is off. The long URI forms are accepted too, in case a host maps them.
/// </summary>
public static class ClaimsReader
{
    private const string ObjectIdLong = "http://schemas.microsoft.com/identity/claims/objectidentifier";
    private const string EmailLong = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress";
    private const string NameLong = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name";
    private const string GivenLong = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname";
    private const string FamilyLong = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname";

    /// <summary>
    /// Object id of the user in the tenant. This is the stable key.
    /// <c>sub</c> is not used: Entra can make it pairwise per application.
    /// </summary>
    public static string? ObjectId(ClaimsPrincipal user) => First(user, "oid", ObjectIdLong);

    public static string? Email(ClaimsPrincipal user)
    {
        var email = First(user, "email", EmailLong);
        if (!string.IsNullOrWhiteSpace(email))
        {
            return email;
        }

        // For an External ID local account the sign-in name is usually the email.
        var username = First(user, "preferred_username");
        if (!string.IsNullOrWhiteSpace(username) && username.Contains('@', StringComparison.Ordinal))
        {
            return username;
        }

        // Some tokens put addresses in an "emails" claim, as one string or a JSON array.
        var emails = First(user, "emails");
        if (string.IsNullOrWhiteSpace(emails))
        {
            return null;
        }

        if (!emails.StartsWith('['))
        {
            return emails;
        }

        try
        {
            var values = JsonSerializer.Deserialize<string[]>(emails);
            return values?.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static string? DisplayName(ClaimsPrincipal user)
    {
        var name = First(user, "name", NameLong);
        if (!string.IsNullOrWhiteSpace(name))
        {
            return name;
        }

        var given = First(user, "given_name", GivenLong);
        var family = First(user, "family_name", FamilyLong);
        var combined = string.Join(' ', new[] { given, family }.Where(part => !string.IsNullOrWhiteSpace(part)));
        return string.IsNullOrWhiteSpace(combined) ? null : combined;
    }

    private static string? First(ClaimsPrincipal user, params string[] types)
    {
        foreach (var type in types)
        {
            var value = user.FindFirst(type)?.Value;
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value;
            }
        }

        return null;
    }
}
