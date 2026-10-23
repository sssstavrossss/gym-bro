using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class MeEndpointTests(ApiFactory factory)
{
    [Fact]
    public async Task Me_returns_401_without_a_token()
    {
        var response = await factory.CreateClient().GetAsync("/api/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Me_returns_403_when_the_scope_is_missing()
    {
        var response = await Send("oid-alex", "Alex", "alex@example.com", scope: "Something.Else");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Me_upserts_the_user_and_keeps_first_seen()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 4, 1, 8, 0, 0, TimeSpan.Zero);

        var created = await Send("oid-alex", "Alex", "alex@example.com");
        var createdBody = await Read(created);
        Assert.Equal("oid-alex", createdBody.GetProperty("objectId").GetString());
        Assert.Equal("Alex", createdBody.GetProperty("displayName").GetString());
        Assert.Equal("alex@example.com", createdBody.GetProperty("email").GetString());
        Assert.Equal(factory.Clock.UtcNow, createdBody.GetProperty("firstSeenAt").GetDateTimeOffset());
        Assert.Equal(factory.Clock.UtcNow, createdBody.GetProperty("lastSeenAt").GetDateTimeOffset());

        factory.Clock.UtcNow = factory.Clock.UtcNow.AddHours(3);
        var updated = await Send("oid-alex", "Alex Rivera", "alex.rivera@example.com");
        var updatedBody = await Read(updated);
        Assert.Equal("Alex Rivera", updatedBody.GetProperty("displayName").GetString());
        Assert.Equal("alex.rivera@example.com", updatedBody.GetProperty("email").GetString());
        Assert.Equal(
            createdBody.GetProperty("firstSeenAt").GetDateTimeOffset(),
            updatedBody.GetProperty("firstSeenAt").GetDateTimeOffset());
        Assert.Equal(factory.Clock.UtcNow, updatedBody.GetProperty("lastSeenAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task Me_keeps_the_stored_name_when_a_later_token_omits_it()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 5, 2, 9, 0, 0, TimeSpan.Zero);
        await Send("oid-sam", "Sam", "sam@example.com");

        factory.Clock.UtcNow = factory.Clock.UtcNow.AddMinutes(10);
        var response = await Send("oid-sam", name: null, email: null);
        var body = await Read(response);

        Assert.Equal("Sam", body.GetProperty("displayName").GetString());
        Assert.Equal("sam@example.com", body.GetProperty("email").GetString());
        Assert.Equal(factory.Clock.UtcNow, body.GetProperty("lastSeenAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task Unknown_api_routes_require_auth()
    {
        var client = factory.CreateClient();
        var anonymous = await client.GetAsync("/api/does-not-exist");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/does-not-exist");
        request.Headers.Add("X-Test-Oid", "oid-alex");
        var authed = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NotFound, authed.StatusCode);
    }

    [Fact]
    public async Task Config_is_anonymous_and_publishes_the_scope()
    {
        var response = await factory.CreateClient().GetAsync("/config.json");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("test-tenant", body.GetProperty("tenantSubdomain").GetString());
        Assert.Equal("11111111-1111-1111-1111-111111111111", body.GetProperty("tenantId").GetString());
        Assert.Equal("22222222-2222-2222-2222-222222222222", body.GetProperty("spaClientId").GetString());
        Assert.Equal("33333333-3333-3333-3333-333333333333", body.GetProperty("apiClientId").GetString());
        Assert.Equal(
            "api://33333333-3333-3333-3333-333333333333/access_as_user",
            body.GetProperty("apiScope").GetString());
    }

    private async Task<HttpResponseMessage> Send(string objectId, string? name, string? email, string? scope = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/me");
        request.Headers.Add("X-Test-Oid", objectId);
        if (name is not null)
        {
            request.Headers.Add("X-Test-Name", name);
        }

        if (email is not null)
        {
            request.Headers.Add("X-Test-Email", email);
        }

        if (scope is not null)
        {
            request.Headers.Add("X-Test-Scope", scope);
        }

        var response = await factory.CreateClient().SendAsync(request);
        return response;
    }

    private static async Task<JsonElement> Read(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }
}
