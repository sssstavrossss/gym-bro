using GymBro.Api.Training;

namespace GymBro.Api.Hosting;

/// <summary>
/// How the SPA's files are cached. Vite fingerprints JS and CSS, so those may be kept. The page itself
/// (<c>index.html</c>, at <c>/</c> and at every app route through the fallback) and the service worker must be
/// revalidated: a page kept from the last deploy asks for scripts the new container no longer has, and opens blank.
/// </summary>
public static class AppFiles
{
    public static StaticFileOptions Options { get; } = new()
    {
        OnPrepareResponse = context =>
        {
            if (context.File.Name.Equals("index.html", StringComparison.OrdinalIgnoreCase)
                || context.File.Name.Equals("sw.js", StringComparison.OrdinalIgnoreCase))
            {
                context.Context.Response.Headers.CacheControl = "no-cache";
            }
            else if (context.Context.Request.Path.StartsWithSegments(ExerciseCatalog.PhotosPath))
            {
                // The path names the free-exercise-db commit, so a photo at it never changes.
                context.Context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
            }
        },
    };
}
