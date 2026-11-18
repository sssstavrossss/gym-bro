using System.Security.Claims;
using GymBro.Api.Data;
using GymBro.Api.Export;
using GymBro.Api.Nutrition;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Endpoints;

public static class ExportEndpoints
{
    public static RouteGroupBuilder MapExport(this RouteGroupBuilder api)
    {
        api.MapGet("/export", Get);
        return api;
    }

    /// <summary>The caller's own data as a zip of CSV files and one JSON file. Nothing of anyone else's.</summary>
    private static async Task<IResult> Get(ClaimsPrincipal principal, HttpContext http, AppDbContext db, TimeProvider clock, CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var tables = await ExportTables.ReadAsync(db, userId, cancellationToken);
        var zone = await db.Profiles.AsNoTracking().Where(row => row.UserId == userId).Select(row => row.TimeZone).FirstOrDefaultAsync(cancellationToken);
        if (!LocalDates.TryToday(zone, clock, out var today))
        {
            today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        }

        http.Response.Headers.CacheControl = "no-store";
        return Results.File(ExportFiles.Zip(tables, clock.GetUtcNow()), "application/zip", ExportFiles.ZipName(today));
    }
}
