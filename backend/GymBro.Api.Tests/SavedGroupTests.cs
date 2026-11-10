using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class SavedGroupTests(ApiFactory factory)
{
    [Fact]
    public async Task Readding_a_group_on_today_writes_separate_entries_at_the_current_time()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 15, 30, TimeSpan.Zero);
        var user = TestData.NewUser("group-43a");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-10-24");
        var oats = await Food(client, "Fictional oats", 100, 10, 2, 12);
        var broth = await Food(client, "Fictional broth", 200, 8, 1, 4);
        var bread = await Food(client, "Fictional bread", 50, 4, 1, 8);
        var first = await LogFood(client, "oats", "2026-10-24", oats, 100, "g", "08:00");
        var second = await LogFood(client, "broth", "2026-10-24", broth, 50, "g", "09:00");
        var third = await LogFood(client, "bread", "2026-10-24", bread, 200, "g", "10:00");

        var saved = await Save(client, "Usual breakfast", first, second, third);
        Assert.Equal(HttpStatusCode.Created, saved.StatusCode);
        var group = await saved.Content.ReadFromJsonAsync<JsonElement>();
        var groupId = group.GetProperty("id").GetGuid();
        Assert.Equal("Usual breakfast", group.GetProperty("name").GetString());
        Assert.Equal(3, group.GetProperty("items").GetArrayLength());

        var expanded = await client.GetFromJsonAsync<JsonElement>("/api/groups/" + groupId);
        Assert.Equal(3, expanded.GetProperty("items").GetArrayLength());
        Assert.Contains(expanded.GetProperty("items").EnumerateArray(), item => item.GetProperty("name").GetString() == "Fictional oats" && item.GetProperty("grams").GetDecimal() == 100);

        var added = await Readd(client, groupId, "2026-10-24", "again");
        Assert.Equal(HttpStatusCode.Created, added.StatusCode);
        var body = await added.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("08:15", body.GetProperty("time").GetString());
        Assert.Equal("", body.GetProperty("notice").GetString());
        var entries = body.GetProperty("entries").EnumerateArray().ToList();
        Assert.Equal(3, entries.Count);
        Assert.All(entries, row =>
        {
            Assert.Equal("08:15", row.GetProperty("time").GetString());
            Assert.Equal(groupId, row.GetProperty("groupId").GetGuid());
            Assert.StartsWith("again:", row.GetProperty("idempotencyKey").GetString());
        });
        var newIds = entries.Select(row => row.GetProperty("id").GetGuid()).ToHashSet();
        Assert.Equal(3, newIds.Count);
        Assert.DoesNotContain(first, newIds);
        Assert.DoesNotContain(second, newIds);
        Assert.DoesNotContain(third, newIds);
        Assert.Equal(3, entries.Select(row => row.GetProperty("idempotencyKey").GetString()).Distinct().Count());
        Assert.Equal(100, entries.Single(row => row.GetProperty("name").GetString() == "Fictional oats").GetProperty("kcal").GetDecimal());
        Assert.Equal(100, entries.Single(row => row.GetProperty("name").GetString() == "Fictional broth").GetProperty("kcal").GetDecimal());
        Assert.Equal(100, entries.Single(row => row.GetProperty("name").GetString() == "Fictional bread").GetProperty("kcal").GetDecimal());

        var replay = await Readd(client, groupId, "2026-10-24", "again");
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var again = (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("entries").EnumerateArray().Select(row => row.GetProperty("id").GetGuid()).ToHashSet();
        Assert.Equal(newIds, again);

        var copied = await client.PostAsync("/api/log-entries/copy", Json($$"""{"localDate":"2026-10-24","timeZone":"UTC","items":[{"id":"{{entries[0].GetProperty("id").GetGuid()}}","idempotencyKey":"copy-group"}]}"""));
        Assert.Equal(HttpStatusCode.Created, copied.StatusCode);
        var copy = (await copied.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("entries")[0];
        Assert.Equal(JsonValueKind.Null, copy.GetProperty("groupId").ValueKind);
        Assert.NotEqual(entries[0].GetProperty("id").GetGuid(), copy.GetProperty("id").GetGuid());

        var listed = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(7, listed.GetProperty("entries").GetArrayLength());
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rows = await db.LogEntries.AsNoTracking().Where(row => row.UserId == user && row.GroupId == groupId).ToListAsync();
        Assert.Equal(3, rows.Count);
        Assert.All(rows, row => Assert.Equal(new DateTime(2026, 10, 24, 8, 15, 0), row.LoggedAt));
    }

    [Fact]
    public async Task A_past_day_needs_a_time_and_every_item_uses_it()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 22, 8, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("group-43b"));
        await Setup(client, "2026-10-22");
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 15, 0, TimeSpan.Zero);
        var groupId = await GroupOfThree(client, "2026-10-24");

        var missing = await Readd(client, groupId, "2026-10-23", "past-none");
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Equal("Pick a time.", (await missing.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        var empty = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-23");
        Assert.Equal(0, empty.GetProperty("entries").GetArrayLength());

        var added = await Readd(client, groupId, "2026-10-23", "past-time", "19:40");
        Assert.Equal(HttpStatusCode.Created, added.StatusCode);
        var entries = (await added.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("entries").EnumerateArray().ToList();
        Assert.Equal(3, entries.Count);
        Assert.All(entries, row =>
        {
            Assert.Equal("2026-10-23", row.GetProperty("localDate").GetString());
            Assert.Equal("19:40", row.GetProperty("time").GetString());
        });
    }

    [Fact]
    public async Task Readding_uses_the_foods_current_values()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("group-43c"));
        await Setup(client, "2026-10-24");
        var oats = await Food(client, "Fictional oats", 200, 10, 4, 30);
        var yogurt = await Food(client, "Fictional yogurt", 80, 6, 2, 8);
        var original = await LogFood(client, "oats", "2026-10-24", oats, 100, "g", "08:00");
        var side = await LogFood(client, "yogurt", "2026-10-24", yogurt, 100, "g", "08:05");
        Assert.Equal(200, (await Entry(client, "2026-10-24", original)).GetProperty("kcal").GetDecimal());

        var saved = await Save(client, "Breakfast", original, side);
        var groupId = (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var edited = await client.PutAsJsonAsync("/api/foods/" + oats, new
        {
            name = "Fictional oats revised",
            kcalPer100 = 50,
            proteinPer100 = 5,
            fatPer100 = 1,
            carbsPer100 = 6,
            basis = "g",
            nutrientBasis = "per_100",
        });
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);

        var added = await Readd(client, groupId, "2026-10-24", "current");
        Assert.Equal(HttpStatusCode.Created, added.StatusCode);
        var entries = (await added.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("entries").EnumerateArray().ToList();
        var fresh = entries.Single(row => row.GetProperty("foodId").GetGuid() == oats);
        Assert.Equal("Fictional oats revised", fresh.GetProperty("name").GetString());
        Assert.Equal(50, fresh.GetProperty("kcal").GetDecimal());
        Assert.Equal(5, fresh.GetProperty("protein").GetDecimal());
        Assert.Equal(1, fresh.GetProperty("fat").GetDecimal());
        Assert.Equal(6, fresh.GetProperty("carbs").GetDecimal());
        Assert.Equal(100, fresh.GetProperty("grams").GetDecimal());
        Assert.NotEqual(original, fresh.GetProperty("id").GetGuid());

        var kept = await Entry(client, "2026-10-24", original);
        Assert.Equal("Fictional oats", kept.GetProperty("name").GetString());
        Assert.Equal(200, kept.GetProperty("kcal").GetDecimal());
        Assert.Equal(10, kept.GetProperty("protein").GetDecimal());
        var yogurtNow = entries.Single(row => row.GetProperty("foodId").GetGuid() == yogurt);
        Assert.Equal(80, yogurtNow.GetProperty("kcal").GetDecimal());
    }

    [Fact]
    public async Task A_retired_custom_food_is_skipped_and_named()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("group-43d"));
        await Setup(client, "2026-10-24");
        var oats = await Food(client, "Fictional oats", 100, 8, 2, 12);
        var bar = await Food(client, "Fictional bar", 300, 20, 8, 30);
        var broth = await Food(client, "Fictional broth", 40, 4, 1, 2);
        var first = await LogFood(client, "oats", "2026-10-24", oats, 100, "g", "08:00");
        var retired = await LogFood(client, "bar", "2026-10-24", bar, 50, "g", "08:10");
        var third = await LogFood(client, "broth", "2026-10-24", broth, 200, "g", "08:20");
        var groupId = (await (await Save(client, "Lunch", first, retired, third)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/foods/" + bar)).StatusCode);

        var added = await Readd(client, groupId, "2026-10-24", "skip-bar");
        Assert.Equal(HttpStatusCode.Created, added.StatusCode);
        var body = await added.Content.ReadFromJsonAsync<JsonElement>();
        var entries = body.GetProperty("entries").EnumerateArray().ToList();
        Assert.Equal(2, entries.Count);
        Assert.Contains(entries, row => row.GetProperty("name").GetString() == "Fictional oats");
        Assert.Contains(entries, row => row.GetProperty("name").GetString() == "Fictional broth");
        Assert.DoesNotContain(entries, row => row.GetProperty("foodId").GetGuid() == bar);
        Assert.Contains("Fictional bar", body.GetProperty("notice").GetString());
        Assert.Contains(body.GetProperty("skipped").EnumerateArray(), row => row.GetProperty("name").GetString() == "Fictional bar");

        var listed = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(5, listed.GetProperty("entries").GetArrayLength());
        Assert.Equal(1, listed.GetProperty("entries").EnumerateArray().Count(row => row.GetProperty("foodId").GetGuid() == bar));
    }

    [Fact]
    public async Task A_quick_add_item_is_logged_again_from_its_stored_values()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("group-quick"));
        await Setup(client, "2026-10-24");
        var oats = await Food(client, "Fictional oats", 100, 8, 2, 12);
        var food = await LogFood(client, "oats", "2026-10-24", oats, 100, "g", "08:00");
        var quick = await LogQuick(client, "bar", "2026-10-24", "Fictional shake", 123, 4, 2, 3, "08:05");
        var groupId = (await (await Save(client, "Snack", food, quick)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var added = await Readd(client, groupId, "2026-10-24", "quick-again");
        Assert.Equal(HttpStatusCode.Created, added.StatusCode);
        var entries = (await added.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("entries").EnumerateArray().ToList();
        var shake = entries.Single(row => row.GetProperty("source").GetString() == "quick");
        Assert.Equal("Fictional shake", shake.GetProperty("name").GetString());
        Assert.Equal(123, shake.GetProperty("kcal").GetDecimal());
        Assert.Equal(4, shake.GetProperty("protein").GetDecimal());
        Assert.Equal(2, shake.GetProperty("fat").GetDecimal());
        Assert.Equal(3, shake.GetProperty("carbs").GetDecimal());
        Assert.Equal(JsonValueKind.Null, shake.GetProperty("foodId").ValueKind);
        Assert.Equal(JsonValueKind.Null, shake.GetProperty("grams").ValueKind);
        Assert.NotEqual(quick, shake.GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task Readding_rejects_a_future_date_and_a_date_before_setup()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 20, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("group-window");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-10-20");
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        var groupId = await GroupOfThree(client, "2026-10-24");

        var future = await Readd(client, groupId, "2026-10-25", "future");
        Assert.Equal(HttpStatusCode.BadRequest, future.StatusCode);
        Assert.Equal("That date is in the future.", (await future.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        var early = await Readd(client, groupId, "2026-10-19", "early", "08:00");
        Assert.Equal(HttpStatusCode.BadRequest, early.StatusCode);
        Assert.Equal("That date is before you set up Gym Bro.", (await early.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());

        Assert.Equal(HttpStatusCode.Created, (await Readd(client, groupId, "2026-10-20", "setup", "07:30")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Readd(client, groupId, "2026-10-24", "today")).StatusCode);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rows = await db.LogEntries.AsNoTracking().Where(row => row.UserId == user).ToListAsync();
        Assert.Equal(9, rows.Count);
        Assert.DoesNotContain(rows, row => row.LocalDate == new DateOnly(2026, 10, 25) || row.LocalDate == new DateOnly(2026, 10, 19));
        Assert.Equal(3, rows.Count(row => row.LocalDate == new DateOnly(2026, 10, 20) && row.LoggedAt.Hour == 7));
    }

    [Fact]
    public async Task Readding_into_a_complete_day_leaves_it_complete()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 22, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("group-complete");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-10-22");
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        var groupId = await GroupOfThree(client, "2026-10-24");
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsync("/api/day-status/2026-10-23", Json(Complete(true, true)))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsync("/api/day-status/2026-10-24", Json(Complete(true)))).StatusCode);

        Assert.Equal(HttpStatusCode.Created, (await Readd(client, groupId, "2026-10-23", "into-fast", "18:00")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Readd(client, groupId, "2026-10-24", "into-done")).StatusCode);

        var fasting = await client.GetFromJsonAsync<JsonElement>("/api/day-status?date=2026-10-23&timeZone=UTC");
        Assert.False(fasting.GetProperty("complete").GetBoolean());
        Assert.True(fasting.GetProperty("fasting").GetBoolean());
        var eaten = await client.GetFromJsonAsync<JsonElement>("/api/day-status?date=2026-10-24&timeZone=UTC");
        Assert.False(eaten.GetProperty("complete").GetBoolean());
        Assert.False(eaten.GetProperty("fasting").GetBoolean());
        var today = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(6, today.GetProperty("entries").GetArrayLength());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rows = await db.DayStatuses.AsNoTracking().Where(row => row.UserId == user).OrderBy(row => row.LocalDate).ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.False(rows[0].Complete);
        Assert.True(rows[0].Fasting);
        Assert.False(rows[1].Complete);
        Assert.False(rows[1].Fasting);
    }

    [Fact]
    public async Task A_soft_deleted_entry_is_left_out_of_a_new_group()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("group-deleted");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-10-24");
        var kept = await LogQuick(client, "kept", "2026-10-24", "Fictional kept", 10, 1, 1, 1, "08:00");
        var also = await LogQuick(client, "also", "2026-10-24", "Fictional also", 20, 1, 1, 1, "09:00");
        var gone = await LogQuick(client, "gone", "2026-10-24", "Fictional gone", 99, 1, 1, 1, "10:00");
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/log-entries/{gone}")).StatusCode);

        var saved = await Save(client, "   ", kept, gone, also);
        Assert.Equal(HttpStatusCode.Created, saved.StatusCode);
        var group = await saved.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("My group", group.GetProperty("name").GetString());
        var items = group.GetProperty("items").EnumerateArray().Select(row => row.GetProperty("name").GetString()).ToArray();
        Assert.Equal(new[] { "Fictional kept", "Fictional also" }, items);
        Assert.DoesNotContain("Fictional gone", items);

        var tooFew = await Save(client, "Nope", kept, gone);
        Assert.Equal(HttpStatusCode.BadRequest, tooFew.StatusCode);
        Assert.Equal("Select 2 or more.", (await tooFew.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());

        var listed = await client.GetFromJsonAsync<JsonElement>("/api/groups");
        Assert.Equal(1, listed.GetProperty("groups").GetArrayLength());
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rows = await db.LogEntries.AsNoTracking().Where(row => row.UserId == user).ToListAsync();
        Assert.Contains(rows, row => row.Id == gone && row.DeletedAt != null && row.GroupId == null);
        Assert.All(rows, row => Assert.Null(row.GroupId));
        Assert.Equal(2, await db.EntryGroupItems.CountAsync(row => row.UserId == user));
    }

    [Fact]
    public async Task Another_user_cannot_list_save_expand_readd_or_delete_a_group()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        var owner = TestData.NewUser("group-owner");
        var strangerId = TestData.NewUser("group-stranger");
        using var client = factory.AsUser(owner);
        using var stranger = factory.AsUser(strangerId);
        await Setup(client, "2026-10-24");
        await Setup(stranger, "2026-10-24");
        var first = await LogQuick(client, "one", "2026-10-24", "Fictional one", 10, 1, 1, 1, "08:00");
        var second = await LogQuick(client, "two", "2026-10-24", "Fictional two", 20, 1, 1, 1, "09:00");
        var saved = await Save(client, "Mine", first, second);
        Assert.Equal(HttpStatusCode.Created, saved.StatusCode);
        var groupId = (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var hidden = await stranger.GetFromJsonAsync<JsonElement>("/api/groups");
        Assert.Equal(0, hidden.GetProperty("groups").GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync("/api/groups/" + groupId)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.DeleteAsync("/api/groups/" + groupId)).StatusCode);
        var stolenLog = await Readd(stranger, groupId, "2026-10-24", "stolen");
        Assert.Equal(HttpStatusCode.NotFound, stolenLog.StatusCode);
        var stolenSave = await Save(stranger, "Stolen", first, second);
        Assert.Equal(HttpStatusCode.NotFound, stolenSave.StatusCode);

        var ownerList = await client.GetFromJsonAsync<JsonElement>("/api/groups");
        Assert.Equal(groupId, ownerList.GetProperty("groups")[0].GetProperty("id").GetGuid());
        var ownerEntries = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(2, ownerEntries.GetProperty("entries").GetArrayLength());
        var strangerEntries = await stranger.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(0, strangerEntries.GetProperty("entries").GetArrayLength());

        Assert.Equal(HttpStatusCode.Created, (await Readd(client, groupId, "2026-10-24", "own-again")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/groups/" + groupId)).StatusCode);
        var after = await client.GetFromJsonAsync<JsonElement>("/api/groups");
        Assert.Equal(0, after.GetProperty("groups").GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/groups/" + groupId)).StatusCode);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(0, await db.EntryGroups.CountAsync(row => row.UserId == owner && row.Id == groupId));
        Assert.Equal(0, await db.EntryGroups.CountAsync(row => row.UserId == strangerId));
        Assert.Equal(0, await db.LogEntries.CountAsync(row => row.UserId == strangerId));
        Assert.Equal(0, await db.EntryGroupItems.CountAsync(row => row.GroupId == groupId));
        var kept = await db.LogEntries.AsNoTracking().Where(row => row.UserId == owner && row.DeletedAt == null).ToListAsync();
        Assert.Equal(4, kept.Count);
        Assert.All(kept, row => Assert.Null(row.GroupId));
    }

    [Fact]
    public async Task A_missing_serving_uses_stored_grams_and_a_liquid_stays_in_millilitres()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("group-serving");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-10-24");
        var bread = await Food(client, "Fictional bread", 100, 10, 2, 16);
        var milk = await Food(client, "Fictional milk", 40, 3, 2, 5, "ml");
        var slice = await client.PostAsJsonAsync("/api/foods/" + bread + "/servings", new { name = "slice", grams = 40 });
        Assert.Equal(HttpStatusCode.Created, slice.StatusCode);
        var sliceId = (await slice.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var sliced = await LogFood(client, "slices", "2026-10-24", bread, 2, "slice", "08:00");
        Assert.Equal(80, (await Entry(client, "2026-10-24", sliced)).GetProperty("grams").GetDecimal());
        var shake = await LogQuick(client, "shake", "2026-10-24", "Fictional shake", 15, 1, 0, 2, "08:05");
        var breadGroup = (await (await Save(client, "Slices", sliced, shake)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var grown = await client.PutAsJsonAsync($"/api/foods/{bread}/servings/{sliceId}", new { name = "slice", grams = 50 });
        Assert.Equal(HttpStatusCode.OK, grown.StatusCode);
        var current = await Readd(client, breadGroup, "2026-10-24", "current-slice");
        Assert.Equal(HttpStatusCode.Created, current.StatusCode);
        var withSlice = (await current.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("entries").EnumerateArray()
            .Single(row => row.GetProperty("foodId").ValueKind != JsonValueKind.Null);
        Assert.Equal("slice", withSlice.GetProperty("unit").GetString());
        Assert.Equal(2, withSlice.GetProperty("amount").GetDecimal());
        Assert.Equal(100, withSlice.GetProperty("grams").GetDecimal());
        Assert.Equal(100, withSlice.GetProperty("kcal").GetDecimal());

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/foods/{bread}/servings/{sliceId}")).StatusCode);
        var fallback = await Readd(client, breadGroup, "2026-10-24", "stored-grams");
        Assert.Equal(HttpStatusCode.Created, fallback.StatusCode);
        var asGrams = (await fallback.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("entries").EnumerateArray()
            .Single(row => row.GetProperty("foodId").ValueKind != JsonValueKind.Null);
        Assert.Equal("g", asGrams.GetProperty("unit").GetString());
        Assert.Equal(80, asGrams.GetProperty("amount").GetDecimal());
        Assert.Equal(80, asGrams.GetProperty("grams").GetDecimal());
        Assert.Equal(80, asGrams.GetProperty("kcal").GetDecimal());
        var kept = await Entry(client, "2026-10-24", sliced);
        Assert.Equal("slice", kept.GetProperty("unit").GetString());
        Assert.Equal(80, kept.GetProperty("grams").GetDecimal());

        var poured = await LogFood(client, "milk", "2026-10-24", milk, 200, "ml", "08:10");
        var quick = await LogQuick(client, "side", "2026-10-24", "Fictional side", 5, 0, 0, 1, "08:12");
        var milkGroup = (await (await Save(client, "Milk", poured, quick)).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var revised = await client.PutAsJsonAsync("/api/foods/" + milk, new
        {
            name = "Fictional milk",
            kcalPer100 = 25,
            proteinPer100 = 2,
            fatPer100 = 1,
            carbsPer100 = 3,
            basis = "ml",
            nutrientBasis = "per_100",
        });
        Assert.Equal(HttpStatusCode.OK, revised.StatusCode);
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.EntryGroupItems.Add(new EntryGroupItem
            {
                Id = Guid.NewGuid(),
                UserId = user,
                GroupId = milkGroup,
                Position = 2,
                FoodId = milk,
                FoodOwnerKey = user,
                Name = "Fictional glass",
                Amount = 1,
                Unit = "glass",
                Grams = 250,
                Kcal = 100,
                Protein = 8,
                Fat = 4,
                Carbs = 12,
            });
            await db.SaveChangesAsync();
        }

        var liquid = await Readd(client, milkGroup, "2026-10-24", "milk");
        Assert.Equal(HttpStatusCode.Created, liquid.StatusCode);
        var logged = await liquid.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("Fictional glass", logged.GetProperty("notice").GetString());
        var rows = logged.GetProperty("entries").EnumerateArray().ToList();
        Assert.Equal(2, rows.Count);
        var milkRow = rows.Single(row => row.GetProperty("foodId").ValueKind != JsonValueKind.Null);
        Assert.Equal("ml", milkRow.GetProperty("unit").GetString());
        Assert.Equal(200, milkRow.GetProperty("amount").GetDecimal());
        Assert.Equal(JsonValueKind.Null, milkRow.GetProperty("grams").ValueKind);
        Assert.Equal(50, milkRow.GetProperty("kcal").GetDecimal());
        Assert.Equal(4, milkRow.GetProperty("protein").GetDecimal());
        Assert.DoesNotContain(rows, row => row.GetProperty("unit").GetString() == "glass");
        var oldMilk = await Entry(client, "2026-10-24", poured);
        Assert.Equal(80, oldMilk.GetProperty("kcal").GetDecimal());
        Assert.Equal("ml", oldMilk.GetProperty("unit").GetString());

        await using var check = factory.Services.CreateAsyncScope();
        var database = check.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(0, await database.UserServings.CountAsync(row => row.UserId == user && row.FoodId == milk));
        Assert.Equal(0, await database.UserServings.CountAsync(row => row.UserId == user && row.FoodId == bread));
    }

    private static async Task<Guid> GroupOfThree(HttpClient client, string date)
    {
        var oats = await Food(client, "Fictional oats", 100, 8, 2, 12);
        var broth = await Food(client, "Fictional broth", 40, 4, 1, 2);
        var bread = await Food(client, "Fictional bread", 80, 6, 1, 14);
        var first = await LogFood(client, "oats-" + date, date, oats, 100, "g", "08:00");
        var second = await LogFood(client, "broth-" + date, date, broth, 100, "g", "08:10");
        var third = await LogFood(client, "bread-" + date, date, bread, 50, "g", "08:20");
        var saved = await Save(client, "Usual breakfast", first, second, third);
        Assert.Equal(HttpStatusCode.Created, saved.StatusCode);
        return (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    private static async Task Setup(HttpClient client, string date)
    {
        await TestData.PutWeighIn(client, date, """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());
    }

    private static async Task<Guid> Food(HttpClient client, string name, decimal kcal, decimal protein, decimal fat, decimal carbs, string basis = "g")
    {
        var response = await client.PostAsJsonAsync("/api/foods", new
        {
            name,
            kcalPer100 = kcal,
            proteinPer100 = protein,
            fatPer100 = fat,
            carbsPer100 = carbs,
            basis,
            nutrientBasis = "per_100",
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    private static async Task<Guid> LogFood(HttpClient client, string key, string date, Guid foodId, decimal amount, string unit, string time)
    {
        var response = await client.PostAsync("/api/log-entries", Json(
            $$"""{"idempotencyKey":"{{key}}","localDate":"{{date}}","timeZone":"UTC","time":"{{time}}","foodId":"{{foodId}}","amount":{{amount}},"unit":"{{unit}}","kcal":1,"protein":1,"fat":1,"carbs":1}"""));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    private static async Task<Guid> LogQuick(HttpClient client, string key, string date, string name, decimal kcal, decimal protein, decimal fat, decimal carbs, string time)
    {
        var response = await client.PostAsync("/api/log-entries", Json(
            $$"""{"idempotencyKey":"{{key}}","localDate":"{{date}}","timeZone":"UTC","time":"{{time}}","name":"{{name}}","kcal":{{kcal}},"protein":{{protein}},"fat":{{fat}},"carbs":{{carbs}}}"""));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    private static async Task<HttpResponseMessage> Save(HttpClient client, string name, params Guid[] ids)
    {
        var list = string.Join(',', ids.Select(id => $"\"{id}\""));
        return await client.PostAsync("/api/groups", Json($$"""{"name":"{{name}}","entryIds":[{{list}}]}"""));
    }

    private static Task<HttpResponseMessage> Readd(HttpClient client, Guid groupId, string date, string key, string? time = null)
    {
        var timePart = time is null ? "" : $",\"time\":\"{time}\"";
        var json = $"{{\"localDate\":\"{date}\",\"timeZone\":\"UTC\",\"idempotencyKey\":\"{key}\"{timePart}}}";
        return client.PostAsync("/api/groups/" + groupId + "/log", Json(json));
    }

    private static async Task<JsonElement> Entry(HttpClient client, string date, Guid id)
    {
        var listed = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=" + date);
        return listed.GetProperty("entries").EnumerateArray().Single(row => row.GetProperty("id").GetGuid() == id);
    }

    private static string Complete(bool complete, bool fasting = false) =>
        $$"""{"complete":{{(complete ? "true" : "false")}},"fasting":{{(fasting ? "true" : "false")}},"timeZone":"UTC"}""";

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");
}
