using System.IO.Compression;
using Microsoft.AspNetCore.ResponseCompression;

namespace GymBro.Api.Hosting;

/// <summary>
/// Brotli, else gzip, for JSON, the app's JS and CSS, and SVG. A year of Home Progress is about 100 KB of JSON and
/// about 5 KB compressed. Images, the export zip, and anything else already compressed go as they are.
/// Kestrel sits behind a proxy that says HTTPS, so compression is on for HTTPS too. That is safe here: no response
/// carries a secret next to text an attacker could put in it (sign-in is a bearer header, not a cookie or a page token).
/// </summary>
public static class Compression
{
    public static IServiceCollection AddGymBroCompression(this IServiceCollection services)
    {
        services.AddResponseCompression(options =>
        {
            options.EnableForHttps = true;
            options.Providers.Add<BrotliCompressionProvider>();
            options.Providers.Add<GzipCompressionProvider>();
            options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(["image/svg+xml", "application/manifest+json"]);
        });
        // Fastest: most of the saving for a fraction of the CPU, which matters more for answers made per request.
        services.Configure<BrotliCompressionProviderOptions>(options => options.Level = CompressionLevel.Fastest);
        services.Configure<GzipCompressionProviderOptions>(options => options.Level = CompressionLevel.Fastest);
        return services;
    }
}
