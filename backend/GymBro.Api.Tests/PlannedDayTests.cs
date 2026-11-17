using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace GymBro.Api.Tests;

/// <summary>Food can be logged on a later day to plan it, up to a year ahead.</summary>
[Collection(ApiCollection.Name)]
public sealed class PlannedDayTests(ApiFactory factory)
{
    [Fact]
    public async Task Food_goes_on_a_later_day_up_to_a_year_ahead_and_stays_out_of_progress()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("planned"));
        await TestData.PutWeighIn(client, "2026-10-24", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());

        var planned = await client.PostAsync("/api/log-entries", Json(Quick("plan-1", "2026-10-26", "500", "\"time\":\"12:30\"")));
        Assert.Equal(HttpStatusCode.Created, planned.StatusCode);
        var plannedBody = await planned.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("2026-10-26", plannedBody.GetProperty("localDate").GetString());
        Assert.Equal("12:30", plannedBody.GetProperty("time").GetString());

        Assert.Equal(HttpStatusCode.Created, (await client.PostAsync("/api/log-entries", Json(Quick("plan-edge", "2027-10-24", "10", "\"time\":\"08:00\"")))).StatusCode);
        var tooFar = await client.PostAsync("/api/log-entries", Json(Quick("plan-far", "2027-10-25", "10", "\"time\":\"08:00\"")));
        Assert.Equal(HttpStatusCode.BadRequest, tooFar.StatusCode);
        Assert.Equal("Plan at most a year ahead.", (await tooFar.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());

        // Today's entry moves to tomorrow and is copied to the day after.
        var today = await client.PostAsync("/api/log-entries", Json(Quick("today-1", "2026-10-24", "200", "\"time\":\"08:00\"")));
        var todayId = (await today.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var copied = await client.PostAsync("/api/log-entries/copy", Json($$"""{"localDate":"2026-10-27","timeZone":"UTC","items":[{"id":"{{todayId}}","idempotencyKey":"copy-plan"}]}"""));
        Assert.Equal(HttpStatusCode.Created, copied.StatusCode);
        var moved = await client.PatchAsync($"/api/log-entries/{todayId}", Json("""{"localDate":"2026-10-25"}"""));
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);

        // A saved group and a recipe log onto a later day with a time.
        var group = await client.PostAsync("/api/groups", Json($$"""{"name":"Planned lunch","entryIds":["{{todayId}}","{{plannedBody.GetProperty("id").GetGuid()}}"]}"""));
        Assert.Equal(HttpStatusCode.Created, group.StatusCode);
        var groupId = (await group.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var groupNoTime = await client.PostAsync($"/api/groups/{groupId}/log", Json("""{"localDate":"2026-10-28","timeZone":"UTC","idempotencyKey":"group-plan-none"}"""));
        Assert.Equal("Pick a time.", (await groupNoTime.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsync($"/api/groups/{groupId}/log", Json("""{"localDate":"2026-10-28","timeZone":"UTC","idempotencyKey":"group-plan","time":"13:00"}"""))).StatusCode);

        var food = await client.PostAsJsonAsync("/api/foods", new { name = "Fictional planned rice", kcalPer100 = 130, proteinPer100 = 3, fatPer100 = 0, carbsPer100 = 28, basis = "g", nutrientBasis = "per_100" });
        var foodId = (await food.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var recipe = await client.PostAsync("/api/recipes", Json($$"""{"name":"Fictional rice pot","portions":2,"finishedGrams":null,"ingredients":[{"foodId":"{{foodId}}","amount":200,"unit":"g"}]}"""));
        var recipeId = (await recipe.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var recipeLog = await client.PostAsync($"/api/recipes/{recipeId}/log", Json("""{"localDate":"2026-10-29","timeZone":"UTC","idempotencyKey":"recipe-plan","amount":1,"unit":"portion","time":"19:00"}"""));
        Assert.Equal(HttpStatusCode.Created, recipeLog.StatusCode);

        // The strip sees the planned days; a planned day opens but can't be marked yet.
        var days = await client.GetFromJsonAsync<JsonElement>("/api/log-days?from=2026-10-19&to=2026-11-01&timeZone=UTC");
        Assert.Equal(
            new[] { "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29" },
            days.GetProperty("loggedDates").EnumerateArray().Select(day => day.GetString() ?? "").ToArray());
        var status = await client.GetFromJsonAsync<JsonElement>("/api/day-status?date=2026-10-26&timeZone=UTC");
        Assert.False(status.GetProperty("complete").GetBoolean());
        var mark = await client.PutAsync("/api/day-status/2026-10-26", Json("""{"complete":true,"fasting":false,"timeZone":"UTC"}"""));
        Assert.Equal(HttpStatusCode.BadRequest, mark.StatusCode);
        var targets = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-10-26");
        Assert.True(targets.GetProperty("targets").GetProperty("kcal").GetDecimal() > 0);

        // Progress stops at today, so a plan never counts as eaten.
        var progress = await client.GetFromJsonAsync<JsonElement>("/api/progress?range=7d");
        var shown = progress.GetProperty("days").EnumerateArray().ToList();
        Assert.Equal("2026-10-24", shown[^1].GetProperty("date").GetString());
        Assert.False(shown[^1].GetProperty("logged").GetBoolean());
    }

    private static string Quick(string key, string date, string kcal, string extra) =>
        $$"""{"idempotencyKey":"{{key}}","localDate":"{{date}}","timeZone":"UTC","name":"Fictional planned bar","kcal":{{kcal}},"protein":1,"fat":1,"carbs":1,{{extra}}}""";

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");
}
