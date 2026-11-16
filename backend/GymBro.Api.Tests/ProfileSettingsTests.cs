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

    private async Task<int> HistoryCount(string userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.TargetHistories.CountAsync(row => row.UserId == userId);
    }
}
