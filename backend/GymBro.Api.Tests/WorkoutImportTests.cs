using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Training;

namespace GymBro.Api.Tests;

public sealed class ExerciseMatcherTests
{
    [Fact]
    public void Every_hand_made_name_points_at_an_exercise_in_the_library()
    {
        Assert.NotEmpty(ExerciseMatcher.Aliases);
        foreach (var (name, id) in ExerciseMatcher.Aliases)
        {
            Assert.True(ExerciseCatalog.Current.Find(id) is not null, $"{name} → {id}");
        }
    }

    [Theory]
    [InlineData("Bench Press (Barbell)", "barbell-bench-press-medium-grip")]
    [InlineData("Squat (Barbell)", "barbell-squat")]
    [InlineData("Lat Pulldown (Cable)", "wide-grip-lat-pulldown")]
    [InlineData("Pull Up", "pullups")]
    [InlineData("pull-up", "pullups")]
    [InlineData("Triceps Pushdown (Cable - Straight Bar)", "triceps-pushdown")]
    [InlineData("Running", "run")]
    // The library's own names, as written.
    [InlineData("Wide-Grip Lat Pulldown", "wide-grip-lat-pulldown")]
    [InlineData("arnold dumbbell press", "arnold-dumbbell-press")]
    // Equipment moved to the front, or left off.
    [InlineData("Curl (Barbell)", "barbell-curl")]
    [InlineData("Leg Extensions (Machine)", "leg-extensions")]
    [InlineData("Seated Cable Row", "seated-cable-rows")]
    public void Names_from_Strong_and_Hevy_find_their_exercise(string name, string id)
    {
        Assert.Equal(id, ExerciseMatcher.Match(name));
    }

    [Theory]
    [InlineData("Zercher Carry Into Handstand")]
    [InlineData("")]
    [InlineData(null)]
    public void A_name_that_is_not_clear_is_left_to_pick(string? name)
    {
        Assert.Null(ExerciseMatcher.Match(name));
    }

    [Fact]
    public void An_imported_workout_has_the_same_id_each_time_and_its_own_per_account()
    {
        var first = WorkoutImport.IdFor("a", "strong", "2024-01-15 18:30|Push");
        Assert.Equal(first, WorkoutImport.IdFor("a", "strong", "2024-01-15 18:30|Push"));
        Assert.NotEqual(first, WorkoutImport.IdFor("b", "strong", "2024-01-15 18:30|Push"));
        Assert.NotEqual(first, WorkoutImport.IdFor("a", "hevy", "2024-01-15 18:30|Push"));
        Assert.Equal(5, first.Version);
    }
}

[Collection(ApiCollection.Name)]
public sealed class WorkoutImportEndpointTests(ApiFactory factory)
{
    private readonly DateOnly Today = Start(factory);

