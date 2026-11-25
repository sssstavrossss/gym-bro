using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Endpoints;
using GymBro.Api.Logging;
using GymBro.Api.Training;

namespace GymBro.Api.Tests;

public sealed class WorkoutRulesTests
{
    private static readonly DateOnly Today = new(2026, 11, 25);

    private static WorkoutRequest Request(params WorkoutSetRequest[] sets) => new() { Date = Today, Sets = [.. sets] };

    private static (WorkoutDraft? Draft, string? Error) Check(WorkoutRequest request) =>
        WorkoutRules.Check(request, ExerciseCatalog.Current, Today, Today);

    [Fact]
    public void A_bare_workout_is_a_done_strength_workout()
    {
        var (draft, error) = Check(new WorkoutRequest { Date = Today, Name = "  ", Notes = " Felt good " });
        Assert.Null(error);
        Assert.Equal(WorkoutKinds.Strength, draft!.Kind);
        Assert.Equal(WorkoutStatuses.Done, draft.Status);
        Assert.Null(draft.Name);
        Assert.Equal("Felt good", draft.Notes);
        Assert.Empty(draft.Sets);
    }

    [Fact]
    public void Sets_default_to_working_and_round_their_numbers()
    {
        var (draft, error) = Check(Request(new WorkoutSetRequest { ExerciseId = "barbell-squat", Kg = 82.555m, Reps = 8, Rir = 2, Metres = 10.06m }));
        Assert.Null(error);
        var set = Assert.Single(draft!.Sets);
        Assert.Equal(SetTypes.Working, set.Type);
        Assert.Equal(82.56m, set.Kg);
        Assert.Equal(10.1m, set.Metres);
    }

    [Fact]
    public void Dates_stop_at_the_persons_today()
    {
        Assert.Equal(WorkoutRules.NeedsDate, Check(new WorkoutRequest()).Error);
        Assert.Equal(LogEntryRules.FutureDate, Check(new WorkoutRequest { Date = Today.AddDays(1) }).Error);
        Assert.Equal(WorkoutRules.TooEarly, Check(new WorkoutRequest { Date = new DateOnly(1999, 12, 31) }).Error);
        // Before setup is fine: training history isn't tied to the nutrition target.
        Assert.Null(Check(new WorkoutRequest { Date = Today.AddYears(-3) }).Error);
    }

    [Theory]
    [InlineData("no-such-lift", null, 0, 8, 2)]
    [InlineData("barbell-squat", "cooldown", 0, 8, 2)]
    [InlineData("barbell-squat", null, 100, 8, 2)]
    [InlineData("barbell-squat", null, 0, -1, 2)]
    [InlineData("barbell-squat", null, 0, 8, 11)]
    public void Bad_sets_are_refused(string exercise, string? type, int block, int reps, int rir)
    {
        var (draft, error) = Check(Request(new WorkoutSetRequest { ExerciseId = exercise, Type = type, Block = block, Reps = reps, Rir = rir }));
        Assert.Null(draft);
        Assert.NotNull(error);
    }

    [Fact]
    public void Workouts_are_checked_as_a_whole()
    {
        Assert.Equal(WorkoutRules.UnknownKind, Check(new WorkoutRequest { Date = Today, Kind = "dance" }).Error);
        Assert.Equal(WorkoutRules.UnknownStatus, Check(new WorkoutRequest { Date = Today, Status = "active" }).Error);
        Assert.Equal(WorkoutRules.NameTooLong, Check(new WorkoutRequest { Date = Today, Name = new string('a', 81) }).Error);
        var start = new DateTimeOffset(2026, 11, 25, 17, 0, 0, TimeSpan.Zero);
        Assert.Equal(WorkoutRules.EndsBeforeStart, Check(new WorkoutRequest { Date = Today, StartedAt = start, EndedAt = start.AddMinutes(-1) }).Error);
        Assert.Equal(WorkoutRules.TooLong, Check(new WorkoutRequest { Date = Today, StartedAt = start, EndedAt = start.AddHours(25) }).Error);
        var many = Enumerable.Range(0, WorkoutRules.MaxSets + 1).Select(_ => new WorkoutSetRequest { ExerciseId = "barbell-squat" }).ToArray();
        Assert.Equal(WorkoutRules.TooManySets, Check(Request(many)).Error);
    }

    [Fact]
    public void Volume_counts_done_sets_that_are_not_warm_ups()
    {
        var done = DateTimeOffset.UtcNow;
        WorkoutSet[] sets =
        [
            new() { Type = SetTypes.Warmup, Kg = 40, Reps = 10, DoneAt = done },
            new() { Type = SetTypes.Working, Kg = 80, Reps = 8, DoneAt = done },
            new() { Type = SetTypes.Drop, Kg = 60, Reps = 10, DoneAt = done },
            new() { Type = SetTypes.Working, Kg = 80, Reps = 8 },
            new() { Type = SetTypes.Working, Reps = 12, DoneAt = done },
        ];
        Assert.Equal(1240m, WorkoutRules.Volume(sets));
        Assert.Equal(3, sets.Count(WorkoutRules.Counts));
    }
}

