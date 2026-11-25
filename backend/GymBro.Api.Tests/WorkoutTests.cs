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

    [Theory]
    [InlineData("cardio", "run", "swim")]
    [InlineData("hybrid", "run", "barbell-squat")]
    [InlineData("strength", "barbell-squat", "pullups")]
    [InlineData("mobility", "90-90-hamstring", "adductor")]
    public void A_workout_sent_without_a_kind_takes_it_from_its_exercises(string kind, string first, string? second)
    {
        var sets = new[] { first, second }.OfType<string>().Select(id => new WorkoutSetRequest { ExerciseId = id }).ToArray();
        var (draft, error) = Check(Request(sets));
        Assert.Null(error);
        Assert.Equal(kind, draft!.Kind);
        // A kind that is sent is kept.
        Assert.Equal(WorkoutKinds.Sport, Check(new WorkoutRequest { Date = Today, Kind = "sport", Sets = [.. sets] }).Draft!.Kind);
    }

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
    public void Timed_blocks_name_a_block_of_the_sets_and_carry_only_their_formats_fields()
    {
        WorkoutRequest Timed(params TimedBlockRequest[] blocks) => new()
        {
            Date = Today,
            Sets = [new() { ExerciseId = "pullups", Block = 0, Reps = 5 }, new() { ExerciseId = "pushups", Block = 0, Reps = 10 }, new() { ExerciseId = "barbell-squat", Block = 1, Reps = 5 }],
            Blocks = [.. blocks],
        };

        var (draft, error) = Check(Timed(
            new TimedBlockRequest { Block = 0, Format = "amrap", Minutes = 12, Rounds = 5, Reps = 3 },
            new TimedBlockRequest { Block = 1, Format = "emom", Minutes = 10 }));
        Assert.Null(error);
        Assert.Equal([new TimedBlock(0, "amrap", 12, null, 5, 3, null), new TimedBlock(1, "emom", 10, 1, null, null, null)], draft!.Blocks);
        Assert.Equal(new TimedBlock(1, "for_time", null, null, null, null, 512), Check(Timed(new TimedBlockRequest { Block = 1, Format = "for_time", Seconds = 512 })).Draft!.Blocks.Single());
        Assert.Empty(Check(Timed()).Draft!.Blocks);

        Assert.Equal(TimedBlocks.NoSets, Check(Timed(new TimedBlockRequest { Block = 4, Format = "emom", Minutes = 10 })).Error);
        Assert.Equal(TimedBlocks.NoSets, Check(Timed(new TimedBlockRequest { Block = 0, Format = "emom", Minutes = 10 }, new TimedBlockRequest { Block = 0, Format = "amrap", Minutes = 5 })).Error);
        Assert.Equal(TimedBlocks.UnknownFormat, Check(Timed(new TimedBlockRequest { Block = 0, Format = "tabata", Minutes = 4 })).Error);
        Assert.Equal(TimedBlocks.BadMinutes, Check(Timed(new TimedBlockRequest { Block = 0, Format = "amrap" })).Error);
        Assert.Equal(TimedBlocks.BadMinutes, Check(Timed(new TimedBlockRequest { Block = 0, Format = "emom", Minutes = 121 })).Error);
        Assert.Equal(TimedBlocks.BadMinutes, Check(Timed(new TimedBlockRequest { Block = 0, Format = "emom", Minutes = 10, Every = 11 })).Error);
        Assert.Equal(TimedBlocks.BadMinutes, Check(Timed(new TimedBlockRequest { Block = 0, Format = "for_time", Minutes = 10 })).Error);
        Assert.Equal(TimedBlocks.BadScore, Check(Timed(new TimedBlockRequest { Block = 0, Format = "emom", Minutes = 10, Seconds = 30 })).Error);
        Assert.Equal(TimedBlocks.BadScore, Check(Timed(new TimedBlockRequest { Block = 0, Format = "for_time", Rounds = 3 })).Error);
        Assert.Equal(TimedBlocks.BadScore, Check(Timed(new TimedBlockRequest { Block = 0, Format = "amrap", Minutes = 12, Reps = -1 })).Error);
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
    public async Task A_timed_blocks_score_is_saved_with_the_workout()
    {
        var client = factory.AsUser(TestData.NewUser("workout-timed"));
        var id = Guid.NewGuid();
        var body = new
        {
            date = Today, timeZone = "UTC",
            sets = new[] { Set("pullups", null, 5), Set("pushups", null, 10), Set("barbell-squat", 80, 5, block: 1) },
            blocks = new object[] { new { block = 0, format = "amrap", minutes = 12, rounds = 1, reps = 4 } },
        };
        Assert.Equal(HttpStatusCode.Created, (await client.PutAsJsonAsync($"/api/workouts/{id}", body)).StatusCode);

        using var json = JsonDocument.Parse(await client.GetStringAsync($"/api/workouts/{id}"));
        var block = Assert.Single(json.RootElement.GetProperty("blocks").EnumerateArray());
        Assert.Equal("amrap", block.GetProperty("format").GetString());
        Assert.Equal(12, block.GetProperty("minutes").GetInt32());
        Assert.Equal(4, block.GetProperty("reps").GetInt32());

        // Sent again without blocks, it has none; one with no sets for its block is refused.
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync($"/api/workouts/{id}", Workout(Today, null, Set("barbell-squat", 80, 5)))).StatusCode);
        using var plain = JsonDocument.Parse(await client.GetStringAsync($"/api/workouts/{id}"));
        Assert.Equal(0, plain.RootElement.GetProperty("blocks").GetArrayLength());
        var bad = await client.PutAsJsonAsync($"/api/workouts/{id}", new { date = Today, timeZone = "UTC", sets = new[] { Set("barbell-squat", 80, 5) }, blocks = new[] { new { block = 3, format = "emom", minutes = 10 } } });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Contains(TimedBlocks.NoSets, await bad.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_run_is_saved_as_cardio_and_its_distance_is_in_the_list()
    {
        var client = factory.AsUser(TestData.NewUser("workout-cardio"));
        var run = Guid.NewGuid();
        var done = DateTimeOffset.UtcNow;
        var body = new
        {
            date = Today, timeZone = "UTC",
            sets = new object[]
            {
                new { exerciseId = "run", block = 0, metres = 5000m, seconds = 1500, doneAt = done },
                new { exerciseId = "run", block = 0, metres = 1000m, seconds = 300, doneAt = (DateTimeOffset?)null },
                new { exerciseId = "walk", block = 1, metres = 1200.5m, seconds = 900, doneAt = done },
            },
        };
        Assert.Equal(HttpStatusCode.Created, (await client.PutAsJsonAsync($"/api/workouts/{run}", body)).StatusCode);
        // A sled push's metres carry a weight: they aren't distance covered.
        var mixed = Guid.NewGuid();
        var hybrid = new
        {
            date = Today.AddDays(-1), timeZone = "UTC",
            sets = new object[]
            {
                new { exerciseId = "skierg", block = 0, metres = 1000m, seconds = 240, doneAt = done },
                new { exerciseId = "sled-pull", block = 1, kg = 100m, metres = 50m, doneAt = done },
            },
        };
        Assert.Equal(HttpStatusCode.Created, (await client.PutAsJsonAsync($"/api/workouts/{mixed}", hybrid)).StatusCode);

        using var json = JsonDocument.Parse(await client.GetStringAsync($"/api/workouts?from={Today.AddDays(-7):yyyy-MM-dd}&to={Today:yyyy-MM-dd}"));
        var list = json.RootElement.GetProperty("workouts");
        Assert.Equal("cardio", list[0].GetProperty("kind").GetString());
        Assert.Equal(6200.5m, list[0].GetProperty("metres").GetDecimal());
        Assert.Equal(0m, list[0].GetProperty("volumeKg").GetDecimal());
        Assert.Equal("hybrid", list[1].GetProperty("kind").GetString());
        Assert.Equal(1000m, list[1].GetProperty("metres").GetDecimal());
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

        Assert.Equal(0m, list[0].GetProperty("metres").GetDecimal());

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
    public async Task Previous_gives_the_best_working_set_by_estimated_max_from_any_done_workout()
    {
        var client = factory.AsUser(TestData.NewUser("workout-best"));
        var early = Guid.NewGuid();
        var latest = Guid.NewGuid();
        // 100 × 5 at 2 in reserve is about 123.3; 110 × 1 at 2 in reserve 121. Warm-ups, 25 reps and skipped workouts don't count.
        await client.PutAsJsonAsync($"/api/workouts/{early}", Workout(Today.AddDays(-9), null,
            Set("barbell-squat", 100, 5), Set("barbell-squat", 140, 3, type: "warmup"), Set("barbell-squat", 60, 25)));
        await client.PutAsJsonAsync($"/api/workouts/{latest}", Workout(Today.AddDays(-2), null, Set("barbell-squat", 110, 1), Set("barbell-squat", 90, 8)));
        await client.PutAsJsonAsync($"/api/workouts/{Guid.NewGuid()}", new { date = Today, timeZone = "UTC", status = "skipped", sets = new[] { Set("barbell-squat", 200, 5) } });

        using var json = JsonDocument.Parse(await client.GetStringAsync("/api/workouts/previous?exercise=barbell-squat"));
        var squat = json.RootElement.GetProperty("exercises").GetProperty("barbell-squat");
        Assert.Equal(latest, squat.GetProperty("workoutId").GetGuid());
        var best = squat.GetProperty("best");
        Assert.Equal(early, best.GetProperty("workoutId").GetGuid());
        Assert.Equal(100m, best.GetProperty("kg").GetDecimal());
        Assert.Equal(5, best.GetProperty("reps").GetInt32());
        Assert.Equal(123.33m, best.GetProperty("estimatedMax").GetDecimal());

        using var without = JsonDocument.Parse(await client.GetStringAsync($"/api/workouts/previous?exercise=barbell-squat&except={early}"));
        Assert.Equal(latest, without.RootElement.GetProperty("exercises").GetProperty("barbell-squat").GetProperty("best").GetProperty("workoutId").GetGuid());
    }

    [Theory]
    [InlineData("working", 100, 5, 2, 123.33)]
    [InlineData("working", 100, 5, null, 116.67)]
    [InlineData("working", 100, 1, 0, 103.33)]
    public void Estimated_max_is_Epley_with_reps_in_reserve(string type, double kg, int reps, int? rir, double expected) =>
        Assert.Equal((decimal)expected, EstimatedMax.Of(type, (decimal)kg, reps, rir));

    [Fact]
    public void Estimated_max_leaves_out_warm_ups_no_weight_and_high_reps()
    {
        Assert.Null(EstimatedMax.Of("warmup", 100, 5, 2));
        Assert.Null(EstimatedMax.Of("working", null, 5, 2));
        Assert.Null(EstimatedMax.Of("working", 0, 5, 2));
        Assert.Null(EstimatedMax.Of("working", 60, 21, 0));
        Assert.Null(EstimatedMax.Of("drop", 60, 8, 0));
    }

    [Fact]
    public async Task Strength_gives_each_lifts_estimated_max_per_day_in_the_range()
    {
        var client = factory.AsUser(TestData.NewUser("workout-strength"));
        // Two days of squats and one of bench in the last 30 days, one squat day before it, and a skipped workout.
        await client.PutAsJsonAsync($"/api/workouts/{Guid.NewGuid()}", Workout(Today.AddDays(-40), null, Set("barbell-squat", 60, 5)));
        await client.PutAsJsonAsync($"/api/workouts/{Guid.NewGuid()}", Workout(Today.AddDays(-10), null,
            Set("barbell-squat", 40, 10, type: "warmup"), Set("barbell-squat", 100, 5), Set("barbell-squat", 90, 8), Set("barbell-bench-press-medium-grip", 70, 8)));
        await client.PutAsJsonAsync($"/api/workouts/{Guid.NewGuid()}", Workout(Today.AddDays(-3), null, Set("barbell-squat", 105, 5), Set("barbell-squat", 105, 4)));
        await client.PutAsJsonAsync($"/api/workouts/{Guid.NewGuid()}", new { date = Today, timeZone = "UTC", status = "skipped", sets = Array.Empty<object>() });

        using var json = JsonDocument.Parse(await client.GetStringAsync("/api/workouts/strength?range=30d"));
        var root = json.RootElement;
        Assert.Equal(Today.AddDays(-29), DateOnly.Parse(root.GetProperty("from").GetString()!));
        Assert.Equal(2, root.GetProperty("workouts").GetInt32());
        Assert.Equal(5, root.GetProperty("sets").GetInt32());
        var lifts = root.GetProperty("lifts");
        Assert.Equal(2, lifts.GetArrayLength());
        var squat = lifts[0];
        Assert.Equal("barbell-squat", squat.GetProperty("exerciseId").GetString());
        // 100 × 5 and 105 × 5 at 2 in reserve: 123.33 then 129.5.
        Assert.Equal(129.5m, squat.GetProperty("current").GetDecimal());
        Assert.Equal(6.17m, squat.GetProperty("change").GetDecimal());
        Assert.Equal(2, squat.GetProperty("points").GetArrayLength());
        Assert.Equal(100m, squat.GetProperty("points")[0].GetProperty("kg").GetDecimal());
        Assert.Equal(JsonValueKind.Null, lifts[1].GetProperty("change").ValueKind);

        using var all = JsonDocument.Parse(await client.GetStringAsync("/api/workouts/strength?range=all"));
        Assert.Equal(Today.AddDays(-40), DateOnly.Parse(all.RootElement.GetProperty("from").GetString()!));
        Assert.Equal(3, all.RootElement.GetProperty("lifts")[0].GetProperty("points").GetArrayLength());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/workouts/strength?range=2y")).StatusCode);
    }

    [Fact]
    public void Strength_keeps_the_best_set_each_day_and_orders_lifts_by_how_often_they_were_done()
    {
        var day = new DateOnly(2026, 11, 2);
        var lifts = StrengthProgress.Lifts([
            new ScoredSet(day, "row", "working", 80, 8, 2),
            new ScoredSet(day, "row", "working", 85, 5, 0),
            new ScoredSet(day, "curl", "working", 20, 25, 0),
            new ScoredSet(day.AddDays(2), "row", "drop", 120, 8, 0),
            new ScoredSet(day.AddDays(2), "press", "working", 50, 8, 2),
            new ScoredSet(day.AddDays(4), "press", "working", 47.5m, 8, 2),
        ]);
        Assert.Equal(["press", "row"], lifts.Select(lift => lift.ExerciseId));
        Assert.Equal(66.67m, lifts[0].Best);
        Assert.Equal(63.33m, lifts[0].Current);
        Assert.Equal(-3.34m, lifts[0].Change);
        var row = Assert.Single(lifts[1].Points);
        Assert.Equal((80m, 8), (row.Kg, row.Reps));
    }

    [Fact]
    public async Task Muscles_counts_this_weeks_sets_per_muscle_main_in_full_and_helping_as_half()
    {
        var client = factory.AsUser(TestData.NewUser("workout-muscles"));
        var monday = Today.AddDays(-(((int)Today.DayOfWeek + 6) % 7));
        // Last week's doesn't count, nor does a warm-up.
        await client.PutAsJsonAsync($"/api/workouts/{Guid.NewGuid()}", Workout(monday.AddDays(-1), null, Set("barbell-squat", 100, 5)));
        await client.PutAsJsonAsync($"/api/workouts/{Guid.NewGuid()}", Workout(monday, null,
            Set("barbell-squat", 40, 10, type: "warmup"), Set("barbell-squat", 100, 5), Set("pullups", null, 8)));
        await client.PutAsJsonAsync($"/api/workouts/{Guid.NewGuid()}", Workout(Today, null, Set("barbell-squat", 100, 5)));

        using var json = JsonDocument.Parse(await client.GetStringAsync("/api/workouts/muscles"));
        var root = json.RootElement;
        Assert.Equal(monday, DateOnly.Parse(root.GetProperty("from").GetString()!));
        Assert.Equal(Today, DateOnly.Parse(root.GetProperty("to").GetString()!));
        Assert.Equal(2, root.GetProperty("workouts").GetInt32());
        Assert.Equal(JsonValueKind.Null, root.GetProperty("experience").ValueKind);
        Assert.Equal(10, root.GetProperty("target").GetProperty("low").GetInt32());
        Assert.Equal(14, root.GetProperty("target").GetProperty("high").GetInt32());
        var muscles = root.GetProperty("muscles").EnumerateArray()
            .Select(item => (item.GetProperty("muscle").GetString(), item.GetProperty("sets").GetDecimal()))
            .ToList();
        // Two squat sets (quadriceps; calves, glutes, hamstrings and lower back help) and a pull-up (lats; biceps and middle back help).
        Assert.Equal(
            [("quadriceps", 2m), ("calves", 1m), ("glutes", 1m), ("hamstrings", 1m), ("lats", 1m), ("lower-back", 1m), ("biceps", 0.5m), ("middle-back", 0.5m)],
            muscles);
        var quads = root.GetProperty("muscles")[0];
        Assert.Equal(monday == Today ? 1 : 2, quads.GetProperty("days").GetInt32());
    }

    [Fact]
    public void Muscle_volume_targets_follow_experience_and_skip_cardio_and_stretches()
    {
        Assert.Equal(new VolumeTarget(8, 10), MuscleVolume.TargetFor(Experience.New));
        Assert.Equal(new VolumeTarget(10, 14), MuscleVolume.TargetFor(null));
        Assert.Equal(new VolumeTarget(14, 18), MuscleVolume.TargetFor(Experience.Experienced));
        var library = ExerciseCatalog.Current;
        var cardio = library.All.First(item => item.Category == "cardio" && item.PrimaryMuscles.Count > 0);
        var stretch = library.All.First(item => item.Category == "stretching" && item.PrimaryMuscles.Count > 0);
        var day = new DateOnly(2026, 11, 23);
        Assert.Empty(MuscleVolume.Count([(day, cardio.Id), (day, stretch.Id), (day, "not-an-exercise")], library));
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
