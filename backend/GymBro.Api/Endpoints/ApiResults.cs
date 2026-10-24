namespace GymBro.Api.Endpoints;

public static class ApiResults
{
    public static IResult Error(string message, int statusCode = StatusCodes.Status400BadRequest) =>
        Results.Json(new { error = message }, statusCode: statusCode);
}
