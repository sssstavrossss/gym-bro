using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Profiles;
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
    public async Task The_food_country_follows_the_time_zone_until_one_is_picked()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("settings-country");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-11-16", """{"kg":83.6,"timeZone":"UTC"}""");
        var saved = (await TestData.PutProfile(client, TestData.Profile(timeZone: "Europe/Stockholm"))).GetProperty("profile");
        Assert.Equal(("SE", true), (saved.GetProperty("foodCountry").GetString(), saved.GetProperty("foodCountryFollowsZone").GetBoolean()));

        // A new zone brings its country while the country follows it.
        var moved = await Settings(client, new { timeZone = "Europe/Helsinki" });
        Assert.Equal(("FI", true), (moved.GetProperty("foodCountry").GetString(), moved.GetProperty("foodCountryFollowsZone").GetBoolean()));

        // Picked by hand, it stays when the zone moves.
        var picked = await Settings(client, new { foodCountry = "no", foodCountryFollowsZone = false });
        Assert.Equal(("NO", false), (picked.GetProperty("foodCountry").GetString(), picked.GetProperty("foodCountryFollowsZone").GetBoolean()));
        Assert.Equal("NO", (await Settings(client, new { timeZone = "Europe/Stockholm" })).GetProperty("foodCountry").GetString());
        var state = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal("NO", state.GetProperty("profile").GetProperty("foodCountry").GetString());

        // Following again goes back to the zone's country.
        Assert.Equal("SE", (await Settings(client, new { foodCountryFollowsZone = true })).GetProperty("foodCountry").GetString());

        var unknown = await client.PutAsJsonAsync("/api/profile/settings", new { foodCountry = "XX", foodCountryFollowsZone = false });
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.True((await client.GetFromJsonAsync<JsonElement>("/api/profile")).GetProperty("profile").GetProperty("foodCountryFollowsZone").GetBoolean());
        Assert.Equal(1, await HistoryCount(user));
    }

    [Fact]
    public void A_zone_names_its_country_and_a_zone_with_none_falls_back_to_norway()
    {
        Assert.Equal(("SE", "FI", "NO", "US"), (FoodCountries.OfZone("Europe/Stockholm"), FoodCountries.OfZone("Europe/Helsinki"), FoodCountries.OfZone("Europe/Oslo"), FoodCountries.OfZone("America/New_York")));
        // Older names some browsers report.
        Assert.Equal(("UA", "IN"), (FoodCountries.OfZone("Europe/Kiev"), FoodCountries.OfZone("Asia/Calcutta")));
        Assert.Null(FoodCountries.OfZone("UTC"));

        Assert.Equal("SE", FoodCountries.Home("Europe/Stockholm", followsZone: true, picked: "FI"));
        Assert.Equal("FI", FoodCountries.Home("Europe/Stockholm", followsZone: false, picked: "FI"));
        Assert.Equal("NO", FoodCountries.Home("UTC", followsZone: true, picked: ""));
        // A hand pick that is not a country (never saved, but an old row could hold one) follows the zone.
        Assert.Equal("SE", FoodCountries.Home("Europe/Stockholm", followsZone: false, picked: ""));
        Assert.Equal("NO", FoodCountries.Home(null));
        Assert.True(FoodCountries.IsKnown("GB"));
        Assert.False(FoodCountries.IsKnown("gb"));
    }

    [Fact]
    public async Task Your_training_is_saved_on_the_account_and_a_plan_fills_it()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("settings-training");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-11-16", """{"kg":83.6,"timeZone":"UTC"}""");
        var saved = await TestData.PutProfile(client, TestData.Profile());
        Assert.Equal(JsonValueKind.Null, saved.GetProperty("profile").GetProperty("training").ValueKind);

        // Go easy on comes back in the list's order, without repeats.
        var body = await Settings(client, new { training = new { minutes = 45, experience = "new", equipment = new[] { "dumbbells", "kettlebells" }, goEasy = new[] { "knees", "shoulders", "knees" }, warmUp = true } });
        var training = body.GetProperty("training");
        Assert.Equal((45, "new", false, true), (training.GetProperty("minutes").GetInt32(), training.GetProperty("experience").GetString(), training.GetProperty("coolDown").GetBoolean(), training.GetProperty("warmUp").GetBoolean()));
        Assert.Equal(["shoulders", "knees"], training.GetProperty("goEasy").EnumerateArray().Select(item => item.GetString()));
        var state = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal(["dumbbells", "kettlebells"], state.GetProperty("profile").GetProperty("training").GetProperty("equipment").EnumerateArray().Select(item => item.GetString()));

        // Other settings leave it be.
        Assert.Equal(45, (await Settings(client, new { weightUnit = "lb" })).GetProperty("training").GetProperty("minutes").GetInt32());

        foreach (var bad in new object[]
        {
            new { minutes = 47, experience = "new", equipment = new[] { "gym" } },
            new { minutes = 45, experience = "pro", equipment = new[] { "gym" } },
            new { minutes = 45, experience = "new", equipment = Array.Empty<string>() },
            new { minutes = 45, experience = "new", equipment = new[] { "gym" }, goEasy = new[] { "toes" } },
        })
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/profile/settings", new { training = bad })).StatusCode);
        }

        // Making a plan keeps its answers for the next one.
        var plan = await client.PutAsJsonAsync("/api/plan", new { goal = "strength", weekdays = new[] { 0, 3 }, minutes = 75, experience = "experienced", equipment = new[] { "home" }, coolDown = true, timeZone = "UTC" });
        Assert.Equal(HttpStatusCode.Created, plan.StatusCode);
        training = (await client.GetFromJsonAsync<JsonElement>("/api/profile")).GetProperty("profile").GetProperty("training");
        Assert.Equal((75, "experienced", true, false), (training.GetProperty("minutes").GetInt32(), training.GetProperty("experience").GetString(), training.GetProperty("coolDown").GetBoolean(), training.GetProperty("warmUp").GetBoolean()));
        Assert.Equal(["home"], training.GetProperty("equipment").EnumerateArray().Select(item => item.GetString()));
        Assert.Empty(training.GetProperty("goEasy").EnumerateArray());
        Assert.Equal(1, await HistoryCount(user));
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
        Assert.Equal("g", saved.GetProperty("profile").GetProperty("foodUnit").GetString());

        var picked = await client.PutAsJsonAsync("/api/profile/settings", new { weightUnit = "lb", heightUnit = "ftin", foodUnit = "oz" });
        Assert.Equal(HttpStatusCode.OK, picked.StatusCode);
        var body = await picked.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("lb", body.GetProperty("weightUnit").GetString());
        Assert.Equal("ftin", body.GetProperty("heightUnit").GetString());
        Assert.Equal("oz", body.GetProperty("foodUnit").GetString());
        Assert.Equal("UTC", body.GetProperty("timeZone").GetString());

        var state = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal("lb", state.GetProperty("profile").GetProperty("weightUnit").GetString());
        Assert.Equal("ftin", state.GetProperty("profile").GetProperty("heightUnit").GetString());
        Assert.Equal("oz", state.GetProperty("profile").GetProperty("foodUnit").GetString());
        Assert.Equal(180m, state.GetProperty("profile").GetProperty("heightCm").GetDecimal());
        Assert.Equal(1, await HistoryCount(user));

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/profile/settings", new { weightUnit = "stone" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/profile/settings", new { heightUnit = "in" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/profile/settings", new { foodUnit = "lb" })).StatusCode);
        state = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal("lb", state.GetProperty("profile").GetProperty("weightUnit").GetString());
        Assert.Equal("oz", state.GetProperty("profile").GetProperty("foodUnit").GetString());
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

    [Fact]
    public async Task Hidden_cards_follow_the_account_and_stay_null_until_first_saved()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("settings-hidden");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-11-16", """{"kg":83.6,"timeZone":"UTC"}""");
        var saved = await TestData.PutProfile(client, TestData.Profile());
        // Null, not empty: the app adopts what a device already had.
        Assert.Equal(JsonValueKind.Null, saved.GetProperty("profile").GetProperty("homeHidden").ValueKind);
        Assert.Equal(JsonValueKind.Null, saved.GetProperty("profile").GetProperty("macrosHidden").ValueKind);

        var picked = await client.PutAsJsonAsync("/api/profile/settings", new { homeHidden = new[] { "foods", "progress", "foods" }, macrosHidden = Array.Empty<string>() });
        Assert.Equal(HttpStatusCode.OK, picked.StatusCode);
        var body = await picked.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("""["foods","progress"]""", body.GetProperty("homeHidden").GetRawText());
        Assert.Equal("[]", body.GetProperty("macrosHidden").GetRawText());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("progressHidden").ValueKind);

        // Another device reads the same lists; leaving a list out keeps it.
        using var other = factory.AsUser(user);
        await other.PutAsJsonAsync("/api/profile/settings", new { progressHidden = new[] { "sodium" } });
        var state = await other.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal("""["foods","progress"]""", state.GetProperty("profile").GetProperty("homeHidden").GetRawText());
        Assert.Equal("""["sodium"]""", state.GetProperty("profile").GetProperty("progressHidden").GetRawText());
        Assert.Equal(1, await HistoryCount(user));

        foreach (var bad in new object[]
        {
            new { homeHidden = new[] { "has space" } },
            new { homeHidden = new[] { new string('a', 33) } },
            new { macrosHidden = Enumerable.Range(0, 33).Select(i => $"p{i}").ToArray() },
            new { progressHidden = new string?[] { null } },
        })
        {
            var rejected = await client.PutAsJsonAsync("/api/profile/settings", bad);
            Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        }

        state = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal("""["foods","progress"]""", state.GetProperty("profile").GetProperty("homeHidden").GetRawText());
    }

    [Fact]
    public async Task Page_order_follows_the_account_and_stays_null_until_first_saved()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("settings-order");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-11-16", """{"kg":83.6,"timeZone":"UTC"}""");
        var saved = await TestData.PutProfile(client, TestData.Profile());
        Assert.Equal(JsonValueKind.Null, saved.GetProperty("profile").GetProperty("progressOrder").ValueKind);
        Assert.Equal(JsonValueKind.Null, saved.GetProperty("profile").GetProperty("macrosOrder").ValueKind);

        var picked = await client.PutAsJsonAsync("/api/profile/settings", new { progressOrder = new[] { "burn", "weight", "kcal", "burn" } });
        Assert.Equal(HttpStatusCode.OK, picked.StatusCode);
        var body = await picked.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("""["burn","weight","kcal"]""", body.GetProperty("progressOrder").GetRawText());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("macrosOrder").ValueKind);

        // Another device reads it; a hidden-list save leaves the order alone.
        using var other = factory.AsUser(user);
        await other.PutAsJsonAsync("/api/profile/settings", new { macrosOrder = new[] { "fats", "macros" }, progressHidden = new[] { "sodium" } });
        var state = await other.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal("""["burn","weight","kcal"]""", state.GetProperty("profile").GetProperty("progressOrder").GetRawText());
        Assert.Equal("""["fats","macros"]""", state.GetProperty("profile").GetProperty("macrosOrder").GetRawText());
        Assert.Equal(1, await HistoryCount(user));

        var rejected = await client.PutAsJsonAsync("/api/profile/settings", new { progressOrder = new[] { "has space" } });
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        Assert.Contains("page order", await rejected.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Fan_pages_follow_the_account_and_reject_a_bad_layout()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 16, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("settings-fan");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-11-16", """{"kg":83.6,"timeZone":"UTC"}""");
        var saved = await TestData.PutProfile(client, TestData.Profile());
        Assert.Equal(JsonValueKind.Null, saved.GetProperty("profile").GetProperty("fanPages").ValueKind);

        var picked = await client.PutAsJsonAsync("/api/profile/settings", new { fanPages = new[] { "search,scan,weight", "groups" } });
        Assert.Equal(HttpStatusCode.OK, picked.StatusCode);
        Assert.Equal("""["search,scan,weight","groups"]""", (await picked.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("fanPages").GetRawText());

        // Another device reads it, and a card-order save leaves it alone.
        using var other = factory.AsUser(user);
        await other.PutAsJsonAsync("/api/profile/settings", new { progressOrder = new[] { "burn" } });
        var state = await other.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal("""["search,scan,weight","groups"]""", state.GetProperty("profile").GetProperty("fanPages").GetRawText());
        Assert.Equal(1, await HistoryCount(user));

        foreach (var bad in new[]
        {
            new[] { "a", "b", "c", "d", "e" },
            new[] { "a,b,c,d,e,f" },
            new[] { "" },
            new[] { "search", "search" },
            new[] { "has space" },
        })
        {
            var rejected = await client.PutAsJsonAsync("/api/profile/settings", new { fanPages = bad });
            Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
            Assert.Contains("+ fan", await rejected.Content.ReadAsStringAsync());
        }

        // Empty is the default layout.
        var reset = await client.PutAsJsonAsync("/api/profile/settings", new { fanPages = Array.Empty<string>() });
        Assert.Equal("[]", (await reset.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("fanPages").GetRawText());
    }

    [Fact]
    public async Task Keeping_the_goal_hides_goal_reached_everywhere_until_the_goal_changes()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("keep-goal");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-24", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile(goal: "lose", goalWeightKg: 84));
        var before = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.True(before.GetProperty("weight").GetProperty("goalReached").GetBoolean());

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/weight/keep-goal", null)).StatusCode);
        using var other = factory.AsUser(user);
        var kept = await other.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.False(kept.GetProperty("weight").GetProperty("goalReached").GetBoolean());
        Assert.Equal("lose", kept.GetProperty("profile").GetProperty("goal").GetString());

        // A new goal that's also reached brings the card back.
        await TestData.PutProfile(client, TestData.Profile(goal: "lose", goalWeightKg: 83.8m));
        var newGoal = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.True(newGoal.GetProperty("weight").GetProperty("goalReached").GetBoolean());

        // So does the next weigh-in that reaches it.
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/weight/keep-goal", null)).StatusCode);
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 25, 8, 0, 0, TimeSpan.Zero);
        await TestData.PutWeighIn(client, "2026-10-25", """{"kg":83.4,"timeZone":"UTC"}""");
        var nextDay = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.True(nextDay.GetProperty("weight").GetProperty("goalReached").GetBoolean());
    }

    [Fact]
    public async Task Keeping_the_goal_needs_a_profile()
    {
        using var client = factory.AsUser(TestData.NewUser("keep-goal-none"));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/weight/keep-goal", null)).StatusCode);
    }

    private static async Task<JsonElement> Settings(HttpClient client, object body)
    {
        var response = await client.PutAsJsonAsync("/api/profile/settings", body);
        Assert.True(response.StatusCode == HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private async Task<int> HistoryCount(string userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.TargetHistories.CountAsync(row => row.UserId == userId);
    }
}
