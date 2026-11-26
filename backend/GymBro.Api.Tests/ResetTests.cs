using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class ResetTests(ApiFactory factory)
{
    [Fact]
    public async Task Reset_training_deletes_workouts_and_the_plan_and_nothing_else()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 26, 12, 0, 0, TimeSpan.Zero);
        var (client, user) = await Seeded("reset-training");
        var (stranger, strangerId) = await Seeded("reset-training-other");

        var before = await client.GetFromJsonAsync<JsonElement>("/api/reset");
        Assert.Equal(2, before.GetProperty("training").GetProperty("workouts").GetInt32());
        Assert.Equal("muscle", before.GetProperty("training").GetProperty("plan").GetProperty("goal").GetString());
        Assert.Equal(2, before.GetProperty("nutrition").GetProperty("entries").GetInt32());
        Assert.Equal(1, before.GetProperty("nutrition").GetProperty("days").GetInt32());
        Assert.Equal(1, before.GetProperty("nutrition").GetProperty("foods").GetInt32());
        Assert.Equal(1, before.GetProperty("nutrition").GetProperty("recipes").GetInt32());
        Assert.Equal(1, before.GetProperty("nutrition").GetProperty("groups").GetInt32());

        var reset = await client.PostAsync("/api/reset/training", null);
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
        var done = await reset.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, done.GetProperty("workouts").GetInt32());
        Assert.True(done.GetProperty("plan").GetBoolean());

        var after = await client.GetFromJsonAsync<JsonElement>("/api/reset");
        Assert.Equal(0, after.GetProperty("training").GetProperty("workouts").GetInt32());
        Assert.Equal(JsonValueKind.Null, after.GetProperty("training").GetProperty("plan").ValueKind);
        Assert.Equal(before.GetProperty("nutrition").GetRawText(), after.GetProperty("nutrition").GetRawText());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.WorkoutSets.AnyAsync(row => row.UserId == user));
        Assert.False(await db.TrainingPlans.AnyAsync(row => row.UserId == user));
        Assert.True(await db.WeighIns.AnyAsync(row => row.UserId == user));
        Assert.True(await db.Profiles.AnyAsync(row => row.UserId == user));
        Assert.True(await db.TargetHistories.AnyAsync(row => row.UserId == user));
        // Someone else's training stays.
        Assert.Equal(2, await db.WorkoutSessions.CountAsync(row => row.UserId == strangerId));
        Assert.True(await db.TrainingPlans.AnyAsync(row => row.UserId == strangerId));
        stranger.Dispose();
        client.Dispose();
    }

    [Fact]
    public async Task Reset_nutrition_deletes_the_log_and_with_foods_the_users_own_foods_recipes_and_groups()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 26, 12, 0, 0, TimeSpan.Zero);
        var (client, user) = await Seeded("reset-food");
        var (stranger, strangerId) = await Seeded("reset-food-other");

        // The log only: own foods, recipes and groups stay.
        var logOnly = await client.PostAsJsonAsync("/api/reset/nutrition", new { foods = false });
        Assert.Equal(HttpStatusCode.OK, logOnly.StatusCode);
        var done = await logOnly.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, done.GetProperty("entries").GetInt32());
        Assert.Equal(0, done.GetProperty("foods").GetInt32());

        var mid = await client.GetFromJsonAsync<JsonElement>("/api/reset");
        Assert.Equal(0, mid.GetProperty("nutrition").GetProperty("entries").GetInt32());
        Assert.Equal(0, mid.GetProperty("nutrition").GetProperty("days").GetInt32());
        Assert.Equal(1, mid.GetProperty("nutrition").GetProperty("foods").GetInt32());
        Assert.Equal(1, mid.GetProperty("nutrition").GetProperty("recipes").GetInt32());
        Assert.Equal(1, mid.GetProperty("nutrition").GetProperty("groups").GetInt32());
        Assert.Equal(2, mid.GetProperty("training").GetProperty("workouts").GetInt32());
        // The logged description is no longer offered again, but still counts toward the limit.
        var describe = await client.GetFromJsonAsync<JsonElement>("/api/describe");
        Assert.Empty(describe.GetProperty("recent").EnumerateArray());
        Assert.Equal(19, describe.GetProperty("left").GetInt32());

        var all = await client.PostAsJsonAsync("/api/reset/nutrition", new { foods = true });
        Assert.Equal(HttpStatusCode.OK, all.StatusCode);
        var gone = await all.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, gone.GetProperty("foods").GetInt32());
        Assert.Equal(1, gone.GetProperty("recipes").GetInt32());
        Assert.Equal(1, gone.GetProperty("groups").GetInt32());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.LogEntries.AnyAsync(row => row.UserId == user));
        Assert.False(await db.DayStatuses.AnyAsync(row => row.UserId == user));
        Assert.False(await db.Foods.AnyAsync(row => row.UserId == user));
        Assert.False(await db.Recipes.AnyAsync(row => row.UserId == user));
        Assert.False(await db.EntryGroups.AnyAsync(row => row.UserId == user));
        Assert.False(await db.UserServings.AnyAsync(row => row.UserId == user));
        // Body, targets, settings and training stay.
        Assert.True(await db.WeighIns.AnyAsync(row => row.UserId == user));
        Assert.True(await db.Profiles.AnyAsync(row => row.UserId == user));
        Assert.True(await db.TargetHistories.AnyAsync(row => row.UserId == user));
        Assert.Equal(2, await db.WorkoutSessions.CountAsync(row => row.UserId == user));
        Assert.True(await db.TrainingPlans.AnyAsync(row => row.UserId == user));
        // Someone else's nutrition stays.
        Assert.Equal(2, await db.LogEntries.CountAsync(row => row.UserId == strangerId && row.DeletedAt == null));
        Assert.True(await db.Foods.AnyAsync(row => row.UserId == strangerId));
        Assert.True(await db.Recipes.AnyAsync(row => row.UserId == strangerId));
        stranger.Dispose();
        client.Dispose();
    }

    /// <summary>A user with a profile, a weigh-in, a custom food with a serving, two log entries (one deleted, one closed day),
    /// a group, a recipe, a logged description, two workouts and a plan.</summary>
    private async Task<(HttpClient Client, string User)> Seeded(string label)
    {
        var user = TestData.NewUser(label);
        var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-11-26", """{"kg":83.60,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());
        var food = await client.PostAsJsonAsync("/api/foods", new { name = "Fictional reset oats", kcalPer100 = 380, proteinPer100 = 13, fatPer100 = 7, carbsPer100 = 60, basis = "g", nutrientBasis = "per_100" });
        Assert.Equal(HttpStatusCode.Created, food.StatusCode);
        var foodId = (await food.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync($"/api/foods/{foodId}/servings", new { name = "bowl", grams = 60 })).StatusCode);
        var first = await Log(client, "a", $$"""{"foodId":"{{foodId}}","amount":60,"unit":"g","time":"07:30"}""");
        var second = await Log(client, "b", """{"name":"Fictional reset snack","kcal":99,"protein":1,"fat":1,"carbs":1,"time":"12:00"}""");
        var gone = await Log(client, "c", """{"name":"Fictional reset deleted","kcal":99,"protein":1,"fat":1,"carbs":1,"time":"13:00"}""");
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/log-entries/" + gone)).StatusCode);
        var group = await client.PostAsync("/api/groups", Json($$"""{"name":"Fictional reset breakfast","entryIds":["{{first}}","{{second}}"]}"""));
        Assert.True(group.IsSuccessStatusCode, await group.Content.ReadAsStringAsync());
        Assert.True((await client.PostAsync("/api/recipes", Json($$"""{"name":"Fictional reset porridge","portions":2,"ingredients":[{"foodId":"{{foodId}}","amount":120,"unit":"g"}]}"""))).IsSuccessStatusCode);
        Assert.True((await client.PutAsync("/api/day-status/2026-11-26", Json("""{"complete":true,"fasting":false,"timeZone":"UTC"}"""))).IsSuccessStatusCode);
        var described = await client.PostAsJsonAsync("/api/describe", new { text = "60 g fictional oats" });
        var describedId = (await described.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var logged = await client.PostAsJsonAsync($"/api/describe/{describedId}/logged", new { items = new[] { new { phrase = "60 g fictional oats", name = "Fictional reset oats", guessed = false, foodId, amount = 60, unit = "g" } } });
        Assert.True(logged.IsSuccessStatusCode, await logged.Content.ReadAsStringAsync());
        Assert.True((await client.PutAsJsonAsync("/api/plan", new { goal = "muscle", weekdays = new[] { 0, 2, 4 }, minutes = 60, experience = "some", equipment = new[] { "gym" }, goEasy = Array.Empty<string>(), timeZone = "UTC" })).IsSuccessStatusCode);
        for (var i = 0; i < 2; i++)
        {
            Assert.True((await client.PutAsJsonAsync("/api/workouts/" + Guid.NewGuid(), new
            {
                date = "2026-11-2" + (4 + i), timeZone = "UTC", name = "Fictional legs",
                sets = new object[] { new { exerciseId = "barbell-squat", block = 0, kg = 80, reps = 8, doneAt = $"2026-11-2{4 + i}T17:05:00Z" } },
            })).IsSuccessStatusCode);
        }

        return (client, user);
    }

    private static async Task<Guid> Log(HttpClient client, string key, string fields)
    {
        var body = fields.TrimEnd('}') + $$""","idempotencyKey":"{{key}}","localDate":"2026-11-26","timeZone":"UTC"}""";
        var response = await client.PostAsync("/api/log-entries", Json(body));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");
}
