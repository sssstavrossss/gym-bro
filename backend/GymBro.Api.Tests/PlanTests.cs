using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Training;

namespace GymBro.Api.Tests;

public sealed class PlanRulesTests
{
    private static PlanRequest Request(
        string goal = "muscle",
        int[]? days = null,
        int minutes = 60,
        string experience = "some",
        string[]? equipment = null,
        string[]? goEasy = null,
        bool? easeIn = null,
        string? split = null) => new()
    {
        Goal = goal,
        Weekdays = [.. days ?? [0, 2, 4, 6]],
        Minutes = minutes,
        Experience = experience,
        Equipment = [.. equipment ?? ["gym"]],
        GoEasy = [.. goEasy ?? []],
        EaseIn = easeIn,
        Split = split,
    };

    private static PlanAnswers Answers(PlanRequest request)
    {
        var (answers, error) = PlanRules.Check(request);
        Assert.Null(error);
        return answers!;
    }

    private static IReadOnlyList<PlanWorkout> Generate(PlanRequest request) => PlanGenerator.Generate(Answers(request), ExerciseCatalog.Current);

    private static CoreExercise Core(string id) => CoreExercises.All.First(item => item.Id == id);

    [Theory]
    [InlineData(new[] { 0 }, "full_body")]
    [InlineData(new[] { 0, 3 }, "full_body")]
    [InlineData(new[] { 0, 2, 4 }, "full_body")]
    [InlineData(new[] { 0, 1, 3, 4 }, "upper_lower")]
    [InlineData(new[] { 0, 1, 2, 3, 4 }, "ppl_upper_lower")]
    [InlineData(new[] { 0, 1, 2, 3, 4, 5 }, "push_pull_legs")]
    [InlineData(new[] { 0, 1, 2, 3, 4, 5, 6 }, "push_pull_legs")]
    public void The_split_follows_from_the_days(int[] days, string split) =>
        Assert.Equal(split, Answers(Request(days: days)).Split);

    [Fact]
    public void Ease_in_is_on_for_new_people_and_anyone_going_easy_on_an_area()
    {
        Assert.True(Answers(Request(experience: "new")).EaseIn);
        Assert.True(Answers(Request(goEasy: ["knees"])).EaseIn);
        Assert.False(Answers(Request()).EaseIn);
        Assert.True(Answers(Request(easeIn: true)).EaseIn);
        Assert.False(Answers(Request(experience: "new", easeIn: false)).EaseIn);
    }

    [Fact]
    public void Answers_are_tidied()
    {
        var answers = Answers(Request(days: [4, 0, 4, 2], goEasy: ["knees", "shoulders", "knees"], equipment: ["dumbbells", "kettlebells", "dumbbells"]));
        Assert.Equal([0, 2, 4], answers.Weekdays);
        Assert.Equal(["shoulders", "knees"], answers.GoEasy);
        Assert.Equal(["dumbbells", "kettlebells"], answers.Equipment);
    }

    [Fact]
    public void Bad_answers_are_refused_with_a_reason()
    {
        Assert.Equal(PlanRules.UnknownGoal, PlanRules.Check(Request(goal: "hyrox")).Error);
        Assert.Equal(PlanRules.NeedsDays, PlanRules.Check(Request(days: [])).Error);
        Assert.Equal(PlanRules.BadDay, PlanRules.Check(Request(days: [7])).Error);
        Assert.Equal(PlanRules.BadMinutes, PlanRules.Check(Request(minutes: 5)).Error);
        Assert.Equal(PlanRules.BadMinutes, PlanRules.Check(Request(minutes: 125)).Error);
        Assert.Equal(PlanRules.BadMinutes, PlanRules.Check(Request(minutes: 42)).Error);
        Assert.Equal(PlanRules.UnknownExperience, PlanRules.Check(Request(experience: "pro")).Error);
        Assert.Equal(PlanRules.NeedsEquipment, PlanRules.Check(Request(equipment: [])).Error);
        Assert.Equal(PlanRules.UnknownEquipment, PlanRules.Check(Request(equipment: ["rowing-boat"])).Error);
        Assert.Equal(PlanRules.UnknownJoint, PlanRules.Check(Request(goEasy: ["neck"])).Error);
        Assert.Equal(PlanRules.UnknownSplit, PlanRules.Check(Request(split: "bro_split")).Error);
    }

    [Fact]
    public void Every_core_exercise_is_in_the_library()
    {
        var missing = CoreExercises.All.Where(item => ExerciseCatalog.Current.Find(item.Id) is null).Select(item => item.Id).ToList();
        Assert.Empty(missing);
    }

