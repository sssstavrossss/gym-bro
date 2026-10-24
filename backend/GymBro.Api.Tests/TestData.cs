using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace GymBro.Api.Tests;

public static class TestData
{
    public static HttpClient AsUser(this ApiFactory factory, string objectId)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Oid", objectId);
        client.DefaultRequestHeaders.Add("X-Test-Name", "Test User");
        return client;
    }

    public static object Profile(
        int birthYear = 1990,
        string sex = "male",
        decimal heightCm = 180,
        string activity = "moderate",
        string goal = "lose",
        decimal? rateKgPerWeek = 0.5m,
        decimal goalWeightKg = 80,
        string proteinSetting = "normal",
        decimal proteinGramsPerKg = 2.0m,
        string fatSetting = "normal",
        decimal fatPercent = 25,
        string timeZone = "UTC") => new
    {
        sex,
        birthYear,
        heightCm,
        activity,
        goal,
        rateKgPerWeek,
        goalWeightKg,
        proteinSetting,
        proteinGramsPerKg,
        fatSetting,
        fatPercent,
        timeZone,
    };

    public static async Task<JsonElement> PutWeighIn(HttpClient client, string date, string json)
    {
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        var response = await client.PutAsync("/api/weigh-ins/" + date, content);
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, body);
        return JsonDocument.Parse(body).RootElement.Clone();
    }

    public static async Task<JsonElement> PutProfile(HttpClient client, object profile)
    {
        var response = await client.PutAsJsonAsync("/api/profile", profile);
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, body);
        return JsonDocument.Parse(body).RootElement.Clone();
    }

    public static string NewUser(string label) => "oid-" + label + "-" + Guid.NewGuid().ToString("N");
}
