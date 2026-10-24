using System.Security.Claims;
using GymBro.Api.Auth;

namespace GymBro.Api.Endpoints;

public static class Caller
{
    public static IResult? MissingOid(ClaimsPrincipal principal)
    {
        if (string.IsNullOrWhiteSpace(ClaimsReader.ObjectId(principal)))
        {
            return Results.Problem(
                title: "Access token is missing an oid claim.",
                statusCode: StatusCodes.Status403Forbidden);
        }

        return null;
    }

    public static string Id(ClaimsPrincipal principal) => ClaimsReader.ObjectId(principal)!;
}
