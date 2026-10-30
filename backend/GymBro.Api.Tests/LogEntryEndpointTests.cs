using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class LogEntryEndpointTests(ApiFactory factory)
{
    [Fact]
    public async Task Quick_add_stores_quick_source_null_grams_and_replays_the_same_key()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("quick");
        using var client = factory.AsUser(user);
        await TestData.PutProfile(client, TestData.Profile());

        var created = await client.PostAsync("/api/log-entries", Json(Quick("same-key", "2026-10-24", "\"12,5\"")));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("quick", body.GetProperty("source").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("grams").ValueKind);
        Assert.Equal("Fictional bar", body.GetProperty("name").GetString());
        Assert.Equal(12.5m, body.GetProperty("kcal").GetDecimal());
        Assert.Equal("UTC", body.GetProperty("timeZone").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("deletedAt").ValueKind);
        var id = body.GetProperty("id").GetGuid();

        var replay = await client.PostAsync("/api/log-entries", Json(Quick("same-key", "2026-10-24", "99")));
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var again = await replay.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(id, again.GetProperty("id").GetGuid());
        Assert.Equal(12.5m, again.GetProperty("kcal").GetDecimal());

        var list = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(1, list.GetProperty("entries").GetArrayLength());
        Assert.Equal(12.5m, list.GetProperty("totals").GetProperty("kcal").GetDecimal());
    }

    [Fact]
    public async Task Comma_and_point_are_accepted_and_limits_are_plain()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("limits"));
        await TestData.PutProfile(client, TestData.Profile());

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/log-entries", Json(Quick("k1", "2026-10-24", "10001")))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/log-entries", Json("""
            {"idempotencyKey":"k2","localDate":"2026-10-24","timeZone":"UTC","name":"Fictional bar","kcal":10,"protein":"1001","fat":1,"carbs":1}
            """))).StatusCode);

        var point = await client.PostAsync("/api/log-entries", Json("""
            {"idempotencyKey":"k3","localDate":"2026-10-24","timeZone":"UTC","name":"Fictional bar","kcal":10,"protein":"12.5","fat":1,"carbs":1}
            """));
        Assert.Equal(HttpStatusCode.Created, point.StatusCode);
        Assert.Equal(12.5m, (await point.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("protein").GetDecimal());
        var comma = await client.PostAsync("/api/log-entries", Json("""
            {"idempotencyKey":"k4","localDate":"2026-10-24","timeZone":"UTC","name":"Fictional bar","kcal":10,"protein":1,"fat":"12,5","carbs":1}
            """));
        Assert.Equal(HttpStatusCode.Created, comma.StatusCode);
        Assert.Equal(12.5m, (await comma.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("fat").GetDecimal());

        var zero = await PostAmount(client, "a0", 0, "g");
        Assert.Equal(HttpStatusCode.BadRequest, zero.StatusCode);
        Assert.Contains("10,000", await zero.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        Assert.Equal(HttpStatusCode.BadRequest, (await PostAmount(client, "a1", 10001, "g")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await PostAmount(client, "a2", 0.5m, "g")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await PostAmount(client, "a3", 10000, "ml")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAmount(client, "a4", 51, "serving")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await PostAmount(client, "a5", 50, "piece")).StatusCode);
    }

    [Fact]
    public async Task Date_window_uses_the_setup_date_and_rejects_tomorrow()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 20, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("window"));
        await TestData.PutProfile(client, TestData.Profile());
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/log-entries", Json(Quick("d1", "2026-10-25")))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/log-entries", Json(Quick("d2", "2026-10-19")))).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsync("/api/log-entries", Json(Quick("d3", "2026-10-20")))).StatusCode);
        var today = await client.PostAsync("/api/log-entries", Json(Quick("d4", "2026-10-24")));
        Assert.Equal(HttpStatusCode.Created, today.StatusCode);
        var id = (await today.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var future = await client.PatchAsync($"/api/log-entries/{id}", Json("""{"localDate":"2026-10-25"}"""));
        Assert.Equal(HttpStatusCode.BadRequest, future.StatusCode);
        var before = await client.PatchAsync($"/api/log-entries/{id}", Json("""{"localDate":"2026-10-19"}"""));
        Assert.Equal(HttpStatusCode.BadRequest, before.StatusCode);
        var listed = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(id, listed.GetProperty("entries")[0].GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task Time_zone_is_stored_and_one_day_ahead_is_allowed_only_for_that_zone()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 1, 8, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("zone"));
        await TestData.PutProfile(client, TestData.Profile());
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 30, 14, 0, 0, TimeSpan.Zero);

        var unknown = await client.PostAsync("/api/log-entries", Json(Quick("z0", "2026-10-30", "10", null, "Not/AZone")));
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);

        var ahead = await client.PostAsync("/api/log-entries", Json(Quick("z1", "2026-10-31", "10", null, "Pacific/Auckland")));
        Assert.Equal(HttpStatusCode.Created, ahead.StatusCode);
        var stored = await ahead.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Pacific/Auckland", stored.GetProperty("timeZone").GetString());

        var twoDays = await client.PostAsync("/api/log-entries", Json(Quick("z2", "2026-11-01", "10", null, "Pacific/Auckland")));
        Assert.Equal(HttpStatusCode.BadRequest, twoDays.StatusCode);

        var utcTomorrow = await client.PostAsync("/api/log-entries", Json(Quick("z3", "2026-10-31", "10", null, "UTC")));
        Assert.Equal(HttpStatusCode.BadRequest, utcTomorrow.StatusCode);
    }

    [Fact]
    public async Task Soft_delete_hides_the_entry_and_restore_brings_the_same_row_back()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 15, 0, TimeSpan.Zero);
        var user = TestData.NewUser("undo");
        using var client = factory.AsUser(user);
        await TestData.PutProfile(client, TestData.Profile());
        var created = await client.PostAsync("/api/log-entries", Json(Quick("undo-1", "2026-10-24", "200", "\"time\":\"08:15\"")));
        var body = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = body.GetProperty("id").GetGuid();

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/log-entries/{id}")).StatusCode);
        var hidden = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(0, hidden.GetProperty("entries").GetArrayLength());
        Assert.Equal(0, hidden.GetProperty("totals").GetProperty("kcal").GetDecimal());

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = await db.LogEntries.AsNoTracking().SingleAsync(entry => entry.Id == id);
            Assert.NotNull(row.DeletedAt);
            Assert.Equal("Fictional bar", row.Name);
            Assert.Equal(new DateOnly(2026, 10, 24), row.LocalDate);
        }

        var restored = await client.PostAsync($"/api/log-entries/{id}/restore", new StringContent("", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.OK, restored.StatusCode);
        var back = await restored.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(id, back.GetProperty("id").GetGuid());
        Assert.Equal("08:15", back.GetProperty("time").GetString());
        Assert.Equal(200, back.GetProperty("kcal").GetDecimal());
        Assert.Equal(JsonValueKind.Null, back.GetProperty("deletedAt").ValueKind);
        var shown = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(1, shown.GetProperty("entries").GetArrayLength());
        Assert.Equal(200, shown.GetProperty("totals").GetProperty("kcal").GetDecimal());
    }

    [Fact]
    public async Task Editing_quick_add_values_replaces_them_and_amount_scales_a_serving()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("edit"));
        await TestData.PutProfile(client, TestData.Profile());
        var created = await client.PostAsync("/api/log-entries", Json(Quick("edit-1", "2026-10-24", "100", "\"time\":\"09:00\"")));
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var values = await client.PatchAsync($"/api/log-entries/{id}", Json("""
            {"name":"Fictional bowl","kcal":"80,5","protein":"12,5","fat":1,"carbs":2,"time":"10:30"}
            """));
        Assert.Equal(HttpStatusCode.OK, values.StatusCode);
        var edited = await values.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Fictional bowl", edited.GetProperty("name").GetString());
        Assert.Equal(80.5m, edited.GetProperty("kcal").GetDecimal());
        Assert.Equal(12.5m, edited.GetProperty("protein").GetDecimal());
        Assert.Equal("10:30", edited.GetProperty("time").GetString());
        Assert.Equal(JsonValueKind.Null, edited.GetProperty("grams").ValueKind);

        var scaled = await client.PatchAsync($"/api/log-entries/{id}", Json("""{"amount":2,"unit":"serving"}"""));
        Assert.Equal(HttpStatusCode.OK, scaled.StatusCode);
        var doubled = await scaled.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(161.0m, doubled.GetProperty("kcal").GetDecimal());
        Assert.Equal(25.0m, doubled.GetProperty("protein").GetDecimal());
        Assert.Equal(JsonValueKind.Null, doubled.GetProperty("grams").ValueKind);
    }

    [Fact]
    public async Task Another_user_cannot_read_edit_delete_or_restore()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var owner = TestData.NewUser("owner");
        var other = TestData.NewUser("other");
        using var client = factory.AsUser(owner);
        using var stranger = factory.AsUser(other);
        await TestData.PutProfile(client, TestData.Profile());
        await TestData.PutProfile(stranger, TestData.Profile());

        var food = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional oats",
            kcalPer100 = 100,
            proteinPer100 = 3,
            fatPer100 = 2,
            carbsPer100 = 15,
            nutrientBasis = "per_serving",
        });
        Assert.Equal(HttpStatusCode.Created, food.StatusCode);
        var foodId = (await food.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        Guid groupId;
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            groupId = Guid.NewGuid();
            db.EntryGroups.Add(new EntryGroup
            {
                Id = groupId,
                UserId = owner,
                Name = "Fictional group",
                CreatedAt = factory.Clock.GetUtcNow(),
            });
            await db.SaveChangesAsync();
        }

        var created = await client.PostAsync("/api/log-entries", Json(Quick("own-1", "2026-10-24", "40")));
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var otherList = await stranger.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(0, otherList.GetProperty("entries").GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PatchAsync($"/api/log-entries/{id}", Json("""{"kcal":1}"""))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.DeleteAsync($"/api/log-entries/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/log-entries/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsync($"/api/log-entries/{id}/restore", Json("{}"))).StatusCode);

        var still = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(0, still.GetProperty("entries").GetArrayLength());
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"/api/log-entries/{id}/restore", Json("{}"))).StatusCode);

        var stolenFood = await stranger.PostAsync("/api/log-entries", Json(Quick("steal-food", "2026-10-24", "10", $"\"foodId\":\"{foodId}\"")));
        Assert.Equal(HttpStatusCode.NotFound, stolenFood.StatusCode);
        var stolenGroup = await stranger.PostAsync("/api/log-entries", Json(Quick("steal-group", "2026-10-24", "10", $"\"groupId\":\"{groupId}\"")));
        Assert.Equal(HttpStatusCode.NotFound, stolenGroup.StatusCode);

        var ownFood = await client.PostAsync("/api/log-entries", Json(Quick("own-food", "2026-10-24", "10", $"\"foodId\":\"{foodId}\",\"amount\":1,\"unit\":\"serving\"")));
        Assert.Equal(HttpStatusCode.Created, ownFood.StatusCode);
        var loggedFood = await ownFood.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("custom", loggedFood.GetProperty("source").GetString());
        Assert.Equal(JsonValueKind.Null, loggedFood.GetProperty("grams").ValueKind);

        var ownGroup = await client.PostAsync("/api/log-entries", Json(Quick("own-group", "2026-10-24", "10", $"\"groupId\":\"{groupId}\"")));
        Assert.Equal(HttpStatusCode.Created, ownGroup.StatusCode);
        Assert.Equal(groupId, (await ownGroup.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("groupId").GetGuid());
    }

    private static async Task<HttpResponseMessage> PostAmount(HttpClient client, string key, decimal amount, string unit)
    {
        var text = amount.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return await client.PostAsync("/api/log-entries", Json(Quick(key, "2026-10-24", "10", $"\"amount\":{text},\"unit\":\"{unit}\"")));
    }

    private static string Quick(string key, string date, string kcal = "10", string? extra = null, string zone = "UTC")
    {
        var tail = string.IsNullOrEmpty(extra) ? "" : "," + extra;
        return $$"""
            {"idempotencyKey":"{{key}}","localDate":"{{date}}","timeZone":"{{zone}}","name":"Fictional bar","kcal":{{kcal}},"protein":1,"fat":1,"carbs":1{{tail}}}
            """;
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");
}
