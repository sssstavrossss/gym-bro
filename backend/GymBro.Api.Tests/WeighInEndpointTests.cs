using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class WeighInEndpointTests(ApiFactory factory)
{
    [Fact]
    public async Task Create_replace_list_and_delete_one_weigh_in_per_day()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("weight");
        using var client = factory.AsUser(user);

        var created = await client.PutAsync("/api/weigh-ins/2026-10-24", Json("""{"kg":"83,4","timeZone":"UTC"}"""));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var createdBody = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(createdBody.GetProperty("replaced").GetBoolean());
        Assert.Equal(83.4m, createdBody.GetProperty("kg").GetDecimal());

        var replaced = await client.PutAsync("/api/weigh-ins/2026-10-24", Json("""{"kg":83.5,"timeZone":"UTC"}"""));
        Assert.Equal(HttpStatusCode.OK, replaced.StatusCode);
        var replacedBody = await replaced.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(replacedBody.GetProperty("replaced").GetBoolean());
        Assert.Equal("That day's weigh-in was replaced.", replacedBody.GetProperty("notice").GetString());

        var list = await client.GetFromJsonAsync<JsonElement>("/api/weigh-ins?from=2026-10-01&to=2026-10-24");
        var rows = list.GetProperty("weighIns");
        Assert.Equal(1, rows.GetArrayLength());
        Assert.Equal(83.5m, rows[0].GetProperty("kg").GetDecimal());

        var removed = await client.DeleteAsync("/api/weigh-ins/2026-10-24");
        Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);
        var missing = await client.DeleteAsync("/api/weigh-ins/2026-10-24");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Theory]
    [InlineData("29.9")]
    [InlineData("300.1")]
    [InlineData("83.44")]
    [InlineData("nope")]
    public async Task Rejects_weights_outside_30_to_300_or_with_extra_decimals(string kg)
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("range"));
        var response = await client.PutAsync("/api/weigh-ins/2026-10-24", Json("{\"kg\":\"" + kg + "\",\"timeZone\":\"UTC\"}"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rejects_a_future_date_and_withholds_the_trend_until_three_weigh_ins()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("trend");
        using var client = factory.AsUser(user);

        var future = await client.PutAsync("/api/weigh-ins/2026-10-25", Json("""{"kg":80,"timeZone":"UTC"}"""));
        Assert.Equal(HttpStatusCode.BadRequest, future.StatusCode);

        await TestData.PutWeighIn(client, "2026-10-22", """{"kg":70,"timeZone":"UTC"}""");
        await TestData.PutWeighIn(client, "2026-10-23", """{"kg":80,"timeZone":"UTC"}""");
        var early = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend?date=2026-10-24");
        Assert.Equal(2, early.GetProperty("weighInsInWindow").GetInt32());
        Assert.Equal(JsonValueKind.Null, early.GetProperty("trendKg").ValueKind);

        await TestData.PutWeighIn(client, "2026-10-24", """{"kg":90,"timeZone":"UTC"}""");
        var ready = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend?date=2026-10-24");
        Assert.Equal(72.9m, ready.GetProperty("trendKg").GetDecimal());
        Assert.Equal(0.10m, ready.GetProperty("smoothingShare").GetDecimal());

        var profile = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal(72.9m, profile.GetProperty("weight").GetProperty("trendKg").GetDecimal());
        Assert.Equal("trend", profile.GetProperty("weight").GetProperty("source").GetString());
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");
}
