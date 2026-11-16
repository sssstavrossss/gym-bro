using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Hosting;
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
    public async Task The_monday_update_is_new_until_profile_is_seen_and_own_changes_never_are()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 15, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("targets-seen");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-11-15", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());

        var history = await client.GetFromJsonAsync<JsonElement>("/api/profile/history");
        Assert.False(history.GetProperty("rows")[0].GetProperty("isNew").GetBoolean());
        var unread = await client.GetFromJsonAsync<JsonElement>("/api/notifications/inbox/unread");
        Assert.False(unread.GetProperty("targetsChanged").GetBoolean());

        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 16, 6, 0, 0, TimeSpan.Zero);
        await RunWeekly();

        history = await client.GetFromJsonAsync<JsonElement>("/api/profile/history");
        var rows = history.GetProperty("rows");
        Assert.Equal("2026-11-16", rows[0].GetProperty("date").GetString());
        Assert.True(rows[0].GetProperty("isNew").GetBoolean());
        Assert.False(rows[1].GetProperty("isNew").GetBoolean());
        unread = await client.GetFromJsonAsync<JsonElement>("/api/notifications/inbox/unread");
        Assert.True(unread.GetProperty("targetsChanged").GetBoolean());

        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 16, 9, 0, 0, TimeSpan.Zero);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/profile/targets-seen", null)).StatusCode);
        history = await client.GetFromJsonAsync<JsonElement>("/api/profile/history");
        Assert.All(history.GetProperty("rows").EnumerateArray(), row => Assert.False(row.GetProperty("isNew").GetBoolean()));
        unread = await client.GetFromJsonAsync<JsonElement>("/api/notifications/inbox/unread");
        Assert.False(unread.GetProperty("targetsChanged").GetBoolean());

        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 16, 10, 0, 0, TimeSpan.Zero);
        await TestData.PutProfile(client, TestData.Profile(fatSetting: "more", fatPercent: 30));
        history = await client.GetFromJsonAsync<JsonElement>("/api/profile/history");
        Assert.All(history.GetProperty("rows").EnumerateArray(), row => Assert.False(row.GetProperty("isNew").GetBoolean()));
    }

    [Fact]
    public async Task Another_persons_monday_update_does_not_light_my_profile()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 15, 8, 0, 0, TimeSpan.Zero);
        var owner = TestData.NewUser("seen-owner");
        var other = TestData.NewUser("seen-other");
        using var client = factory.AsUser(owner);
        using var stranger = factory.AsUser(other);
        await TestData.PutWeighIn(client, "2026-11-15", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());
        await TestData.PutWeighIn(stranger, "2026-11-15", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(stranger, TestData.Profile());

        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 16, 6, 0, 0, TimeSpan.Zero);
        await RunWeekly();
        Assert.Equal(HttpStatusCode.NoContent, (await stranger.PostAsync("/api/profile/targets-seen", null)).StatusCode);

        var mine = await client.GetFromJsonAsync<JsonElement>("/api/notifications/inbox/unread");
        Assert.True(mine.GetProperty("targetsChanged").GetBoolean());
        var theirs = await stranger.GetFromJsonAsync<JsonElement>("/api/notifications/inbox/unread");
        Assert.False(theirs.GetProperty("targetsChanged").GetBoolean());
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

    private async Task RunWeekly()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var job = scope.ServiceProvider.GetRequiredService<WeeklyTargetRecalculator>();
        await job.RunAsync(CancellationToken.None);
    }
}
