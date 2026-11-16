using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class ProfileSettingsTests(ApiFactory factory)
{
    [Fact]
    public async Task Settings_change_the_time_zone_without_a_target_change()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("settings-zone");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-11-16", """{"kg":83.6,"timeZone":"UTC"}""");
        var saved = await TestData.PutProfile(client, TestData.Profile());
        Assert.True(saved.GetProperty("profile").GetProperty("timeZoneFollowsDevice").GetBoolean());

        var picked = await client.PutAsJsonAsync("/api/profile/settings", new { timeZone = "Europe/Oslo", timeZoneFollowsDevice = false });
        Assert.Equal(HttpStatusCode.OK, picked.StatusCode);
        var body = await picked.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Europe/Oslo", body.GetProperty("timeZone").GetString());
        Assert.False(body.GetProperty("timeZoneFollowsDevice").GetBoolean());

        var state = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal("Europe/Oslo", state.GetProperty("profile").GetProperty("timeZone").GetString());
        Assert.False(state.GetProperty("profile").GetProperty("timeZoneFollowsDevice").GetBoolean());
        Assert.Equal(1, await HistoryCount(user));

        var unknown = await client.PutAsJsonAsync("/api/profile/settings", new { timeZone = "Mars/Olympus" });
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        state = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal("Europe/Oslo", state.GetProperty("profile").GetProperty("timeZone").GetString());
    }

    [Fact]
    public async Task Settings_need_a_profile()
    {
        var user = TestData.NewUser("settings-none");
        using var client = factory.AsUser(user);
        var response = await client.PutAsJsonAsync("/api/profile/settings", new { timeZone = "UTC" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Mark_all_read_leaves_the_reminder_shown_on_home()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("read-all-home");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-11-16", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());

        var inbox = await client.GetFromJsonAsync<JsonElement>("/api/notifications/inbox");
        Assert.Equal(1, inbox.GetProperty("unread").GetInt32());
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/notifications/inbox/read", null)).StatusCode);
        inbox = await client.GetFromJsonAsync<JsonElement>("/api/notifications/inbox");
        Assert.Equal(1, inbox.GetProperty("unread").GetInt32());
    }

    [Fact]
    public async Task Units_are_saved_on_the_account_without_a_target_change()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("settings-units");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-11-16", """{"kg":83.6,"timeZone":"UTC"}""");
        var saved = await TestData.PutProfile(client, TestData.Profile());
        Assert.Equal("kg", saved.GetProperty("profile").GetProperty("weightUnit").GetString());
        Assert.Equal("cm", saved.GetProperty("profile").GetProperty("heightUnit").GetString());

        var picked = await client.PutAsJsonAsync("/api/profile/settings", new { weightUnit = "lb", heightUnit = "ftin" });
        Assert.Equal(HttpStatusCode.OK, picked.StatusCode);
        var body = await picked.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("lb", body.GetProperty("weightUnit").GetString());
        Assert.Equal("ftin", body.GetProperty("heightUnit").GetString());
        Assert.Equal("UTC", body.GetProperty("timeZone").GetString());

        var state = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal("lb", state.GetProperty("profile").GetProperty("weightUnit").GetString());
        Assert.Equal("ftin", state.GetProperty("profile").GetProperty("heightUnit").GetString());
        Assert.Equal(180m, state.GetProperty("profile").GetProperty("heightCm").GetDecimal());
        Assert.Equal(1, await HistoryCount(user));

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/profile/settings", new { weightUnit = "stone" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/profile/settings", new { heightUnit = "in" })).StatusCode);
        state = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal("lb", state.GetProperty("profile").GetProperty("weightUnit").GetString());
    }

    [Fact]
    public async Task A_weight_typed_in_pounds_keeps_two_kilogram_decimals()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("units-decimals");
        using var client = factory.AsUser(user);
        // 180.0 lb and a 165.0 lb goal.
        await TestData.PutWeighIn(client, "2026-11-16", """{"kg":81.65,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile(goalWeightKg: 74.84m));

        var state = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal(74.84m, state.GetProperty("profile").GetProperty("goalWeightKg").GetDecimal());
        var weighIns = await client.GetFromJsonAsync<JsonElement>("/api/weigh-ins");
        Assert.Equal(81.65m, weighIns.GetProperty("weighIns")[0].GetProperty("kg").GetDecimal());

        var tooFine = await client.PutAsync("/api/weigh-ins/2026-11-16", new StringContent("""{"kg":81.655,"timeZone":"UTC"}""", System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, tooFine.StatusCode);
        var goal = await client.PutAsJsonAsync("/api/profile", TestData.Profile(goalWeightKg: 74.845m));
        Assert.Equal(HttpStatusCode.BadRequest, goal.StatusCode);
    }

    private async Task<int> HistoryCount(string userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.TargetHistories.CountAsync(row => row.UserId == userId);
    }
}
