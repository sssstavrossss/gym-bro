using System.Security.Claims;
using System.Text.Encodings.Web;
using GymBro.Api.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace GymBro.Api.Tests;

/// <summary>
/// Stands in for Entra. A request is authenticated only when it carries
/// <c>X-Test-Oid</c>. The scope defaults to <c>access_as_user</c>; send
/// <c>X-Test-Scope</c> to exercise a token that is signed but not authorized.
/// </summary>
public sealed class TestAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public const string SchemeName = "Test";

    public TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : base(options, logger, encoder)
    {
    }

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("X-Test-Oid", out var objectId) || string.IsNullOrWhiteSpace(objectId))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var claims = new List<Claim> { new("oid", objectId.ToString()) };

        if (Request.Headers.TryGetValue("X-Test-Name", out var name) && !string.IsNullOrWhiteSpace(name))
        {
            claims.Add(new Claim("name", name.ToString()));
        }

        if (Request.Headers.TryGetValue("X-Test-Email", out var email) && !string.IsNullOrWhiteSpace(email))
        {
            claims.Add(new Claim("preferred_username", email.ToString()));
        }

        var scope = Request.Headers.TryGetValue("X-Test-Scope", out var rawScope)
            ? rawScope.ToString()
            : ApiAccess.ScopeName;
        if (!string.IsNullOrWhiteSpace(scope))
        {
            claims.Add(new Claim("scp", scope));
        }

        var identity = new ClaimsIdentity(claims, authenticationType: SchemeName);
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