    [Fact]
    public void Four_days_in_a_gym_make_upper_lower_workouts_that_fit_the_time()
    {
        var workouts = Generate(Request());
        Assert.Equal(["Upper A", "Lower A", "Upper B", "Lower B"], workouts.Select(item => item.Name));
        Assert.Equal(4, workouts.Select(item => item.Id).Distinct().Count());
        Assert.All(workouts, workout =>
        {
            Assert.InRange(workout.Exercises.Count, 4, 9);
            Assert.InRange(workout.Minutes, 40, 60);
            Assert.Equal(workout.Exercises.Count, workout.Exercises.Select(item => item.ExerciseId).Distinct().Count());
        });
        Assert.Equal("barbell-bench-press-medium-grip", workouts[0].Exercises[0].ExerciseId);
        Assert.Equal("barbell-squat", workouts[1].Exercises[0].ExerciseId);
        // The B workouts take the next exercise for each movement, so they differ from A.
        Assert.NotEqual(workouts[0].Exercises.Select(item => item.ExerciseId).ToHashSet(), workouts[2].Exercises.Select(item => item.ExerciseId).ToHashSet());
    }

    [Fact]
    public void Muscle_plans_use_6_to_10_for_compounds_and_10_to_15_for_isolation()
    {
        var upper = Generate(Request())[0].Exercises;
        var bench = upper.First(item => item.ExerciseId == "barbell-bench-press-medium-grip");
        Assert.Equal((3, 6, 10, 120), (bench.Sets, bench.RepMin!.Value, bench.RepMax!.Value, bench.RestSeconds));
        var raise = upper.First(item => item.ExerciseId == "side-lateral-raise");
        Assert.Equal((3, 10, 15, 90), (raise.Sets, raise.RepMin!.Value, raise.RepMax!.Value, raise.RestSeconds));
    }

    [Fact]
    public void Isolation_slots_take_the_isolation_range_whatever_the_source_calls_the_exercise()
    {
        var pull = Generate(Request(days: [0, 1, 2, 3, 4, 5], minutes: 90))[1].Exercises;
        var facePull = pull.First(item => item.ExerciseId == "face-pull");
        Assert.Equal((10, 15, 90), (facePull.RepMin!.Value, facePull.RepMax!.Value, facePull.RestSeconds));
    }

    [Fact]
    public void Strength_plans_put_a_heavy_lift_first_and_rest_longer()
    {
        var lower = Generate(Request(goal: "strength"))[1].Exercises;
        Assert.Equal(("barbell-squat", 4, 3, 6, 240), (lower[0].ExerciseId, lower[0].Sets, lower[0].RepMin!.Value, lower[0].RepMax!.Value, lower[0].RestSeconds));
        Assert.Contains(lower, item => item.ExerciseId == "barbell-deadlift");
        // B workouts keep the main barbell lift first.
        Assert.Equal("barbell-deadlift", Generate(Request(goal: "strength"))[3].Exercises[0].ExerciseId);
        // The deadlift is kept for strength plans.
        Assert.DoesNotContain(Generate(Request()).SelectMany(item => item.Exercises), item => item.ExerciseId == "barbell-deadlift");
    }

    [Fact]
    public void Exercises_need_only_the_equipment_picked()
    {
        var kit = new HashSet<string> { Kit.Dumbbell, Kit.Kettlebell, Kit.Bodyweight };
        var exercises = Generate(Request(equipment: ["dumbbells", "kettlebells"])).SelectMany(item => item.Exercises).ToList();
        Assert.NotEmpty(exercises);
        Assert.All(exercises, item => Assert.Contains(Core(item.ExerciseId).Kit, kit.Contains));

        var bodyweight = Generate(Request(equipment: ["bodyweight"], days: [0, 3])).SelectMany(item => item.Exercises).ToList();
        Assert.All(bodyweight, item => Assert.Contains(Kit.Bodyweight, Core(item.ExerciseId).Kit));
        Assert.Contains(bodyweight, item => item.ExerciseId == "pushups");
    }

    [Theory]
    [InlineData("knees")]
    [InlineData("shoulders")]
    [InlineData("lower-back")]
    public void Go_easy_areas_leave_out_the_exercises_that_load_them(string area)
    {
        var exercises = Generate(Request(goEasy: [area])).SelectMany(item => item.Exercises).ToList();
        Assert.NotEmpty(exercises);
        Assert.All(exercises, item => Assert.DoesNotContain(area, Core(item.ExerciseId).Loads));
    }

