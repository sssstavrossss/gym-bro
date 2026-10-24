using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class IsolationTests(ApiFactory factory)
{
    [Theory]
    [InlineData("GET", "/api/profile")]
    [InlineData("PUT", "/api/profile")]
    [InlineData("POST", "/api/targets/preview")]
    [InlineData("GET", "/api/targets")]
    [InlineData("PUT", "/api/weigh-ins/2026-10-24")]
    [InlineData("DELETE", "/api/weigh-ins/2026-10-24")]
    [InlineData("GET", "/api/weigh-ins")]
    [InlineData("GET", "/api/weight/trend")]
    [InlineData("GET", "/api/foods/search?q=oat")]
    [InlineData("POST", "/api/foods/search/open-food-facts")]
    [InlineData("POST", "/api/foods")]
    [InlineData("GET", "/api/about")]
    public async Task Anonymous_calls_are_rejected(string method, string path)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (method is "POST" or "PUT")
        {
            request.Content = new StringContent("{}", Encoding.UTF8, "application/json");
        }

        var response = await factory.CreateClient().SendAsync(request);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task User_a_cannot_read_or_change_user_b()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var userA = TestData.NewUser("iso-a");
        var userB = TestData.NewUser("iso-b");
        using var clientA = factory.AsUser(userA);
        using var clientB = factory.AsUser(userB);

        await TestData.PutWeighIn(clientA, "2026-10-24", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(clientA, TestData.Profile());
        var created = await clientA.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional private mash",
            kcalPer100 = 90,
            proteinPer100 = 2,
            fatPer100 = 1,
            carbsPer100 = 18,
            basis = "g",
        });
        var foodId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var profileB = await clientB.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal(JsonValueKind.Null, profileB.GetProperty("profile").ValueKind);
        Assert.Equal(JsonValueKind.Null, profileB.GetProperty("targets").ValueKind);
        Assert.Equal(JsonValueKind.Null, profileB.GetProperty("weight").GetProperty("latestKg").ValueKind);

        var weightsB = await clientB.GetFromJsonAsync<JsonElement>("/api/weigh-ins");
        Assert.Equal(0, weightsB.GetProperty("weighIns").GetArrayLength());
        var trendB = await clientB.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.Equal(0, trendB.GetProperty("weighInsInWindow").GetInt32());
        Assert.Equal(HttpStatusCode.NotFound, (await clientB.DeleteAsync("/api/weigh-ins/2026-10-24")).StatusCode);

        var targetsB = await clientB.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-10-24");
        Assert.Equal(JsonValueKind.Null, targetsB.GetProperty("targets").ValueKind);

        var searchB = await clientB.GetFromJsonAsync<JsonElement>("/api/foods/search?q=private%20mash");
        Assert.Equal(0, searchB.GetProperty("foods").GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await clientB.GetAsync("/api/foods/" + foodId)).StatusCode);
        var tamper = await clientB.PutAsJsonAsync("/api/foods/" + foodId, new
        {
            name = "Stolen mash",
            kcalPer100 = 1,
            proteinPer100 = 0,
            fatPer100 = 0,
            carbsPer100 = 0,
            basis = "g",
        });
        Assert.Equal(HttpStatusCode.NotFound, tamper.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await clientB.DeleteAsync("/api/foods/" + foodId)).StatusCode);

        await TestData.PutWeighIn(clientB, "2026-10-23", """{"kg":60,"timeZone":"UTC"}""");
        await TestData.PutProfile(clientB, TestData.Profile(birthYear: 1980, sex: "female", heightCm: 160, goalWeightKg: 55));

        var profileA = await clientA.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal(1990, profileA.GetProperty("profile").GetProperty("birthYear").GetInt32());
        Assert.Equal(2218, profileA.GetProperty("targets").GetProperty("kcal").GetInt32());
        var weightsA = await clientA.GetFromJsonAsync<JsonElement>("/api/weigh-ins");
        Assert.Equal(83.6m, Assert.Single(weightsA.GetProperty("weighIns").EnumerateArray()).GetProperty("kg").GetDecimal());
        var foodA = await clientA.GetFromJsonAsync<JsonElement>("/api/foods/" + foodId);
        Assert.Equal("Fictional private mash", foodA.GetProperty("name").GetString());
        Assert.Equal(90, foodA.GetProperty("kcalPer100").GetDecimal());
    }
}
