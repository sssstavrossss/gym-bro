namespace GymBro.Api.Hosting;

/// <summary>
/// Headers on every response, including static files and errors.
/// The script policy has no inline or eval. Style attributes stay allowed
/// because the weight sheet drag and the segmented control set them.
/// MSAL's silent iframe and token calls go to <c>*.ciamlogin.com</c>.
/// </summary>
public static class SecurityHeaders
{
    public const string ContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.ciamlogin.com; frame-src https://*.ciamlogin.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://*.ciamlogin.com; object-src 'none'";

    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            context.Response.OnStarting(() =>
            {
                var headers = context.Response.Headers;
                headers["Content-Security-Policy"] = ContentSecurityPolicy;
                headers["X-Content-Type-Options"] = "nosniff";
                headers["X-Frame-Options"] = "DENY";
                headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
                return Task.CompletedTask;
            });
            await next();
        });
}
