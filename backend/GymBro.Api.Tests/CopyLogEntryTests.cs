using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class CopyLogEntryTests(ApiFactory factory)
{
    [Fact]
    public async Task Copy_keeps_the_snapshot_when_the_food_changes()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 23, 8, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("copy-snap"));
        await Setup(client, "2026-10-23");
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 15, 0, TimeSpan.Zero);
        var foodId = await CreateFood(client, 200, 10, 4, 30);
        var created = await client.PostAsync("/api/log-entries", Json(FoodEntry("src-1", "2026-10-24", foodId, "\"time\":\"08:15\"")));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var source = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(300, source.GetProperty("kcal").GetDecimal());
        Assert.Equal(150, source.GetProperty("grams").GetDecimal());

        var copied = await Copy(client, "2026-10-23", (source.GetProperty("id").GetGuid(), "copy-1"));
        Assert.Equal(HttpStatusCode.Created, copied.StatusCode);
        var copy = (await copied.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("entries")[0];
        Assert.Equal(300, copy.GetProperty("kcal").GetDecimal());
        Assert.Equal(15, copy.GetProperty("protein").GetDecimal());
        Assert.Equal(6, copy.GetProperty("fat").GetDecimal());
        Assert.Equal(45, copy.GetProperty("carbs").GetDecimal());
        Assert.Equal(150, copy.GetProperty("grams").GetDecimal());
        Assert.Equal("08:15", copy.GetProperty("time").GetString());
        Assert.Equal("2026-10-23", copy.GetProperty("localDate").GetString());

        var edited = await client.PutAsJsonAsync("/api/foods/" + foodId, new
        {
            name = "Fictional copy oats",
            kcalPer100 = 50,
            proteinPer100 = 1,
            fatPer100 = 1,
            carbsPer100 = 1,
            basis = "g",
            nutrientBasis = "per_100",
        });
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);

        var listed = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-23");
        var kept = Assert.Single(listed.GetProperty("entries").EnumerateArray());
        Assert.Equal(copy.GetProperty("id").GetGuid(), kept.GetProperty("id").GetGuid());
        Assert.Equal(300, kept.GetProperty("kcal").GetDecimal());
        Assert.Equal(15, kept.GetProperty("protein").GetDecimal());
        Assert.Equal(150, kept.GetProperty("grams").GetDecimal());
        Assert.Equal("Fictional copy oats", kept.GetProperty("name").GetString());
        Assert.Equal("custom", kept.GetProperty("source").GetString());
        Assert.Equal(foodId, kept.GetProperty("foodId").GetGuid());
    }

    [Fact]
    public async Task Copy_has_a_new_id_and_key_and_no_group()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 22, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("copy-id");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-10-22");
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        var groupId = Guid.NewGuid();
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.EntryGroups.Add(new EntryGroup
            {
                Id = groupId,
                UserId = user,
                Name = "Fictional group",
                CreatedAt = factory.Clock.GetUtcNow(),
            });
            await db.SaveChangesAsync();
        }

        var created = await client.PostAsync("/api/log-entries", Json(Quick("grouped", "2026-10-24", "40", $"\"groupId\":\"{groupId}\",\"time\":\"09:40\"")));
        var source = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(groupId, source.GetProperty("groupId").GetGuid());
        var sourceId = source.GetProperty("id").GetGuid();

        var copied = await Copy(client, "2026-10-22", (sourceId, "copy-key"));
        Assert.Equal(HttpStatusCode.Created, copied.StatusCode);
        var copy = (await copied.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("entries")[0];
        Assert.NotEqual(sourceId, copy.GetProperty("id").GetGuid());
        Assert.Equal("copy-key", copy.GetProperty("idempotencyKey").GetString());
        Assert.NotEqual(source.GetProperty("idempotencyKey").GetString(), copy.GetProperty("idempotencyKey").GetString());
        Assert.Equal(JsonValueKind.Null, copy.GetProperty("groupId").ValueKind);
        Assert.Equal("09:40", copy.GetProperty("time").GetString());
        Assert.Equal(40, copy.GetProperty("kcal").GetDecimal());
        Assert.Equal("Fictional bar", copy.GetProperty("name").GetString());
        Assert.Equal("quick", copy.GetProperty("source").GetString());
        Assert.Equal(JsonValueKind.Null, copy.GetProperty("grams").ValueKind);

        var replay = await Copy(client, "2026-10-22", (sourceId, "copy-key"));
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var again = (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("entries")[0];
        Assert.Equal(copy.GetProperty("id").GetGuid(), again.GetProperty("id").GetGuid());
        var listed = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-22");
        Assert.Equal(1, listed.GetProperty("entries").GetArrayLength());
    }

    [Fact]
    public async Task Copying_to_the_same_day_creates_a_duplicate()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 11, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("copy-dup"));
        await Setup(client, "2026-10-24");
        var created = await client.PostAsync("/api/log-entries", Json(Quick("same-src", "2026-10-24", "80", "\"time\":\"11:05\",\"amount\":2,\"unit\":\"serving\"")));
        var source = await created.Content.ReadFromJsonAsync<JsonElement>();

        var copied = await Copy(client, "2026-10-24", (source.GetProperty("id").GetGuid(), "same-copy"));
        Assert.Equal(HttpStatusCode.Created, copied.StatusCode);
        var copy = (await copied.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("entries")[0];
        Assert.NotEqual(source.GetProperty("id").GetGuid(), copy.GetProperty("id").GetGuid());
        Assert.Equal("2026-10-24", copy.GetProperty("localDate").GetString());
        Assert.Equal("11:05", copy.GetProperty("time").GetString());
        Assert.Equal(80, copy.GetProperty("kcal").GetDecimal());
        Assert.Equal(2, copy.GetProperty("amount").GetDecimal());
        Assert.Equal("serving", copy.GetProperty("unit").GetString());
        Assert.Equal(JsonValueKind.Null, copy.GetProperty("groupId").ValueKind);

        var listed = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(2, listed.GetProperty("entries").GetArrayLength());
        Assert.Equal(160, listed.GetProperty("totals").GetProperty("kcal").GetDecimal());
        Assert.All(listed.GetProperty("entries").EnumerateArray(), row =>
        {
            Assert.Equal("Fictional bar", row.GetProperty("name").GetString());
            Assert.Equal("11:05", row.GetProperty("time").GetString());
            Assert.Equal(80, row.GetProperty("kcal").GetDecimal());
        });
    }

    [Fact]
    public async Task Copy_rejects_a_future_date_and_a_date_before_setup()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 20, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("copy-window");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-10-20");
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        var created = await client.PostAsync("/api/log-entries", Json(Quick("win-src", "2026-10-24", "25", "\"time\":\"09:00\"")));
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var future = await Copy(client, "2026-10-25", (id, "win-future"));
        Assert.Equal(HttpStatusCode.BadRequest, future.StatusCode);
        Assert.Equal("That date is in the future.", (await future.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());

        var early = await Copy(client, "2026-10-19", (id, "win-early"));
        Assert.Equal(HttpStatusCode.BadRequest, early.StatusCode);
        Assert.Equal("That date is before you set up Gym Bro.", (await early.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());

        var setup = await Copy(client, "2026-10-20", (id, "win-setup"));
        Assert.Equal(HttpStatusCode.Created, setup.StatusCode);
        var today = await Copy(client, "2026-10-24", (id, "win-today"));
        Assert.Equal(HttpStatusCode.Created, today.StatusCode);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rows = await db.LogEntries.AsNoTracking().Where(row => row.UserId == user).ToListAsync();
        Assert.Equal(3, rows.Count);
        Assert.DoesNotContain(rows, row => row.LocalDate == new DateOnly(2026, 10, 25) || row.LocalDate == new DateOnly(2026, 10, 19));
    }

    [Fact]
    public async Task Copying_into_a_complete_day_leaves_it_complete()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 22, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("copy-complete");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-10-22");
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        var created = await client.PostAsync("/api/log-entries", Json(Quick("done-src", "2026-10-24", "30", "\"time\":\"12:00\"")));
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        Assert.Equal(HttpStatusCode.OK, (await client.PutAsync("/api/day-status/2026-10-23", Json(Complete(true, true)))).StatusCode);
        var eaten = await client.PutAsync("/api/day-status/2026-10-24", Json(Complete(true, true)));
        Assert.Equal(HttpStatusCode.OK, eaten.StatusCode);
        var eatenBody = await eaten.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(eatenBody.GetProperty("complete").GetBoolean());
        Assert.False(eatenBody.GetProperty("fasting").GetBoolean());

        var intoFast = await Copy(client, "2026-10-23", (id, "into-fast"));
        Assert.Equal(HttpStatusCode.Created, intoFast.StatusCode);
        var intoEaten = await Copy(client, "2026-10-24", (id, "into-eaten"));
        Assert.Equal(HttpStatusCode.Created, intoEaten.StatusCode);

        var fasting = await client.GetFromJsonAsync<JsonElement>("/api/day-status?date=2026-10-23&timeZone=UTC");
        Assert.True(fasting.GetProperty("complete").GetBoolean());
        Assert.True(fasting.GetProperty("fasting").GetBoolean());
        var still = await client.GetFromJsonAsync<JsonElement>("/api/day-status?date=2026-10-24&timeZone=UTC");
        Assert.True(still.GetProperty("complete").GetBoolean());
        Assert.False(still.GetProperty("fasting").GetBoolean());

        var day = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(2, day.GetProperty("entries").GetArrayLength());
        Assert.Equal(60, day.GetProperty("totals").GetProperty("kcal").GetDecimal());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rows = await db.DayStatuses.AsNoTracking().Where(row => row.UserId == user).OrderBy(row => row.LocalDate).ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.True(rows[0].Complete);
        Assert.True(rows[0].Fasting);
        Assert.True(rows[1].Complete);
        Assert.False(rows[1].Fasting);
    }

    [Fact]
    public async Task A_deleted_entry_cannot_be_copied()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("copy-deleted");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-10-24");
        var live = await client.PostAsync("/api/log-entries", Json(Quick("live", "2026-10-24", "10", "\"time\":\"08:00\"")));
        var dropped = await client.PostAsync("/api/log-entries", Json(Quick("dropped", "2026-10-24", "99", "\"time\":\"09:00\"")));
        var liveId = (await live.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var droppedId = (await dropped.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/log-entries/{droppedId}")).StatusCode);

        var alone = await Copy(client, "2026-10-24", (droppedId, "copy-dead"));
        Assert.Equal(HttpStatusCode.NotFound, alone.StatusCode);

        var mixed = await Copy(client, "2026-10-24", (liveId, "copy-live"), (droppedId, "copy-mixed"));
        Assert.Equal(HttpStatusCode.NotFound, mixed.StatusCode);

        var listed = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(liveId, Assert.Single(listed.GetProperty("entries").EnumerateArray()).GetProperty("id").GetGuid());
        Assert.Equal(10, listed.GetProperty("totals").GetProperty("kcal").GetDecimal());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rows = await db.LogEntries.AsNoTracking().Where(row => row.UserId == user).ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.Contains(rows, row => row.Id == droppedId && row.DeletedAt != null);
        Assert.DoesNotContain(rows, row => row.IdempotencyKey == "copy-dead" || row.IdempotencyKey == "copy-live");
    }

    [Fact]
    public async Task Another_user_cannot_delete_restore_or_copy()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        var owner = TestData.NewUser("copy-owner");
        var stranger = TestData.NewUser("copy-stranger");
        using var client = factory.AsUser(owner);
        using var other = factory.AsUser(stranger);
        await Setup(client, "2026-10-24");
        await Setup(other, "2026-10-24");
        var created = await client.PostAsync("/api/log-entries", Json(Quick("owned", "2026-10-24", "55", "\"time\":\"10:00\"")));
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        Assert.Equal(HttpStatusCode.NotFound, (await other.DeleteAsync($"/api/log-entries/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsync($"/api/log-entries/{id}/restore", Json("{}"))).StatusCode);
        var stolen = await Copy(other, "2026-10-24", (id, "stolen-copy"));
        Assert.Equal(HttpStatusCode.NotFound, stolen.StatusCode);

        var ownerList = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(id, Assert.Single(ownerList.GetProperty("entries").EnumerateArray()).GetProperty("id").GetGuid());
        Assert.Equal(55, ownerList.GetProperty("totals").GetProperty("kcal").GetDecimal());
        var strangerList = await other.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(0, strangerList.GetProperty("entries").GetArrayLength());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await db.LogEntries.CountAsync(row => row.UserId == owner));
        Assert.Equal(0, await db.LogEntries.CountAsync(row => row.UserId == stranger));
        var row = await db.LogEntries.AsNoTracking().SingleAsync(entry => entry.Id == id);
        Assert.Null(row.DeletedAt);
        Assert.Equal(55, row.Kcal);
        Assert.Equal(new DateOnly(2026, 10, 24), row.LocalDate);
    }

    private static async Task Setup(HttpClient client, string date)
    {
        await TestData.PutWeighIn(client, date, """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());
    }

    private static async Task<Guid> CreateFood(HttpClient client, decimal kcal, decimal protein, decimal fat, decimal carbs)
    {
        var response = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional copy oats",
            kcalPer100 = kcal,
            proteinPer100 = protein,
            fatPer100 = fat,
            carbsPer100 = carbs,
            basis = "g",
            nutrientBasis = "per_100",
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    private static async Task<HttpResponseMessage> Copy(HttpClient client, string date, params (Guid Id, string Key)[] items)
    {
        var body = string.Join(',', items.Select(item => $$"""{"id":"{{item.Id}}","idempotencyKey":"{{item.Key}}"}"""));
        return await client.PostAsync("/api/log-entries/copy", Json($$"""{"localDate":"{{date}}","timeZone":"UTC","items":[{{body}}]}"""));
    }

    private static string Complete(bool complete, bool fasting = false) =>
        $$"""{"complete":{{(complete ? "true" : "false")}},"fasting":{{(fasting ? "true" : "false")}},"timeZone":"UTC"}""";

    private static string Quick(string key, string date, string kcal = "10", string? extra = null)
    {
        var tail = string.IsNullOrEmpty(extra) ? "" : "," + extra;
        return $$"""
            {"idempotencyKey":"{{key}}","localDate":"{{date}}","timeZone":"UTC","name":"Fictional bar","kcal":{{kcal}},"protein":1,"fat":1,"carbs":1{{tail}}}
            """;
    }

    private static string FoodEntry(string key, string date, Guid foodId, string? extra = null)
    {
        var tail = string.IsNullOrEmpty(extra) ? "" : "," + extra;
        return $$"""
            {"idempotencyKey":"{{key}}","localDate":"{{date}}","timeZone":"UTC","foodId":"{{foodId}}","amount":150,"unit":"g","kcal":1,"protein":1,"fat":1,"carbs":1{{tail}}}
            """;
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");
}
