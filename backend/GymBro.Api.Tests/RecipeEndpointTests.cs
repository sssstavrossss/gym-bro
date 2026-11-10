using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class RecipeEndpointTests(ApiFactory factory)
{
    [Fact]
    public async Task Totals_per_portion_and_per_gram_come_from_the_foods_not_the_request()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 15, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("recipe-math"));
        await Setup(client, "2026-10-24");
        var chicken = await Food(client, "Fictional chicken", 400, 100, 10, 0);

        var saved = await Save(client, "Chicken pot", 5, 500, 1, (chicken, 250, "g"));
        Assert.Equal(HttpStatusCode.Created, saved.StatusCode);
        var recipe = await saved.Content.ReadFromJsonAsync<JsonElement>();
        var id = recipe.GetProperty("id").GetGuid();
        Assert.Equal(1000, recipe.GetProperty("kcal").GetDecimal());
        Assert.Equal(250, recipe.GetProperty("protein").GetDecimal());
        Assert.Equal(25, recipe.GetProperty("fat").GetDecimal());
        Assert.Equal(0, recipe.GetProperty("carbs").GetDecimal());
        Assert.Equal(200, recipe.GetProperty("perPortion").GetProperty("kcal").GetDecimal());
        Assert.Equal(50, recipe.GetProperty("perPortion").GetProperty("protein").GetDecimal());
        Assert.Equal(2, recipe.GetProperty("perGram").GetProperty("kcal").GetDecimal());
        Assert.Equal(0.5m, recipe.GetProperty("perGram").GetProperty("protein").GetDecimal());
        Assert.Equal(250, recipe.GetProperty("ingredients")[0].GetProperty("grams").GetDecimal());
        Assert.Equal(250, recipe.GetProperty("ingredients")[0].GetProperty("protein").GetDecimal());

        var portion = await Log(client, id, "2026-10-24", "portion-1", 1, "portion");
        Assert.Equal(HttpStatusCode.Created, portion.StatusCode);
        var one = await portion.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Chicken pot", one.GetProperty("name").GetString());
        Assert.Equal("recipe", one.GetProperty("source").GetString());
        Assert.Equal("portion", one.GetProperty("unit").GetString());
        Assert.Equal(1, one.GetProperty("amount").GetDecimal());
        Assert.Equal(50, one.GetProperty("protein").GetDecimal());
        Assert.Equal(200, one.GetProperty("kcal").GetDecimal());
        Assert.Equal(100, one.GetProperty("grams").GetDecimal());
        Assert.Equal(JsonValueKind.Null, one.GetProperty("foodId").ValueKind);
        Assert.Equal("08:15", one.GetProperty("time").GetString());

        var replay = await Log(client, id, "2026-10-24", "portion-1", 2, "portions");
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal(one.GetProperty("id").GetGuid(), (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid());

        var grams = await Log(client, id, "2026-10-24", "grams-100", 100, "g");
        Assert.Equal(HttpStatusCode.Created, grams.StatusCode);
        var eaten = await grams.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(50, eaten.GetProperty("protein").GetDecimal());
        Assert.Equal(200, eaten.GetProperty("kcal").GetDecimal());
        Assert.Equal(100, eaten.GetProperty("grams").GetDecimal());
        Assert.Equal("g", eaten.GetProperty("unit").GetString());
        Assert.NotEqual(one.GetProperty("id").GetGuid(), eaten.GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task Mixed_gram_and_millilitre_ingredients_sum_nutrients_and_refuse_gram_logging_without_a_finished_weight()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("recipe-mix"));
        await Setup(client, "2026-10-24");
        var oats = await Food(client, "Fictional oats", 200, 20, 4, 30);
        var milk = await Food(client, "Fictional milk", 50, 5, 2, 6, "ml");
        var saved = await Save(client, "Overnight oats", 2, null, (oats, 100, "g"), (milk, 250, "ml"));
        Assert.Equal(HttpStatusCode.Created, saved.StatusCode);
        var recipe = await saved.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(325, recipe.GetProperty("kcal").GetDecimal());
        Assert.Equal(32.5m, recipe.GetProperty("protein").GetDecimal());
        Assert.Equal(162.5m, recipe.GetProperty("perPortion").GetProperty("kcal").GetDecimal());
        Assert.Equal(JsonValueKind.Null, recipe.GetProperty("perGram").ValueKind);
        var items = recipe.GetProperty("ingredients").EnumerateArray().ToList();
        Assert.Equal(100, items.Single(row => row.GetProperty("unit").GetString() == "g").GetProperty("grams").GetDecimal());
        Assert.Equal(JsonValueKind.Null, items.Single(row => row.GetProperty("unit").GetString() == "ml").GetProperty("grams").ValueKind);

        var refused = await Log(client, recipe.GetProperty("id").GetGuid(), "2026-10-24", "no-grams", 100, "g");
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Equal(
            "This recipe has no finished weight, so it can't be logged in grams.",
            (await refused.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());

        var logged = await Log(client, recipe.GetProperty("id").GetGuid(), "2026-10-24", "half", 1, "portion");
        Assert.Equal(HttpStatusCode.Created, logged.StatusCode);
        var entry = await logged.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(162.5m, entry.GetProperty("kcal").GetDecimal());
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("grams").ValueKind);
    }

    [Fact]
    public async Task An_own_serving_is_an_ingredient_and_a_quick_add_is_not()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("recipe-slice"));
        await Setup(client, "2026-10-24");
        var bread = await Food(client, "Fictional bread", 250, 10, 2, 40);
        var slice = await client.PostAsJsonAsync("/api/foods/" + bread + "/servings", new { name = "slice", grams = 40 });
        Assert.Equal(HttpStatusCode.Created, slice.StatusCode);

        var saved = await Save(client, "Toast", 2, null, (bread, 2, "slice"));
        Assert.Equal(HttpStatusCode.Created, saved.StatusCode);
        var recipe = await saved.Content.ReadFromJsonAsync<JsonElement>();
        var item = recipe.GetProperty("ingredients")[0];
        Assert.Equal("slice", item.GetProperty("unit").GetString());
        Assert.Equal(80, item.GetProperty("grams").GetDecimal());
        Assert.Equal(200, item.GetProperty("kcal").GetDecimal());
        Assert.Equal(100, recipe.GetProperty("perPortion").GetProperty("kcal").GetDecimal());

        var quick = await client.PostAsync("/api/recipes", Json(
            """{"name":"Nope","portions":1,"ingredients":[{"amount":1,"unit":"g","kcal":100}]}"""));
        Assert.Equal(HttpStatusCode.BadRequest, quick.StatusCode);
        Assert.Equal("Choose a food.", (await quick.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());

        var none = await client.PostAsync("/api/recipes", Json("""{"name":"Empty","portions":1,"ingredients":[]}"""));
        Assert.Equal(HttpStatusCode.BadRequest, none.StatusCode);
        Assert.Equal("Add at least one food.", (await none.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
    }

    [Fact]
    public async Task Editing_a_recipe_changes_later_logs_and_leaves_the_snapshot_alone()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("recipe-snapshot");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-10-24");
        var chicken = await Food(client, "Fictional chicken", 400, 100, 10, 0);
        var created = await Save(client, "Chicken pot", 5, 500, (chicken, 250, "g"));
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var first = await Log(client, id, "2026-10-24", "before-edit", 1, "portion");
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        var originalId = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var editedFood = await client.PutAsJsonAsync("/api/foods/" + chicken, new
        {
            name = "Fictional chicken",
            kcalPer100 = 200,
            proteinPer100 = 40,
            fatPer100 = 5,
            carbsPer100 = 0,
            basis = "g",
            nutrientBasis = "per_100",
        });
        Assert.Equal(HttpStatusCode.OK, editedFood.StatusCode);
        var updated = await client.PutAsync("/api/recipes/" + id, Json(
            $$"""{"name":"Chicken pot","portions":5,"finishedGrams":500,"ingredients":[{"foodId":"{{chicken}}","amount":250,"unit":"g","kcal":1,"protein":1}]}"""));
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var recipe = await updated.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(500, recipe.GetProperty("kcal").GetDecimal());
        Assert.Equal(100, recipe.GetProperty("protein").GetDecimal());
        Assert.Equal(20, recipe.GetProperty("perPortion").GetProperty("protein").GetDecimal());

        var kept = await Entry(client, "2026-10-24", originalId);
        Assert.Equal("Chicken pot", kept.GetProperty("name").GetString());
        Assert.Equal(50, kept.GetProperty("protein").GetDecimal());
        Assert.Equal(200, kept.GetProperty("kcal").GetDecimal());

        var again = await Log(client, id, "2026-10-24", "after-edit", 1, "portion");
        Assert.Equal(HttpStatusCode.Created, again.StatusCode);
        var fresh = await again.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(20, fresh.GetProperty("protein").GetDecimal());
        Assert.Equal(100, fresh.GetProperty("kcal").GetDecimal());
        Assert.NotEqual(originalId, fresh.GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task A_retired_ingredient_keeps_the_saved_total_and_is_named_on_edit()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("recipe-retired-food"));
        await Setup(client, "2026-10-24");
        var chicken = await Food(client, "Fictional chicken", 400, 100, 10, 0);
        var rice = await Food(client, "Fictional rice", 130, 3, 1, 28);
        var created = await Save(client, "Plate", 2, null, (chicken, 100, "g"), (rice, 100, "g"));
        var recipe = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = recipe.GetProperty("id").GetGuid();
        Assert.Equal(530, recipe.GetProperty("kcal").GetDecimal());
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/foods/" + chicken)).StatusCode);

        var listed = await client.GetFromJsonAsync<JsonElement>("/api/recipes/" + id);
        Assert.Equal(530, listed.GetProperty("kcal").GetDecimal());
        Assert.Contains("Fictional chicken", listed.GetProperty("notice").GetString());
        var chickenRow = listed.GetProperty("ingredients").EnumerateArray().Single(row => row.GetProperty("foodId").GetGuid() == chicken);
        Assert.False(chickenRow.GetProperty("available").GetBoolean());
        Assert.Equal(400, chickenRow.GetProperty("kcal").GetDecimal());

        var renamed = await client.PutAsync("/api/recipes/" + id, Json(
            $$"""{"name":"Plate renamed","portions":2,"ingredients":[{"foodId":"{{chicken}}","amount":100,"unit":"g"},{"foodId":"{{rice}}","amount":100,"unit":"g"}]}"""));
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        var kept = await renamed.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Plate renamed", kept.GetProperty("name").GetString());
        Assert.Equal(530, kept.GetProperty("kcal").GetDecimal());
        Assert.Equal(265, kept.GetProperty("perPortion").GetProperty("kcal").GetDecimal());
        Assert.Contains("Fictional chicken", kept.GetProperty("notice").GetString());

        var logged = await Log(client, id, "2026-10-24", "still", 1, "portion");
        Assert.Equal(HttpStatusCode.Created, logged.StatusCode);
        Assert.Equal(265, (await logged.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("kcal").GetDecimal());
    }

    [Fact]
    public async Task Another_users_recipe_or_food_is_a_404()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        var owner = TestData.NewUser("recipe-owner");
        var strangerId = TestData.NewUser("recipe-stranger");
        using var client = factory.AsUser(owner);
        using var stranger = factory.AsUser(strangerId);
        await Setup(client, "2026-10-24");
        await Setup(stranger, "2026-10-24");
        var chicken = await Food(client, "Fictional chicken", 400, 100, 10, 0);
        var saved = await Save(client, "Mine", 2, 400, (chicken, 100, "g"));
        var id = (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        Assert.Equal(0, (await stranger.GetFromJsonAsync<JsonElement>("/api/recipes")).GetProperty("recipes").GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync("/api/recipes/" + id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.DeleteAsync("/api/recipes/" + id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Log(stranger, id, "2026-10-24", "stolen", 1, "portion")).StatusCode);
        var stolen = await stranger.PutAsync("/api/recipes/" + id, Json(
            $$"""{"name":"Stolen","portions":1,"ingredients":[{"foodId":"{{chicken}}","amount":100,"unit":"g"}]}"""));
        Assert.Equal(HttpStatusCode.NotFound, stolen.StatusCode);
        var hiddenFood = await stranger.PostAsync("/api/recipes", Json(
            $$"""{"name":"Hidden","portions":1,"ingredients":[{"foodId":"{{chicken}}","amount":50,"unit":"g"}]}"""));
        Assert.Equal(HttpStatusCode.NotFound, hiddenFood.StatusCode);

        var ownerList = await client.GetFromJsonAsync<JsonElement>("/api/recipes");
        Assert.Equal(id, ownerList.GetProperty("recipes")[0].GetProperty("id").GetGuid());
        Assert.Equal(0, (await stranger.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24")).GetProperty("entries").GetArrayLength());
    }

    [Fact]
    public async Task Retiring_a_recipe_hides_it_and_leaves_past_logs()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("recipe-retire");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-10-24");
        var chicken = await Food(client, "Fictional chicken", 400, 100, 10, 0);
        var id = (await (await Save(client, "Chicken pot", 4, null, (chicken, 100, "g"))).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.Created, (await Log(client, id, "2026-10-24", "keep-me", 1, "portion")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/recipes/" + id)).StatusCode);
        Assert.Equal(0, (await client.GetFromJsonAsync<JsonElement>("/api/recipes")).GetProperty("recipes").GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/recipes/" + id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Log(client, id, "2026-10-24", "after-retire", 1, "portion")).StatusCode);

        var entries = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-24");
        Assert.Equal(1, entries.GetProperty("entries").GetArrayLength());
        Assert.Equal("Chicken pot", entries.GetProperty("entries")[0].GetProperty("name").GetString());
        Assert.Equal(100, entries.GetProperty("entries")[0].GetProperty("kcal").GetDecimal());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = await db.Recipes.AsNoTracking().SingleAsync(recipe => recipe.Id == id);
        Assert.Equal(user, row.UserId);
        Assert.NotNull(row.RetiredAt);
        Assert.Equal(1, await db.RecipeIngredients.CountAsync(item => item.RecipeId == id));
        Assert.Equal(1, await db.LogEntries.CountAsync(entry => entry.UserId == user && entry.DeletedAt == null));
    }

    [Fact]
    public async Task Logging_follows_the_past_day_future_setup_and_complete_day_rules()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 22, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("recipe-window");
        using var client = factory.AsUser(user);
        await Setup(client, "2026-10-22");
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 9, 0, 0, TimeSpan.Zero);
        var chicken = await Food(client, "Fictional chicken", 100, 10, 1, 0);
        var id = (await (await Save(client, "Chicken pot", 2, null, (chicken, 100, "g"))).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        Assert.Equal(HttpStatusCode.OK, (await client.PutAsync("/api/day-status/2026-10-23", Json(Complete(true, true)))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsync("/api/day-status/2026-10-24", Json(Complete(true)))).StatusCode);

        var missingTime = await Log(client, id, "2026-10-23", "past-none", 1, "portion");
        Assert.Equal(HttpStatusCode.BadRequest, missingTime.StatusCode);
        Assert.Equal("Pick a time.", (await missingTime.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        Assert.Equal(0, (await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-10-23")).GetProperty("entries").GetArrayLength());

        var past = await Log(client, id, "2026-10-23", "past-time", 1, "portion", "19:40");
        Assert.Equal(HttpStatusCode.Created, past.StatusCode);
        Assert.Equal("19:40", (await past.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("time").GetString());

        var future = await Log(client, id, "2026-10-25", "future", 1, "portion");
        Assert.Equal(HttpStatusCode.BadRequest, future.StatusCode);
        Assert.Equal("That date is in the future.", (await future.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        var early = await Log(client, id, "2026-10-21", "early", 1, "portion", "08:00");
        Assert.Equal(HttpStatusCode.BadRequest, early.StatusCode);
        Assert.Equal("That date is before you set up Gym Bro.", (await early.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());

        Assert.Equal(HttpStatusCode.Created, (await Log(client, id, "2026-10-24", "into-done", 1, "portion")).StatusCode);

        var fasting = await client.GetFromJsonAsync<JsonElement>("/api/day-status?date=2026-10-23&timeZone=UTC");
        Assert.False(fasting.GetProperty("complete").GetBoolean());
        Assert.True(fasting.GetProperty("fasting").GetBoolean());
        var eaten = await client.GetFromJsonAsync<JsonElement>("/api/day-status?date=2026-10-24&timeZone=UTC");
        Assert.False(eaten.GetProperty("complete").GetBoolean());
        Assert.False(eaten.GetProperty("fasting").GetBoolean());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rows = await db.DayStatuses.AsNoTracking().Where(row => row.UserId == user).OrderBy(row => row.LocalDate).ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.False(rows[0].Complete);
        Assert.True(rows[0].Fasting);
        Assert.False(rows[1].Complete);
        Assert.False(rows[1].Fasting);
        Assert.Equal(2, await db.LogEntries.CountAsync(entry => entry.UserId == user && entry.DeletedAt == null));
        Assert.DoesNotContain(await db.LogEntries.AsNoTracking().Where(entry => entry.UserId == user).Select(entry => entry.LocalDate).ToListAsync(), date => date == new DateOnly(2026, 10, 25) || date == new DateOnly(2026, 10, 21));
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

    private static Task<HttpResponseMessage> Save(
        HttpClient client,
        string name,
        decimal portions,
        decimal? finishedGrams,
        params (Guid FoodId, decimal Amount, string Unit)[] ingredients)
    {
        return Save(client, name, portions, finishedGrams, kcalLie: null, ingredients);
    }

    private static Task<HttpResponseMessage> Save(
        HttpClient client,
        string name,
        decimal portions,
        decimal? finishedGrams,
        int? kcalLie,
        params (Guid FoodId, decimal Amount, string Unit)[] ingredients)
    {
        var rows = string.Join(',', ingredients.Select(item =>
        {
            var lie = kcalLie is null ? "" : $",\"kcal\":{kcalLie}";
            return "{\"foodId\":\"" + item.FoodId + "\",\"amount\":" + item.Amount.ToString(System.Globalization.CultureInfo.InvariantCulture) + ",\"unit\":\"" + item.Unit + "\"" + lie + "}";
        }));
        var finished = finishedGrams is null ? "null" : finishedGrams.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return client.PostAsync("/api/recipes", Json(
            $$"""{"name":"{{name}}","portions":{{portions}},"finishedGrams":{{finished}},"ingredients":[{{rows}}]}"""));
    }

    private static Task<HttpResponseMessage> Log(HttpClient client, Guid id, string date, string key, decimal amount, string unit, string? time = null)
    {
        var timePart = time is null ? "" : ",\"time\":\"" + time + "\"";
        var json = "{\"localDate\":\"" + date + "\",\"timeZone\":\"UTC\",\"idempotencyKey\":\"" + key + "\",\"amount\":" + amount.ToString(System.Globalization.CultureInfo.InvariantCulture) + ",\"unit\":\"" + unit + "\"" + timePart + "}";
        return client.PostAsync("/api/recipes/" + id + "/log", Json(json));
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