    [Fact]
    public void New_plans_leave_out_the_hard_ones()
    {
        var exercises = Generate(Request(experience: "new", equipment: ["home"])).SelectMany(item => item.Exercises).ToList();
        Assert.All(exercises, item => Assert.False(Core(item.ExerciseId).Hard));
        Assert.Contains(Generate(Request(equipment: ["home"])).SelectMany(item => item.Exercises), item => item.ExerciseId == "pullups");
    }

    [Fact]
    public void Time_decides_how_many_exercises_fit()
    {
        var count = (int minutes) => Generate(Request(minutes: minutes))[0].Exercises.Count;
        Assert.True(count(30) < count(60));
        Assert.True(count(60) <= count(120));

        var short_ = Generate(Request(minutes: 10))[0];
        Assert.Equal(2, short_.Exercises.Count);
        Assert.All(short_.Exercises, item => Assert.True(item.Sets <= 2));
    }

    [Fact]
    public void Holds_are_set_in_seconds()
    {
        var plank = Generate(Request(days: [0, 3], minutes: 120)).SelectMany(item => item.Exercises).First(item => item.ExerciseId == "plank");
        Assert.Null(plank.RepMin);
        Assert.Equal(45, plank.Seconds);
    }

    [Fact]
    public void A_new_plan_with_the_same_number_of_workouts_keeps_their_ids()
    {
        var first = Generate(Request());
        var again = PlanGenerator.Generate(Answers(Request(minutes: 45)), ExerciseCatalog.Current, first.Select(item => item.Id).ToList());
        Assert.Equal(first.Select(item => item.Id), again.Select(item => item.Id));
        var other = PlanGenerator.Generate(Answers(Request(days: [0, 2])), ExerciseCatalog.Current, first.Select(item => item.Id).ToList());
        Assert.DoesNotContain(other, item => first.Any(old => old.Id == item.Id));
    }

    [Fact]
    public void Swaps_leave_out_what_loads_a_go_easy_area_and_keep_lifts_to_lifts()
    {
        var library = ExerciseCatalog.Current;
        var squat = library.Find("barbell-squat")!;
        var easy = Swaps.For(squat, library, EquipmentPresets.KitOf(["gym"]), [Joints.Knees]);
        Assert.DoesNotContain(easy, option => option.Why == Swaps.SameMovement);
        Assert.DoesNotContain(easy, option => option.Id is "leg-press" or "hack-squat" or "goblet-squat");
        Assert.All(easy, option => Assert.DoesNotContain(library.Find(option.Id)!.Category, new[] { "cardio", "stretching" }));
        Assert.True(easy.Count <= Swaps.MuscleOptions);
        Assert.Equal(Kit.Barbell, Swaps.KitOf("ez-bar"));
        Assert.Null(Swaps.KitOf("bands"));
    }
}

[Collection(ApiCollection.Name)]
public sealed class PlanEndpointTests(ApiFactory factory)
{
    private readonly DateOnly Today = Start(factory);