[Collection(ApiCollection.Name)]
public sealed class WorkoutEndpointTests(ApiFactory factory)
{
    // The clock is shared by the collection, so each test sets it.
    private readonly DateOnly Today = Start(factory);

    private static DateOnly Start(ApiFactory factory)
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 25, 12, 0, 0, TimeSpan.Zero);
        return new DateOnly(2026, 11, 25);
    }

    private object Workout(DateOnly date, string? name, params object[] sets) => new { date, timeZone = "UTC", name, sets };

    private static object Set(string exercise, decimal? kg, int? reps, string type = "working", bool done = true, int block = 0) =>
        new { exerciseId = exercise, block, type, kg, reps, rir = 2, doneAt = done ? DateTimeOffset.UtcNow : (DateTimeOffset?)null };

    [Fact]
    public async Task A_workout_is_saved_by_the_apps_id_and_replaced_when_sent_again()
    {
        var client = factory.AsUser(TestData.NewUser("workout-put"));
        var id = Guid.NewGuid();
        var first = await client.PutAsJsonAsync($"/api/workouts/{id}", Workout(Today, "Legs", Set("barbell-squat", 80, 8), Set("barbell-squat", 80, 7)));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var again = await client.PutAsJsonAsync($"/api/workouts/{id}", Workout(Today, "Legs", Set("barbell-squat", 85, 6, "warmup"), Set("barbell-squat", 85, 6), Set("romanian-deadlift", 60, 10, block: 1)));
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);

        using var json = JsonDocument.Parse(await client.GetStringAsync($"/api/workouts/{id}"));
        var root = json.RootElement;
        Assert.Equal("Legs", root.GetProperty("name").GetString());
        Assert.Equal("strength", root.GetProperty("kind").GetString());
        Assert.Equal("done", root.GetProperty("status").GetString());
        var sets = root.GetProperty("sets");
        Assert.Equal(3, sets.GetArrayLength());
        Assert.Equal("warmup", sets[0].GetProperty("type").GetString());
        Assert.Equal("romanian-deadlift", sets[2].GetProperty("exerciseId").GetString());
        Assert.Equal(1, sets[2].GetProperty("block").GetInt32());
        Assert.Equal(85m, sets[1].GetProperty("kg").GetDecimal());
    }

    [Fact]
    public async Task Someone_elses_workout_cant_be_read_replaced_or_deleted()
    {
        var owner = factory.AsUser(TestData.NewUser("workout-owner"));
        var other = factory.AsUser(TestData.NewUser("workout-other"));
        var id = Guid.NewGuid();
        Assert.Equal(HttpStatusCode.Created, (await owner.PutAsJsonAsync($"/api/workouts/{id}", Workout(Today, "Mine", Set("barbell-squat", 80, 8)))).StatusCode);

        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/workouts/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync($"/api/workouts/{id}", Workout(Today, "Theirs"))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await other.DeleteAsync($"/api/workouts/{id}")).StatusCode);

        using var json = JsonDocument.Parse(await owner.GetStringAsync($"/api/workouts/{id}"));
        Assert.Equal("Mine", json.RootElement.GetProperty("name").GetString());
        Assert.Equal(1, json.RootElement.GetProperty("sets").GetArrayLength());
    }

    [Fact]
    public async Task Bad_workouts_are_refused_with_a_reason()
    {
        var client = factory.AsUser(TestData.NewUser("workout-bad"));
        var future = await client.PutAsJsonAsync($"/api/workouts/{Guid.NewGuid()}", Workout(Today.AddDays(3), null));
        Assert.Equal(HttpStatusCode.BadRequest, future.StatusCode);
        Assert.Contains(LogEntryRules.FutureDate, await future.Content.ReadAsStringAsync());

        var unknown = await client.PutAsJsonAsync($"/api/workouts/{Guid.NewGuid()}", Workout(Today, null, Set("no-such-lift", 10, 10)));
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Contains("no-such-lift", await unknown.Content.ReadAsStringAsync());

        var zone = await client.PutAsJsonAsync($"/api/workouts/{Guid.NewGuid()}", new { date = Today, timeZone = "Nowhere/Else" });
        Assert.Equal(HttpStatusCode.BadRequest, zone.StatusCode);
    }

    [Fact]
    public async Task The_list_is_newest_first_with_totals()
    {
        var client = factory.AsUser(TestData.NewUser("workout-list"));
        var older = Guid.NewGuid();
        var newer = Guid.NewGuid();
        await client.PutAsJsonAsync($"/api/workouts/{older}", Workout(Today.AddDays(-2), "Push", Set("barbell-bench-press-medium-grip", 60, 10, "warmup"), Set("barbell-bench-press-medium-grip", 80, 8), Set("barbell-bench-press-medium-grip", 80, 8, done: false)));
        await client.PutAsJsonAsync($"/api/workouts/{newer}", Workout(Today, null, Set("pullups", null, 10), Set("barbell-squat", 100, 5, block: 1)));
        await client.PutAsJsonAsync($"/api/workouts/{Guid.NewGuid()}", Workout(Today.AddDays(-40), "Too old"));

        using var json = JsonDocument.Parse(await client.GetStringAsync($"/api/workouts?from={Today.AddDays(-7):yyyy-MM-dd}&to={Today:yyyy-MM-dd}"));
        var list = json.RootElement.GetProperty("workouts");
        Assert.Equal(2, list.GetArrayLength());
        Assert.Equal(newer, list[0].GetProperty("id").GetGuid());
        Assert.Equal(["pullups", "barbell-squat"], list[0].GetProperty("exercises").EnumerateArray().Select(item => item.GetString()!).ToArray());
        Assert.Equal(2, list[0].GetProperty("sets").GetInt32());
        Assert.Equal(500m, list[0].GetProperty("volumeKg").GetDecimal());
        Assert.Equal(1, list[1].GetProperty("sets").GetInt32());
        Assert.Equal(640m, list[1].GetProperty("volumeKg").GetDecimal());

        var wide = await client.GetAsync($"/api/workouts?from={Today.AddDays(-400):yyyy-MM-dd}&to={Today:yyyy-MM-dd}");
        Assert.Equal(HttpStatusCode.BadRequest, wide.StatusCode);
    }

    [Fact]
    public async Task Previous_gives_each_exercises_sets_from_the_last_workout_that_had_it()
    {
        var client = factory.AsUser(TestData.NewUser("workout-previous"));
        var monday = Guid.NewGuid();
        var wednesday = Guid.NewGuid();
        await client.PutAsJsonAsync($"/api/workouts/{monday}", Workout(Today.AddDays(-2), null, Set("barbell-squat", 80, 8), Set("barbell-squat", 80, 8)));
        await client.PutAsJsonAsync($"/api/workouts/{wednesday}", Workout(Today, null, Set("barbell-squat", 85, 6)));
        await client.PutAsJsonAsync($"/api/workouts/{Guid.NewGuid()}", new { date = Today, timeZone = "UTC", status = "skipped", sets = new[] { Set("pullups", null, 12) } });

        using var json = JsonDocument.Parse(await client.GetStringAsync($"/api/workouts/previous?exercise=barbell-squat&exercise=pullups&except={wednesday}"));
        var found = json.RootElement.GetProperty("exercises");
        var squat = found.GetProperty("barbell-squat");
        Assert.Equal(monday, squat.GetProperty("workoutId").GetGuid());
        Assert.Equal(2, squat.GetProperty("sets").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, squat.GetProperty("earlier").ValueKind);
        Assert.False(found.TryGetProperty("pullups", out _));

        // The latest, and the one before it for load suggestions.
        using var latest = JsonDocument.Parse(await client.GetStringAsync("/api/workouts/previous?exercise=barbell-squat"));
        var both = latest.RootElement.GetProperty("exercises").GetProperty("barbell-squat");
        Assert.Equal(wednesday, both.GetProperty("workoutId").GetGuid());
        Assert.Equal(1, both.GetProperty("sets").GetArrayLength());
        Assert.Equal(monday, both.GetProperty("earlier").GetProperty("workoutId").GetGuid());
        Assert.Equal(Today.AddDays(-2), DateOnly.Parse(both.GetProperty("earlier").GetProperty("date").GetString()!));
        Assert.Equal(2, both.GetProperty("earlier").GetProperty("sets").GetArrayLength());
    }

    [Fact]
    public async Task Delete_removes_the_workout_and_its_sets_and_can_be_sent_twice()
    {
        var client = factory.AsUser(TestData.NewUser("workout-delete"));
        var id = Guid.NewGuid();
        await client.PutAsJsonAsync($"/api/workouts/{id}", Workout(Today, null, Set("barbell-squat", 80, 8)));
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/workouts/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/workouts/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/workouts/{id}")).StatusCode);

        using var json = JsonDocument.Parse(await client.GetStringAsync("/api/workouts/previous?exercise=barbell-squat"));
        Assert.False(json.RootElement.GetProperty("exercises").TryGetProperty("barbell-squat", out _));
    }
}
