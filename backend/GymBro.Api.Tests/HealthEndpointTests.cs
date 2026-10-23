using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class HealthEndpointTests(ApiFactory factory)
{
    [Fact]
    public async Task Health_is_anonymous_and_reports_the_database()
    {
        var response = await factory.CreateClient().GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ok", body.GetProperty("status").GetString());
        Assert.True(body.GetProperty("databaseReachable").GetBoolean());
    }
}