    private static DateOnly Start(ApiFactory factory)
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 25, 12, 0, 0, TimeSpan.Zero);
        return new DateOnly(2026, 11, 25);
    }

    private static object Answers(int[]? days = null, int minutes = 60, string? split = null) => new
    {
        goal = "muscle",
        weekdays = days ?? [0, 2, 4, 6],
        minutes,
        experience = "some",
        equipment = new[] { "gym" },
        goEasy = Array.Empty<string>(),
        split,
        timeZone = "UTC",
    };

    [Fact]
    public async Task Swaps_offer_the_same_movement_first_and_keep_to_the_plans_kit()
    {
        var client = factory.AsUser(TestData.NewUser("plan-swaps"));
        using (var open = JsonDocument.Parse(await client.GetStringAsync("/api/exercises/barbell-squat/swaps")))
        {
            var root = open.RootElement;
            Assert.False(root.GetProperty("planKit").GetBoolean());
            var options = root.GetProperty("options").EnumerateArray().ToList();
            // With no plan: every core squat, in the generator's order, then same-muscle ones.
            Assert.Equal(["hack-squat", "leg-press", "goblet-squat"], options.Take(3).Select(item => item.GetProperty("id").GetString()));
            Assert.Equal("movement", options[0].GetProperty("why").GetString());
            Assert.Contains(options, item => item.GetProperty("why").GetString() == "muscle");
        }

        var made = await client.PutAsJsonAsync("/api/plan", new
        {
            goal = "muscle", weekdays = new[] { 0, 2, 4 }, minutes = 60, experience = "some",
            equipment = new[] { "dumbbells" }, goEasy = Array.Empty<string>(), split = (string?)null, timeZone = "UTC",
        });
        Assert.Equal(HttpStatusCode.Created, made.StatusCode);
        using var planned = JsonDocument.Parse(await client.GetStringAsync("/api/exercises/barbell-squat/swaps"));
        Assert.True(planned.RootElement.GetProperty("planKit").GetBoolean());
        var fitting = planned.RootElement.GetProperty("options").EnumerateArray()
            .Select(item => (Id: item.GetProperty("id").GetString()!, Why: item.GetProperty("why").GetString()!)).ToList();
        Assert.Equal("goblet-squat", fitting[0].Id);
        Assert.DoesNotContain(fitting, option => option.Id == "hack-squat");
        // Same-muscle ones need only dumbbells or body weight.
        Assert.All(fitting.Where(option => option.Why == "muscle"), option =>
            Assert.Contains(ExerciseCatalog.Current.Find(option.Id)!.Equipment, new[] { "dumbbell", "bodyweight", "none" }));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/exercises/not-a-lift/swaps")).StatusCode);
    }

    private static Guid[] WorkoutIds(JsonElement plan) => [.. plan.GetProperty("workouts").EnumerateArray().Select(item => item.GetProperty("id").GetGuid())];

    [Fact]
    public async Task A_plan_is_made_kept_and_remade_with_its_sequence()
    {
        var client = factory.AsUser(TestData.NewUser("plan-put"));
        using (var none = JsonDocument.Parse(await client.GetStringAsync("/api/plan")))
        {
            Assert.Equal(JsonValueKind.Null, none.RootElement.GetProperty("plan").ValueKind);
        }

        var created = await client.PutAsJsonAsync("/api/plan", Answers());
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var first = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var plan = first.RootElement;
        Assert.Equal("upper_lower", plan.GetProperty("split").GetString());
        Assert.Equal(6, plan.GetProperty("blockWeeks").GetInt32());
        Assert.Equal(Today, DateOnly.Parse(plan.GetProperty("startDate").GetString()!));
        Assert.Equal(4, plan.GetProperty("workouts").GetArrayLength());
        var exercise = plan.GetProperty("workouts")[0].GetProperty("exercises")[0];
        Assert.Equal("barbell-bench-press-medium-grip", exercise.GetProperty("exerciseId").GetString());
        Assert.Equal(6, exercise.GetProperty("repMin").GetInt32());

        // A change on another day keeps the start and, with the same split, the workout ids.
        factory.Clock.UtcNow = factory.Clock.UtcNow.AddDays(3);
        var changed = await client.PutAsJsonAsync("/api/plan", Answers(minutes: 45));
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        using var second = JsonDocument.Parse(await changed.Content.ReadAsStringAsync());
        Assert.Equal(WorkoutIds(plan), WorkoutIds(second.RootElement));
        Assert.Equal(Today, DateOnly.Parse(second.RootElement.GetProperty("startDate").GetString()!));
        Assert.Equal(45, second.RootElement.GetProperty("minutes").GetInt32());

        var full = await client.PutAsJsonAsync("/api/plan", Answers(split: "full_body"));
        using var third = JsonDocument.Parse(await full.Content.ReadAsStringAsync());
        Assert.Equal(2, third.RootElement.GetProperty("workouts").GetArrayLength());
        Assert.DoesNotContain(WorkoutIds(third.RootElement), WorkoutIds(plan).Contains);

        using (var read = JsonDocument.Parse(await client.GetStringAsync("/api/plan")))
        {
            Assert.Equal("full_body", read.RootElement.GetProperty("plan").GetProperty("split").GetString());
        }

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/plan")).StatusCode);
        using var gone = JsonDocument.Parse(await client.GetStringAsync("/api/plan"));
        Assert.Equal(JsonValueKind.Null, gone.RootElement.GetProperty("plan").ValueKind);
    }

    [Fact]
    public async Task A_preview_is_not_saved()
    {
        var client = factory.AsUser(TestData.NewUser("plan-preview"));
        var preview = await client.PostAsJsonAsync("/api/plan/preview", Answers(days: [0, 1, 2, 3, 4, 5]));
        Assert.Equal(HttpStatusCode.OK, preview.StatusCode);
        using var json = JsonDocument.Parse(await preview.Content.ReadAsStringAsync());
        Assert.Equal("push_pull_legs", json.RootElement.GetProperty("split").GetString());
        Assert.Equal(6, json.RootElement.GetProperty("workouts").GetArrayLength());
        Assert.Equal("Push A", json.RootElement.GetProperty("workouts")[0].GetProperty("name").GetString());

        using var none = JsonDocument.Parse(await client.GetStringAsync("/api/plan"));
        Assert.Equal(JsonValueKind.Null, none.RootElement.GetProperty("plan").ValueKind);
    }

    [Fact]
    public async Task Plans_are_private_and_bad_answers_are_refused()
    {
        var owner = factory.AsUser(TestData.NewUser("plan-owner"));
        var other = factory.AsUser(TestData.NewUser("plan-other"));
        Assert.Equal(HttpStatusCode.Created, (await owner.PutAsJsonAsync("/api/plan", Answers())).StatusCode);

        using (var theirs = JsonDocument.Parse(await other.GetStringAsync("/api/plan")))
        {
            Assert.Equal(JsonValueKind.Null, theirs.RootElement.GetProperty("plan").ValueKind);
        }

        Assert.Equal(HttpStatusCode.NoContent, (await other.DeleteAsync("/api/plan")).StatusCode);
        using (var mine = JsonDocument.Parse(await owner.GetStringAsync("/api/plan")))
        {
            Assert.Equal(JsonValueKind.Object, mine.RootElement.GetProperty("plan").ValueKind);
        }

        var bad = await owner.PutAsJsonAsync("/api/plan", Answers(minutes: 7));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Contains(PlanRules.BadMinutes, await bad.Content.ReadAsStringAsync());
        var badPreview = await owner.PostAsJsonAsync("/api/plan/preview", Answers(days: []));
        Assert.Equal(HttpStatusCode.BadRequest, badPreview.StatusCode);
    }

    [Fact]
    public async Task A_workout_keeps_its_plan_workout_and_place_in_the_sequence()
    {
        var client = factory.AsUser(TestData.NewUser("plan-session"));
        var planWorkoutId = Guid.NewGuid();
        var id = Guid.NewGuid();
        var skipped = await client.PutAsJsonAsync($"/api/workouts/{id}", new { date = Today, timeZone = "UTC", name = "Upper A", status = "skipped", planWorkoutId, sequencePosition = 4 });
        Assert.Equal(HttpStatusCode.Created, skipped.StatusCode);

        using var json = JsonDocument.Parse(await client.GetStringAsync($"/api/workouts?from={Today:yyyy-MM-dd}&to={Today:yyyy-MM-dd}"));
        var row = json.RootElement.GetProperty("workouts")[0];
        Assert.Equal(planWorkoutId, row.GetProperty("planWorkoutId").GetGuid());
        Assert.Equal(4, row.GetProperty("sequencePosition").GetInt32());
        Assert.Equal("skipped", row.GetProperty("status").GetString());

        var half = await client.PutAsJsonAsync($"/api/workouts/{Guid.NewGuid()}", new { date = Today, timeZone = "UTC", planWorkoutId });
        Assert.Equal(HttpStatusCode.BadRequest, half.StatusCode);
        Assert.Contains(WorkoutRules.BadSequence, await half.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task The_plan_knows_the_last_place_done_or_skipped_from_its_own_workouts()
    {
        var client = factory.AsUser(TestData.NewUser("plan-last"));
        using var made = JsonDocument.Parse(await (await client.PutAsJsonAsync("/api/plan", Answers())).Content.ReadAsStringAsync());
        Assert.Equal(JsonValueKind.Null, made.RootElement.GetProperty("lastPosition").ValueKind);
        var ids = WorkoutIds(made.RootElement);

        async Task Put(Guid planWorkoutId, int position, string status = "done", HttpClient? who = null) =>
            Assert.True((await (who ?? client).PutAsJsonAsync($"/api/workouts/{Guid.NewGuid()}", new { date = Today, timeZone = "UTC", status, planWorkoutId, sequencePosition = position })).IsSuccessStatusCode);

        await Put(ids[0], 0);
        await Put(ids[1], 1, "skipped");
        // Another plan's workout, or someone else's, doesn't move this plan on.
        await Put(Guid.NewGuid(), 9);
        await Put(ids[2], 7, who: factory.AsUser(TestData.NewUser("plan-last-other")));

        async Task<int?> Last()
        {
            using var json = JsonDocument.Parse(await client.GetStringAsync("/api/plan"));
            var value = json.RootElement.GetProperty("plan").GetProperty("lastPosition");
            return value.ValueKind == JsonValueKind.Null ? null : value.GetInt32();
        }

        Assert.Equal(1, await Last());

        // The same split keeps its place; a new split starts again.
        using var kept = JsonDocument.Parse(await (await client.PutAsJsonAsync("/api/plan", Answers(minutes: 45))).Content.ReadAsStringAsync());
        Assert.Equal(1, kept.RootElement.GetProperty("lastPosition").GetInt32());
        await client.PutAsJsonAsync("/api/plan", Answers(split: "full_body"));
        Assert.Null(await Last());
    }
}
