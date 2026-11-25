using System.Security.Claims;
using GymBro.Api.Training;
using Microsoft.Net.Http.Headers;

namespace GymBro.Api.Endpoints;

/// <summary>The exercise library. It is the same for everyone, so it needs a signed-in caller but no per-user query.</summary>
public static class ExerciseEndpoints
{
    public const string UnknownExercise = "That exercise is not known.";

    public static RouteGroupBuilder MapExercises(this RouteGroupBuilder api)
    {
        api.MapGet("/exercises", List);
        api.MapGet("/exercises/{id}", Detail);
        return api;
    }

    /// <summary>
    /// Every exercise without its instructions, for browsing and search on the phone. The list only changes with a
    /// deploy, so it carries the library's version as an ETag and answers a matching If-None-Match with 304.
    /// </summary>
    private static IResult List(ClaimsPrincipal principal, HttpContext http)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var library = ExerciseCatalog.Current;
        var etag = $"\"{library.Version}\"";
        http.Response.Headers.ETag = etag;
        http.Response.Headers.CacheControl = "private, no-cache";
        if (http.Request.Headers[HeaderNames.IfNoneMatch].Any(value => value == etag))
        {
            return Results.StatusCode(StatusCodes.Status304NotModified);
        }

        return Results.Ok(new
        {
            version = library.Version,
            photos = ExerciseCatalog.PhotoBase,
            exercises = library.All.Select(item => new
            {
                item.Id,
                item.Name,
                item.Category,
                item.Equipment,
                item.Level,
                item.Mechanic,
                item.Force,
                item.Measure,
                item.PrimaryMuscles,
                item.SecondaryMuscles,
                item.Images,
            }),
        });
    }

    /// <summary>One exercise in full: the steps, and where it came from.</summary>
    private static IResult Detail(ClaimsPrincipal principal, string id)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (ExerciseCatalog.Current.Find(id) is not { } item)
        {
            return ApiResults.Error(UnknownExercise, StatusCodes.Status404NotFound);
        }

        return Results.Ok(new
        {
            item.Id,
            item.Name,
            item.Category,
            item.Equipment,
            item.Level,
            item.Mechanic,
            item.Force,
            item.Measure,
            item.PrimaryMuscles,
            item.SecondaryMuscles,
            item.Instructions,
            item.Images,
            photos = item.Images > 0 ? ExerciseCatalog.PhotoBase : null,
            item.Source,
            licence = item.Source == ExerciseCatalog.FreeExerciseDb ? "Unlicense (public domain)" : "Gym Bro",
        });
    }
}