    private static DateOnly Start(ApiFactory factory)
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 25, 12, 0, 0, TimeSpan.Zero);
        return new DateOnly(2026, 11, 25);
    }

    private static object Item(string key, DateOnly date, string name, params object[] sets)
    {
        var start = new DateTimeOffset(date.ToDateTime(new TimeOnly(18, 0)), TimeSpan.Zero);
        return new { key, workout = new { date, name, startedAt = start, endedAt = start.AddMinutes(50), sets } };
    }

    private static object Set(string exercise, decimal? kg, int? reps, string type = "working") =>
        new { exerciseId = exercise, type, kg, reps, doneAt = new DateTimeOffset(2024, 1, 15, 19, 0, 0, TimeSpan.Zero) };

    [Fact]
    public async Task Imported_workouts_are_saved_once_and_count_as_done()
    {
        var client = factory.AsUser(TestData.NewUser("workout-import"));
        var day = Today.AddYears(-1);
        var body = new
        {
            source = "strong",
            timeZone = "UTC",
            workouts = new[]
            {
                Item("2025-11-25 18:00|Legs", day, "Legs", Set("barbell-squat", 60, 10, "warmup"), Set("barbell-squat", 100, 5)),
                Item("2025-11-27 18:00|Push", day.AddDays(2), "Push", Set("barbell-bench-press-medium-grip", 80, 8)),
            },
        };

        var first = await client.PostAsJsonAsync("/api/workouts/import", body);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var counts = await first.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, counts.GetProperty("added").GetInt32());
        Assert.Equal(0, counts.GetProperty("skipped").GetInt32());

        // The same file again adds nothing.
        var again = await (await client.PostAsJsonAsync("/api/workouts/import", body)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, again.GetProperty("added").GetInt32());
        Assert.Equal(2, again.GetProperty("skipped").GetInt32());

        var list = await client.GetFromJsonAsync<JsonElement>($"/api/workouts?from={day:yyyy-MM-dd}&to={day.AddDays(2):yyyy-MM-dd}");
        var workouts = list.GetProperty("workouts").EnumerateArray().ToList();
        Assert.Equal(["Push", "Legs"], workouts.Select(item => item.GetProperty("name").GetString()));
        Assert.All(workouts, item => Assert.Equal("done", item.GetProperty("status").GetString()));
        // Warm-ups don't count; the working set does.
        Assert.Equal(500m, workouts[1].GetProperty("volumeKg").GetDecimal());

        // The sets count toward the next squat's last time and best.
        var previous = await client.GetFromJsonAsync<JsonElement>("/api/workouts/previous?exercise=barbell-squat");
        Assert.Contains("barbell-squat", previous.GetRawText());

        // Someone else importing the same file gets their own copies.
        var other = factory.AsUser(TestData.NewUser("workout-import-other"));
        var theirs = await (await other.PostAsJsonAsync("/api/workouts/import", body)).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, theirs.GetProperty("added").GetInt32());
    }

    [Fact]
    public async Task A_bad_workout_stops_the_batch_and_says_which()
    {
        var client = factory.AsUser(TestData.NewUser("workout-import-bad"));
        var day = Today.AddDays(-3);
        var bad = await client.PostAsJsonAsync("/api/workouts/import", new
        {
            source = "hevy",
            timeZone = "UTC",
            workouts = new[] { Item("a", day, "Fine", Set("barbell-squat", 100, 5)), Item("b", day, "Odd", Set("no-such-lift", 10, 10)) },
        });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Contains($"The workout {day:yyyy-MM-dd}: ", await bad.Content.ReadAsStringAsync());
        var none = await client.GetFromJsonAsync<JsonElement>($"/api/workouts?from={day:yyyy-MM-dd}&to={day:yyyy-MM-dd}");
        Assert.Empty(none.GetProperty("workouts").EnumerateArray());

        var source = await client.PostAsJsonAsync("/api/workouts/import", new { source = "fitbod", timeZone = "UTC", workouts = new[] { Item("a", day, "Fine") } });
        Assert.Contains(WorkoutImport.UnknownSource, await source.Content.ReadAsStringAsync());
        var key = await client.PostAsJsonAsync("/api/workouts/import", new { source = "strong", timeZone = "UTC", workouts = new[] { Item(" ", day, "Fine") } });
        Assert.Contains(WorkoutImport.NeedsKey, await key.Content.ReadAsStringAsync());
        var many = Enumerable.Range(0, WorkoutImport.MaxWorkouts + 1).Select(index => Item($"k{index}", day, "Fine")).ToArray();
        var tooMany = await client.PostAsJsonAsync("/api/workouts/import", new { source = "strong", timeZone = "UTC", workouts = many });
        Assert.Contains(WorkoutImport.TooMany, await tooMany.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Names_are_matched_for_the_phone()
    {
        var client = factory.AsUser(TestData.NewUser("exercise-match"));
        var response = await client.PostAsJsonAsync("/api/exercises/match", new { names = new[] { "Bench Press (Barbell)", "Mystery Move" } });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var matches = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("matches").EnumerateArray().ToList();
        Assert.Equal("barbell-bench-press-medium-grip", matches[0].GetProperty("exerciseId").GetString());
        Assert.Equal(JsonValueKind.Null, matches[1].GetProperty("exerciseId").ValueKind);
    }
}
