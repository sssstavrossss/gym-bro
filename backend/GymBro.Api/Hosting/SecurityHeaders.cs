namespace GymBro.Api.Hosting;

/// <summary>
/// Headers on every response, including static files and errors.
/// The script policy has no inline or eval. <c>'wasm-unsafe-eval'</c> lets the barcode scanner compile its
/// WebAssembly decoder, which is served from this origin; it does not allow JavaScript eval. Style attributes stay allowed
/// because the weight sheet drag and the segmented control set them.
/// MSAL silent renewal puts <c>https://*.ciamlogin.com</c> in a hidden iframe
/// and then loads the redirect page in a same-origin iframe, so both frame
/// sources stay allowed and this origin may frame its own pages.
/// </summary>
public static class SecurityHeaders
{
    public const string ContentSecurityPolicy =
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.ciamlogin.com; frame-src 'self' https://*.ciamlogin.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self' https://*.ciamlogin.com; object-src 'none'";

    /// <summary>The camera is for the barcode scanner on this origin only. Nothing uses the microphone or location.</summary>
    public const string PermissionsPolicy = "camera=(self), microphone=(), geolocation=()";

    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            context.Response.OnStarting(() =>
            {
                var headers = context.Response.Headers;
                headers["Content-Security-Policy"] = ContentSecurityPolicy;
                headers["X-Content-Type-Options"] = "nosniff";
                headers["X-Frame-Options"] = "SAMEORIGIN";
                headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
                headers["Permissions-Policy"] = PermissionsPolicy;
                return Task.CompletedTask;
            });
            await next();
        });
}
