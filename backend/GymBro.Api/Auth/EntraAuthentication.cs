using GymBro.Api.Configuration;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Identity.Web;

namespace GymBro.Api.Auth;

public static class EntraAuthentication
{
    public static void AddEntraExternalId(this WebApplicationBuilder builder, EntraOptions entra)
    {
        // The API is a resource server. It validates tokens; it does not sign
        // users in and it has no client secret. The SPA is a public client
        // and proves possession of the auth code with PKCE.
        builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddMicrosoftIdentityWebApi(
                jwt =>
                {
                    // Leave claim types as they appear in the token (oid, scp, name).
                    jwt.MapInboundClaims = false;
                    jwt.TokenValidationParameters.NameClaimType = "name";

                    // v2 access tokens put the API client id in `aud`. v1 tokens put
                    // api://{client-id}. Accept both so the app registration's
                    // accessTokenAcceptedVersion does not matter.
                    jwt.TokenValidationParameters.ValidAudiences =
                    [
                        entra.ApiClientId,
                        entra.Audience,
                    ];

                    // CIAM access tokens use the tenant-id host as the issuer
                    // (https://{tenantId}.ciamlogin.com/{tenantId}/v2.0) while the
                    // OpenID metadata is downloaded from the subdomain host. Accept both.
                    jwt.TokenValidationParameters.ValidIssuers =
                    [
                        $"https://{entra.TenantId}.ciamlogin.com/{entra.TenantId}/v2.0",
                        $"https://{entra.TenantSubdomain}.ciamlogin.com/{entra.TenantId}/v2.0",
                    ];
                },
                identity =>
                {
                    // Instance + tenant id is the External ID (CIAM) authority:
                    // https://{subdomain}.ciamlogin.com/{tenantId}/v2.0
                    identity.Instance = $"https://{entra.TenantSubdomain}.ciamlogin.com/";
                    identity.TenantId = entra.TenantId;
                    identity.ClientId = entra.ApiClientId;
                });
    }
}
