using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Describe;
using GymBro.Api.Endpoints;
using GymBro.Api.Training;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class WorkoutDescribeTests(ApiFactory factory)
{
    private static ExerciseLibrary Library => ExerciseCatalog.Current;

    [Fact]
    public async Task A_described_workout_comes_back_as_library_exercises_with_their_sets_and_counts_toward_describes_limit()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 26, 12, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("workout-describe");
        using var client = factory.AsUser(user);

        var response = await client.PostAsJsonAsync("/api/workouts/describe", new
        {
            text = "bench 3x8 60 kg, + pullups 3x10, run 5 km 25:30, plank 60 s, juggling",
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var exercises = body.GetProperty("exercises").EnumerateArray().ToList();
        Assert.Equal(["barbell-bench-press-medium-grip", "pullups", "run", "plank"], exercises.Select(item => item.GetProperty("exerciseId").GetString()));

        var bench = exercises[0].GetProperty("sets").EnumerateArray().ToList();
        Assert.Equal(3, bench.Count);
        Assert.All(bench, set =>
        {
            Assert.Equal(60m, set.GetProperty("kg").GetDecimal());
            Assert.Equal(8, set.GetProperty("reps").GetInt32());
            Assert.Equal(JsonValueKind.Null, set.GetProperty("seconds").ValueKind);
        });
        Assert.False(exercises[0].GetProperty("superset").GetBoolean());

        // Pull-ups are bodyweight: reps only, no weight made up. Done as a superset with the bench.
        Assert.True(exercises[1].GetProperty("superset").GetBoolean());
        var pullups = exercises[1].GetProperty("sets").EnumerateArray().ToList();
        Assert.Equal(3, pullups.Count);
        Assert.Equal(JsonValueKind.Null, pullups[0].GetProperty("kg").ValueKind);
        Assert.Equal(10, pullups[0].GetProperty("reps").GetInt32());

        var run = exercises[2].GetProperty("sets").EnumerateArray().Single();
        Assert.Equal(5000m, run.GetProperty("metres").GetDecimal());
        Assert.Equal(1530, run.GetProperty("seconds").GetInt32());

        Assert.Equal(60, exercises[3].GetProperty("sets").EnumerateArray().Single().GetProperty("seconds").GetInt32());
        Assert.Equal(["juggling"], body.GetProperty("unmatched").EnumerateArray().Select(item => item.GetString()));
        Assert.Equal(19, body.GetProperty("left").GetInt32());

        // Nothing was logged, and the description isn't a recent meal.
        var overview = await client.GetFromJsonAsync<JsonElement>("/api/describe");
        Assert.Equal(19, overview.GetProperty("left").GetInt32());
        Assert.Empty(overview.GetProperty("recent").EnumerateArray());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.WorkoutSessions.AnyAsync(row => row.UserId == user));
        var row = await db.MealDescriptions.SingleAsync(row => row.UserId == user);
        Assert.Equal(MealKinds.Workout, row.Kind);
        Assert.Equal(MealOutcomes.Found, row.Outcome);
        Assert.Equal(4, row.FoodCount);
        Assert.Contains("pullups", row.Items);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/describe/{row.Id}")).StatusCode);
    }

    [Theory]
    [InlineData("juggling and knitting", HttpStatusCode.UnprocessableEntity, "nothing")]
    [InlineData("decline this", HttpStatusCode.UnprocessableEntity, "declined")]
    [InlineData("fail this", HttpStatusCode.ServiceUnavailable, "failed")]
    public async Task Nothing_found_or_a_failing_model_says_so_and_keeps_the_attempt(string text, HttpStatusCode expected, string outcome)
    {
        var user = TestData.NewUser("workout-" + outcome);
        using var client = factory.AsUser(user);
        var response = await client.PostAsJsonAsync("/api/workouts/describe", new { text });
        Assert.Equal(expected, response.StatusCode);
        Assert.Contains(outcome == "failed" ? WorkoutDescribeEndpoints.ModelDown : WorkoutDescribeEndpoints.NothingFound, await response.Content.ReadAsStringAsync());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = await db.MealDescriptions.SingleAsync(row => row.UserId == user);
        Assert.Equal(MealKinds.Workout, row.Kind);
        Assert.Equal(outcome, row.Outcome);
    }

    [Fact]
    public async Task Words_are_needed_within_the_limit_and_the_daily_limit_is_shared()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 26, 12, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("workout-limit");
        using var client = factory.AsUser(user);
        var empty = await client.PostAsJsonAsync("/api/workouts/describe", new { text = "  " });
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.Contains(WorkoutDescribeEndpoints.TextMissing, await empty.Content.ReadAsStringAsync());
        var long_ = await client.PostAsJsonAsync("/api/workouts/describe", new { text = new string('a', 501) });
        Assert.Equal(HttpStatusCode.BadRequest, long_.StatusCode);

        await client.GetAsync("/api/me");
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            for (var i = 0; i < 20; i++)
            {
                db.MealDescriptions.Add(new MealDescription
                {
                    Id = Guid.NewGuid(), UserId = user, Kind = MealKinds.Label, CreatedAt = factory.Clock.GetUtcNow().AddHours(-1),
                    Outcome = MealOutcomes.Found, Model = "rule",
                });
            }

            await db.SaveChangesAsync();
        }

        var limited = await client.PostAsJsonAsync("/api/workouts/describe", new { text = "squat 3x5 100 kg" });
        Assert.Equal((HttpStatusCode)429, limited.StatusCode);
        Assert.Contains(WorkoutDescribeEndpoints.DailyLimitReached, await limited.Content.ReadAsStringAsync());
    }

    [Fact]
    public void Resolve_keeps_what_each_exercise_measures_merges_repeats_and_names_unknown_ids()
    {
        var (exercises, unmatched) = WorkoutDescriber.Resolve(
        [
            // Pull-ups measure reps: the weight and the time go.
            new WorkoutPart("pull-ups", "pullups", true, [new(20, 8, 30, null)]),
            new WorkoutPart("made up", "not-an-id", false, [new(10, 5, null, null)]),
            new WorkoutPart("", null, false, []),
            // A plank measures time; a set with nothing it measures goes, and none left is one empty set.
            new WorkoutPart("plank", "plank", false, [new(null, 10, null, null)]),
            // Out of range values go.
            new WorkoutPart("squat", "barbell-squat", false, [new(5000, 5, null, null), new(100.004m, 5, null, null)]),
            new WorkoutPart("pull-ups again", "pullups", false, [new(null, 6, null, null)]),
        ], Library);

        Assert.Equal(["pullups", "plank", "barbell-squat"], exercises.Select(item => item.ExerciseId));
        Assert.False(exercises[0].Superset);
        Assert.Equal([new WorkoutPartSet(null, 8, null, null), new WorkoutPartSet(null, 6, null, null)], exercises[0].Sets);
        Assert.Equal([new WorkoutPartSet(null, null, null, null)], exercises[1].Sets);
        Assert.Equal([new WorkoutPartSet(null, 5, null, null), new WorkoutPartSet(100m, 5, null, null)], exercises[2].Sets);
        Assert.Equal(["made up"], unmatched);
    }

    [Fact]
    public void Claude_reply_is_read_with_nulls_for_what_the_words_lack()
    {
        using var document = JsonDocument.Parse("""
            { "exercises": [
              { "name": "bench", "exerciseId": "barbell-bench-press-medium-grip", "superset": false,
                "sets": [ { "kg": 61.234, "reps": 8, "seconds": null, "metres": null } ] },
              { "name": "yoga", "exerciseId": "", "superset": false, "sets": [] } ] }
            """);
        var parts = ClaudeWorkoutModel.Read(document.RootElement);
        Assert.Equal(61.23m, parts[0].Sets[0].Kg);
        Assert.Null(parts[0].Sets[0].Seconds);
        var (exercises, unmatched) = WorkoutDescriber.Resolve(parts, Library);
        Assert.Single(exercises);
        Assert.Equal(["yoga"], unmatched);
    }
}
