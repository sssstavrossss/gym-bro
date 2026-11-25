using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Training;

namespace GymBro.Api.Tests;

/// <summary>The embedded exercise library: free-exercise-db at its pinned commit, plus Gym Bro's own exercises.</summary>
public sealed class ExerciseCatalogTests
{
    [Fact]
    public void Holds_every_source_exercise_and_ours_under_unique_ids()
    {
        var library = ExerciseCatalog.Current;
        Assert.Equal(884, library.All.Count);
        Assert.Equal(876, library.All.Count(item => item.Source == ExerciseCatalog.FreeExerciseDb));
        Assert.Equal(library.All.Count, library.All.Select(item => item.Id).Distinct().Count());
        Assert.All(library.All, item =>
        {
            Assert.Matches("^[a-z0-9]+(-[a-z0-9]+)*$", item.Id);
            Assert.Contains(item.Measure, ExerciseMeasure.All);
            Assert.NotEmpty(item.PrimaryMuscles);
        });
        // Five source exercises come without steps; every one of ours has them.
        Assert.Equal(5, library.All.Count(item => item.Instructions.Count == 0));
        Assert.All(library.All.Where(item => item.Source == ExerciseCatalog.GymBro), item => Assert.NotEmpty(item.Instructions));
        Assert.Equal(16, library.Version.Length);
    }

    [Theory]
    [InlineData("barbell-squat", ExerciseMeasure.WeightReps, "barbell")]
    [InlineData("pushups", ExerciseMeasure.Reps, "bodyweight")]
    [InlineData("plank", ExerciseMeasure.Time, "bodyweight")]
    [InlineData("rowing-stationary", ExerciseMeasure.DistanceTime, "machine")]
    [InlineData("farmers-walk", ExerciseMeasure.WeightDistance, "other")]
    [InlineData("sled-push", ExerciseMeasure.WeightDistance, "other")]
    [InlineData("rickshaw-deadlift", ExerciseMeasure.WeightReps, "other")]
    [InlineData("one-arm-kettlebell-swings", ExerciseMeasure.WeightReps, "kettlebell")]
    public void Derives_what_a_set_records_from_the_source(string id, string measure, string equipment)
    {
        var item = ExerciseCatalog.Current.Find(id);
        Assert.NotNull(item);
        Assert.Equal(measure, item.Measure);
        Assert.Equal(equipment, item.Equipment);
        Assert.Equal(ExerciseCatalog.FreeExerciseDb, item.Source);
        Assert.True(item.Images > 0);
    }

    [Theory]
    [InlineData("skierg", ExerciseMeasure.DistanceTime)]
    [InlineData("sled-pull", ExerciseMeasure.WeightDistance)]
    [InlineData("wall-ball", ExerciseMeasure.WeightReps)]
    [InlineData("burpee-broad-jump", ExerciseMeasure.DistanceTime)]
    [InlineData("sandbag-lunge", ExerciseMeasure.WeightDistance)]
    [InlineData("run", ExerciseMeasure.DistanceTime)]
    [InlineData("fan-bike", ExerciseMeasure.DistanceTime)]
    [InlineData("kettlebell-swing", ExerciseMeasure.WeightReps)]
    public void Adds_our_own_stations(string id, string measure)
    {
        var item = ExerciseCatalog.Current.Find(id);
        Assert.NotNull(item);
        Assert.Equal(measure, item.Measure);
        Assert.Equal(ExerciseCatalog.GymBro, item.Source);
        Assert.Equal(0, item.Images);
    }

    [Fact]
    public void Names_equipment_and_muscles_in_one_form()
    {
        Assert.Equal("none", ExerciseCatalog.Equipment(null));
        Assert.Equal("ez-bar", ExerciseCatalog.Equipment("e-z curl bar"));
        Assert.Equal("medicine-ball", ExerciseCatalog.Equipment("medicine ball"));
        Assert.Equal("3-4-sit-up", ExerciseCatalog.IdFrom("3_4_Sit-Up"));
        Assert.Contains("lower-back", ExerciseCatalog.Current.Find("kettlebell-swing")!.SecondaryMuscles);
        var equipment = ExerciseCatalog.Current.All.Select(item => item.Equipment).ToHashSet();
        Assert.DoesNotContain("body only", equipment);
        Assert.DoesNotContain("kettlebells", equipment);
    }
}

[Collection(ApiCollection.Name)]
public sealed class ExerciseEndpointTests(ApiFactory factory)
{
    [Fact]
    public async Task Lists_the_library_without_steps_and_answers_304_while_it_is_unchanged()
    {
        using var client = factory.AsUser(TestData.NewUser("exercise-list"));

        using var first = await client.GetAsync("/api/exercises");
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var etag = first.Headers.ETag;
        Assert.NotNull(etag);
        var body = await first.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal($"\"{body.GetProperty("version").GetString()}\"", etag.Tag);
        var exercises = body.GetProperty("exercises");
        Assert.Equal(884, exercises.GetArrayLength());
        var squat = exercises.EnumerateArray().Single(item => item.GetProperty("id").GetString() == "barbell-squat");
        Assert.Equal("weight_reps", squat.GetProperty("measure").GetString());
        Assert.False(squat.TryGetProperty("instructions", out _));

        using var again = new HttpRequestMessage(HttpMethod.Get, "/api/exercises");
        again.Headers.IfNoneMatch.Add(new EntityTagHeaderValue(etag.Tag));
        using var cached = await client.SendAsync(again);
        Assert.Equal(HttpStatusCode.NotModified, cached.StatusCode);
    }

    [Fact]
    public async Task Shows_one_exercise_with_its_steps_and_source()
    {
        using var client = factory.AsUser(TestData.NewUser("exercise-detail"));

        var squat = await client.GetFromJsonAsync<JsonElement>("/api/exercises/barbell-squat");
        Assert.Equal("Barbell Squat", squat.GetProperty("name").GetString());
        Assert.True(squat.GetProperty("instructions").GetArrayLength() > 0);
        Assert.Equal("free-exercise-db", squat.GetProperty("source").GetString());

        var station = await client.GetFromJsonAsync<JsonElement>("/api/exercises/skierg");
        Assert.Equal("gym-bro", station.GetProperty("source").GetString());

        using var missing = await client.GetAsync("/api/exercises/no-such-lift");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }
}
