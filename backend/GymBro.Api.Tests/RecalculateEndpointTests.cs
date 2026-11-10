using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Nutrition;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class RecalculateEndpointTests(ApiFactory factory)
{
    [Fact]
    public async Task Formula_confirmation_writes_today_and_stays_on_the_caller()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 8, 0, 0, TimeSpan.Zero);
        var owner = TestData.NewUser("recalc-owner");
        var other = TestData.NewUser("recalc-other");
        using var client = factory.AsUser(owner);
        using var stranger = factory.AsUser(other);
        await TestData.PutWeighIn(client, "2026-11-10", """{"kg":83.6,"timeZone":"Europe/Oslo"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "Europe/Oslo"));

        var review = await client.GetFromJsonAsync<JsonElement>("/api/recalculate");
        Assert.True(review.GetProperty("includedDays").GetInt32() < 7);
        Assert.Equal(JsonValueKind.Null, review.GetProperty("proposed").ValueKind);
        Assert.Equal(AdaptiveTarget.NeedMoreDays, review.GetProperty("blocked").GetString());

        var denied = await stranger.GetAsync("/api/recalculate");
        Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);

        var adaptive = await client.PostAsJsonAsync("/api/recalculate", new { exclude = Array.Empty<string>(), mode = "adaptive" });
        Assert.Equal(HttpStatusCode.BadRequest, adaptive.StatusCode);

        var saved = await client.PostAsJsonAsync("/api/recalculate", new { exclude = Array.Empty<string>(), mode = "formula" });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var today = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-11-10");
        Assert.Equal(RecalculationReasons.Formula, today.GetProperty("targets").GetProperty("reason").GetString());
        Assert.Equal("2026-11-10", today.GetProperty("targets").GetProperty("effectiveDate").GetString());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.DoesNotContain(await db.TargetHistories.Where(row => row.UserId == other).ToListAsync(), row => row.Reasons.Contains(RecalculationReasons.Formula));
    }

    [Fact]
    public async Task Notifications_stay_off_without_keys_and_subscriptions_are_private()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 10, 8, 0, 0, TimeSpan.Zero);
        var owner = TestData.NewUser("push-owner");
        var other = TestData.NewUser("push-other");
        using var client = factory.AsUser(owner);
        using var stranger = factory.AsUser(other);
        await TestData.PutWeighIn(client, "2026-11-10", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());

        var settings = await client.GetFromJsonAsync<JsonElement>("/api/notifications");
        Assert.False(settings.GetProperty("configured").GetBoolean());
        var turned = await client.PutAsJsonAsync("/api/notifications", new { enabled = true });
        Assert.Equal(HttpStatusCode.BadRequest, turned.StatusCode);

        var endpoint = "https://push.example.test/owner";
        var body = new { endpoint, keys = new { p256dh = "abc", auth = "def" } };
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/notifications/subscription", body)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await stranger.DeleteAsync("/api/notifications/subscription")).StatusCode);
    }
}
