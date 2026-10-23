using System.Security.Claims;
using GymBro.Api.Auth;
using GymBro.Api.Configuration;
using GymBro.Api.Data;
using GymBro.Api.Users;
using Microsoft.Extensions.Options;

namespace GymBro.Api.Endpoints;

public static class GymBroEndpoints
{
    public static WebApplication MapGymBro(this WebApplication app)
    {
        // Anonymous on purpose: the SPA has to read this before it can sign in,
        // and the same image is configured from the environment at startup.
        app.MapGet("/config.json", (HttpContext http, IOptions<EntraOptions> entra) =>
        {
            http.Response.Headers.CacheControl = "no-store";
            var value = entra.Value;
            return Results.Json(new PublicClientConfig(
                value.TenantSubdomain,
                value.TenantId,
                value.SpaClientId,
                value.ApiClientId,
                value.Scope));
        });

        var api = app.MapGroup("/api").RequireAuthorization(ApiAccess.PolicyName);
        api.MapGet("/health", Health).AllowAnonymous();
        api.MapGet("/me", Me);
        api.MapFallback(() => Results.Json(new { error = "Not found" }, statusCode: StatusCodes.Status404NotFound));

        app.MapFallbackToFile("index.html");
        return app;
    }

    private static async Task<IResult> Health(AppDbContext db, CancellationToken cancellationToken)
    {
        var reachable = false;
        try
        {
            reachable = await db.Database.CanConnectAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            reachable = false;
        }

        return Results.Ok(new HealthResponse("ok", reachable));
    }

    private static async Task<IResult> Me(ClaimsPrincipal user, UserDirectory users, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(ClaimsReader.ObjectId(user)))
        {
            return Results.Problem(
                title: "Access token is missing an oid claim.",
                statusCode: StatusCodes.Status403Forbidden);
        }

        var row = await users.UpsertAsync(user, cancellationToken);
        return Results.Ok(row);
    }
}

public sealed record HealthResponse(string Status, bool DatabaseReachable);

public sealed record PublicClientConfig(
    string TenantSubdomain,
    string TenantId,
    string SpaClientId,
    string ApiClientId,
    string ApiScope);
