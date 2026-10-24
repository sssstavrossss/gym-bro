using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace GymBro.Api.Auth;

/// <summary>
/// Browser end-to-end tests only. Registered when the environment is E2e and
/// E2E_AUTH=true. A request is authenticated only with X-Test-Oid. This must
/// never be turned on for a deployment people actually use.
/// </summary>
public sealed class E2eAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public const string SchemeName = "E2e";

    public E2eAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : base(options, logger, encoder)
    {
    }

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var environment = Context.RequestServices.GetRequiredService<IHostEnvironment>();
        if (!environment.IsEnvironment("E2e"))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

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
