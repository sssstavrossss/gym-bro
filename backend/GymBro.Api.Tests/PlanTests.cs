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
        string? split = null,
        bool? warmUp = null,
        bool? coolDown = null) => new()
    {
        Goal = goal,
        Weekdays = [.. days ?? [0, 2, 4, 6]],
        Minutes = minutes,
        Experience = experience,
        Equipment = [.. equipment ?? ["gym"]],
        GoEasy = [.. goEasy ?? []],
        EaseIn = easeIn,
        Split = split,
        WarmUp = warmUp,
        CoolDown = coolDown,
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
        Assert.Equal(PlanRules.UnknownGoal, PlanRules.Check(Request(goal: "crossfit")).Error);
        // Only Hyrox takes its split, and Hyrox takes no other but your own.
        Assert.Equal(PlanRules.UnknownSplit, PlanRules.Check(Request(split: "hyrox")).Error);
        Assert.Equal(PlanRules.UnknownSplit, PlanRules.Check(Request(goal: "hyrox", split: "full_body")).Error);
        Assert.Equal("custom", Answers(Request(goal: "hyrox", split: "custom")).Split);
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
    public void A_hyrox_plan_puts_strength_days_between_station_circuits_and_runs()
    {
        var answers = Answers(Request(goal: "hyrox", days: [0, 2, 4]));
        Assert.Equal("hyrox", answers.Split);
        var workouts = PlanGenerator.Generate(answers, ExerciseCatalog.Current);
        Assert.Equal(["Strength A", "Stations A", "Runs A", "Strength B", "Stations B", "Runs B"], workouts.Select(item => item.Name));
        Assert.Equal(4, Generate(Request(goal: "hyrox", days: [1, 4])).Count);

        // A full gym does the race's own stations, a circuit done for time, each round a 1 km run first.
        var stations = workouts[1].Exercises;
        Assert.Equal(["run", "skierg", "sled-push", "sled-pull", "burpee-broad-jump"], stations.Select(item => item.ExerciseId));
        Assert.Equal("for_time", stations[0].Format);
        Assert.False(stations[0].Superset);
        Assert.All(stations.Skip(1), item => Assert.True(item.Superset));
        Assert.Equal(1000, stations[0].Metres);
        Assert.Single(stations.Select(item => item.Sets).Distinct());
        Assert.All(stations, item => Assert.Equal(0, item.RestSeconds));
        Assert.Equal(["run", "rowing-stationary", "farmers-walk", "sandbag-lunge", "wall-ball"], workouts[4].Exercises.Select(item => item.ExerciseId));
        Assert.Equal(20, workouts[4].Exercises[4].RepMin);

        // Runs: 1 km repeats, then twice as many 500 m.
        var runs = Assert.Single(workouts[2].Exercises);
        Assert.Equal(("run", 1000, 90), (runs.ExerciseId, runs.Metres, runs.RestSeconds));
        Assert.Equal(runs.Sets * 2, workouts[5].Exercises[0].Sets);
        Assert.Equal(500, workouts[5].Exercises[0].Metres);

        // The strength days are the usual full-body workouts.
        Assert.Contains(workouts[0].Exercises, item => item.ExerciseId == "barbell-squat");
        Assert.All(workouts, workout => Assert.InRange(workout.Minutes, 5, 70));
    }

    [Fact]
    public void A_kettlebell_plan_ends_each_workout_with_a_finisher_on_the_clock()
    {
        var workouts = Generate(Request(goal: "fitness", days: [0, 2, 4], minutes: 45, equipment: ["kettlebells"]));
        // A: a swing EMOM, a set each minute. The swing is the A workout's hinge, so the one-arm swing stands in.
        var a = workouts[0].Exercises;
        var emom = a.SkipWhile(item => item.Format is null).ToList();
        Assert.Equal("emom", emom[0].Format);
        Assert.Equal(10, emom[0].Minutes);
        Assert.Equal(10, emom[0].Sets);
        Assert.False(emom[0].Superset);
        Assert.All(emom.Skip(1), item => Assert.True(item.Superset));
        Assert.Contains(emom[0].ExerciseId, new[] { "kettlebell-swing", "one-arm-kettlebell-swings" });
        Assert.Equal("pushups", emom[1].ExerciseId);
        Assert.All(emom, item => Assert.Equal((0, item.RepMin), (item.RestSeconds, item.RepMax)));
        Assert.Equal(a.Count, a.Select(item => item.ExerciseId).Distinct().Count());

        // B: an AMRAP of a clean, a press and a squat.
        var amrap = workouts[1].Exercises.SkipWhile(item => item.Format is null).ToList();
        Assert.Equal(("amrap", 8, 3), (amrap[0].Format, amrap[0].Minutes, amrap[0].Sets));
        Assert.Equal(3, amrap.Count);
        Assert.Equal("one-arm-kettlebell-clean", amrap[0].ExerciseId);

        // The finisher's minutes come out of the workout's time, so it still fits.
        Assert.All(workouts, workout => Assert.InRange(workout.Minutes, 30, 50));
        Assert.Equal(workouts[0].Minutes, PlanGenerator.Minutes(a, 45));

        // Experience sets the minutes; short workouts, more kit or Hyrox have none; going easy swaps the swing.
        Assert.Equal(12, Generate(Request(days: [0, 2, 4], experience: "experienced", equipment: ["kettlebells"]))[0].Exercises.Single(item => item.Format is not null).Minutes);
        Assert.DoesNotContain(Generate(Request(days: [0, 2, 4], minutes: 25, equipment: ["kettlebells"])).SelectMany(item => item.Exercises), item => item.Format is not null);
        Assert.DoesNotContain(Generate(Request(days: [0, 2, 4], equipment: ["kettlebells", "dumbbells"])).SelectMany(item => item.Exercises), item => item.Format is not null);
        var back = Generate(Request(days: [0, 2, 4], equipment: ["kettlebells"], goEasy: ["lower-back"]));
        Assert.Equal("amrap", back[1].Exercises.Single(item => item.Format is not null).Format);
        Assert.DoesNotContain(back.SelectMany(item => item.Exercises), item => item.ExerciseId.Contains("swing") || item.ExerciseId.Contains("clean"));
    }

    [Fact]
    public void A_hyrox_plan_stands_in_for_stations_the_kit_or_a_go_easy_area_rules_out()
    {
        var home = Generate(Request(goal: "hyrox", days: [0, 2, 4], equipment: ["kettlebells"]));
        Assert.Equal(["run", "mountain-climbers", "goblet-squat", "one-arm-kettlebell-row", "burpee-broad-jump"], home[1].Exercises.Select(item => item.ExerciseId));
        Assert.Equal(["run", "mountain-climbers", "farmers-walk", "lunge-pass-through", "kettlebell-thruster"], home[4].Exercises.Select(item => item.ExerciseId));
        Assert.Equal(30, home[1].Exercises[1].RepMin);

        // Going easy on knees: a machine for the runs (the bike twice as far), and no lunges, squats or jumps.
        var knees = Generate(Request(goal: "hyrox", days: [0, 2, 4], goEasy: ["knees"]));
        Assert.Equal(("rowing-stationary", 1000), (knees[2].Exercises[0].ExerciseId, knees[2].Exercises[0].Metres));
        Assert.Equal(2000, knees[1].Exercises[0].Metres);
        Assert.Equal(["fan-bike", "skierg", "sled-pull"], knees[1].Exercises.Select(item => item.ExerciseId));
    }

    [Theory]
    [InlineData("new", 30, 1)]
    [InlineData("new", 120, 2)]
    [InlineData("experienced", 120, 4)]
    public void A_circuits_rounds_fit_the_time_and_the_experience(string experience, int minutes, int rounds) =>
        Assert.Equal(rounds, Generate(Request(goal: "hyrox", minutes: minutes, experience: experience))[1].Exercises[0].Sets);

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
    [Fact]
    public void Warm_up_and_cool_down_are_off_unless_asked_for()
    {
        var answers = Answers(Request());
        Assert.False(answers.WarmUp);
        Assert.False(answers.CoolDown);
        Assert.All(Generate(Request()), workout =>
        {
            Assert.Null(workout.WarmUp);
            Assert.Null(workout.CoolDown);
        });
    }

    [Fact]
    public void The_warm_up_moves_the_parts_each_workout_trains()
    {
        var workouts = Generate(Request(days: [0, 1, 3, 4], warmUp: true));
        var upper = workouts.First(item => item.Name == "Upper A").WarmUp!.Select(item => item.ExerciseId).ToList();
        var lower = workouts.First(item => item.Name == "Lower A").WarmUp!.Select(item => item.ExerciseId).ToList();
        Assert.Equal(5, upper.Count);
        Assert.Contains("arm-circles", upper);
        Assert.DoesNotContain("ankle-circles", upper);
        Assert.Contains("front-leg-raises", lower);
        Assert.DoesNotContain("dynamic-chest-stretch", lower);
        // Each move is 30 s, once, with no rest; every one is a stretch from the library.
        Assert.All(workouts.SelectMany(item => item.WarmUp!), move =>
        {
            Assert.Equal((1, 30, 0), (move.Sets, move.Seconds, move.RestSeconds));
            Assert.Equal("stretching", ExerciseCatalog.Current.Find(move.ExerciseId)!.Category);
        });
        // A full-body workout warms both halves.
        var full = Generate(Request(days: [0, 3], warmUp: true))[0].WarmUp!.Select(item => ExerciseCatalog.Current.Find(item.ExerciseId)!).ToList();
        Assert.Contains(full, move => move.PrimaryMuscles.Any(muscle => muscle is "shoulders" or "chest" or "lats"));
        Assert.Contains(full, move => move.PrimaryMuscles.Any(muscle => muscle is "hamstrings" or "quadriceps" or "glutes" or "abductors"));
        // A short workout keeps it to two.
        Assert.Equal(2, Generate(Request(minutes: 20, warmUp: true))[0].WarmUp!.Count);
    }

    [Fact]
    public void The_warm_up_takes_the_plain_warm_ups_place()
    {
        var plain = Generate(Request(days: [0, 1, 3, 4]));
        var mobile = Generate(Request(days: [0, 1, 3, 4], warmUp: true));
        Assert.All(plain.Zip(mobile), pair => Assert.Equal(pair.First.Exercises, pair.Second.Exercises));
        // 5 × (30 + 15) s = 3:45 in place of 5:00, so the estimate never goes up.
        Assert.All(plain.Zip(mobile), pair => Assert.True(pair.Second.Minutes <= pair.First.Minutes));
    }

    [Fact]
    public void The_cool_down_stretches_the_busiest_muscles_and_keeps_its_minutes_free()
    {
        var plain = Generate(Request(days: [0, 1, 3, 4], minutes: 45));
        var cooled = Generate(Request(days: [0, 1, 3, 4], minutes: 45, coolDown: true));
        var lower = cooled.First(item => item.Name == "Lower A");
        Assert.Equal(3, lower.CoolDown!.Count);
        var stretched = lower.CoolDown.Select(item => ExerciseCatalog.Current.Find(item.ExerciseId)!.PrimaryMuscles[0]).ToList();
        Assert.Contains("quadriceps", stretched);
        Assert.Contains("hamstrings", stretched);
        Assert.All(lower.CoolDown, item => Assert.Equal((1, 45, 0), (item.Sets, item.Seconds, item.RestSeconds)));
        Assert.Equal(lower.CoolDown.Count, lower.CoolDown.Select(item => item.ExerciseId).Distinct().Count());
        // Its 3 × (45 + 15) s comes out of the lifting, so the workout still fits the time.
        Assert.All(plain.Zip(cooled), pair => Assert.True(pair.Second.Exercises.Count <= pair.First.Exercises.Count));
        Assert.All(cooled, item => Assert.True(item.Minutes <= 50, $"{item.Name}: {item.Minutes}"));
        // New to training holds for 30 s; an hour or more takes four.
        Assert.All(Generate(Request(experience: "new", coolDown: true))[0].CoolDown!, item => Assert.Equal(30, item.Seconds));
        Assert.Equal(4, Generate(Request(minutes: 60, coolDown: true))[0].CoolDown!.Count);
    }

    [Fact]
    public void Mobility_passes_over_moves_that_load_a_go_easy_area()
    {
        var workouts = Generate(Request(days: [0, 1, 3, 4], goEasy: ["shoulders", "hips"], warmUp: true, coolDown: true));
        var ids = workouts.SelectMany(item => item.WarmUp!.Concat(item.CoolDown!)).Select(item => item.ExerciseId).ToHashSet();
        Assert.NotEmpty(ids);
        Assert.DoesNotContain("arm-circles", ids);
        Assert.DoesNotContain("front-leg-raises", ids);
        Assert.DoesNotContain("standing-hip-flexors", ids);
        Assert.DoesNotContain("elbows-back", ids);
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
    public async Task A_plan_workout_is_edited_by_hand_and_keeps_its_place()
    {
        var client = factory.AsUser(TestData.NewUser("plan-edit"));
        using var made = JsonDocument.Parse(await (await client.PutAsJsonAsync("/api/plan", Answers())).Content.ReadAsStringAsync());
        var ids = WorkoutIds(made.RootElement);

        var edit = new
        {
            exercises = new object[]
            {
                new { exerciseId = "plank", sets = 3, repMin = (int?)null, repMax = (int?)null, seconds = 45, restSeconds = 60 },
                new { exerciseId = "barbell-squat", sets = 5, repMin = 3, repMax = 5, seconds = (int?)null, restSeconds = 180 },
                new { exerciseId = "run", sets = 1, repMin = (int?)null, repMax = (int?)null, seconds = (int?)null, restSeconds = 0, metres = 800, superset = true },
            },
        };
        var saved = await client.PutAsJsonAsync($"/api/plan/workouts/{ids[1]}", edit);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        using var json = JsonDocument.Parse(await saved.Content.ReadAsStringAsync());
        Assert.Equal(ids, WorkoutIds(json.RootElement));
        var workout = json.RootElement.GetProperty("workouts")[1];
        Assert.True(workout.GetProperty("edited").GetBoolean());
        Assert.False(json.RootElement.GetProperty("workouts")[0].GetProperty("edited").GetBoolean());
        Assert.Equal(["plank", "barbell-squat", "run"], workout.GetProperty("exercises").EnumerateArray().Select(item => item.GetProperty("exerciseId").GetString()));
        Assert.Equal(5, workout.GetProperty("exercises")[1].GetProperty("sets").GetInt32());
        // 5 min warm-up, 3 × (45 + 60) + 60, 5 × (40 + 180) + 60, 1 × 240 (800 m at 5:00 a km) + 60: 2,135 s, so 35.
        Assert.Equal(35, workout.GetProperty("minutes").GetInt32());
        // The run keeps its distance and stays joined to the squat.
        Assert.Equal(800, workout.GetProperty("exercises")[2].GetProperty("metres").GetInt32());
        Assert.True(workout.GetProperty("exercises")[2].GetProperty("superset").GetBoolean());

        using (var read = JsonDocument.Parse(await client.GetStringAsync("/api/plan")))
        {
            Assert.True(read.RootElement.GetProperty("plan").GetProperty("workouts")[1].GetProperty("edited").GetBoolean());
        }

        async Task<string> Refused(object body)
        {
            var response = await client.PutAsJsonAsync($"/api/plan/workouts/{ids[1]}", body);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            return await response.Content.ReadAsStringAsync();
        }

        object One(string id, int sets = 3, int? low = 8, int? high = 12, int? seconds = null, int rest = 90) =>
            new { exercises = new[] { new { exerciseId = id, sets, repMin = low, repMax = high, seconds, restSeconds = rest } } };
        Assert.Contains(PlanEdits.NoExercises, await Refused(new { exercises = Array.Empty<object>() }));
        Assert.Contains(PlanEdits.Unknown, await Refused(One("not-a-lift")));
        Assert.Contains(PlanEdits.BadSets, await Refused(One("barbell-squat", sets: 0)));
        Assert.Contains(PlanEdits.BadReps, await Refused(One("barbell-squat", low: 12, high: 8)));
        Assert.Contains(PlanEdits.BadReps, await Refused(One("plank", seconds: 30)));
        Assert.Contains(PlanEdits.BadSeconds, await Refused(One("plank", low: null, high: null)));
        Assert.Contains(PlanEdits.BadSeconds, await Refused(One("barbell-squat", seconds: 30)));
        Assert.Contains(PlanEdits.BadRest, await Refused(One("barbell-squat", rest: 601)));
        var twice = new { exercises = new[] { new { exerciseId = "barbell-squat", sets = 3, repMin = 5, repMax = 8, restSeconds = 120 }, new { exerciseId = "barbell-squat", sets = 3, repMin = 5, repMax = 8, restSeconds = 120 } } };
        Assert.Contains(PlanEdits.Twice, await Refused(twice));
        Assert.Contains(PlanEdits.BadMetres, await Refused(new { exercises = new[] { new { exerciseId = "barbell-squat", sets = 3, repMin = 5, repMax = 8, restSeconds = 120, metres = 100 } } }));
        Assert.Contains(PlanEdits.BadMetres, await Refused(new { exercises = new[] { new { exerciseId = "run", sets = 1, restSeconds = 0, metres = 50_000 } } }));
        Assert.Contains(PlanEdits.BadCircuit, await Refused(new { exercises = new[] { new { exerciseId = "run", sets = 1, restSeconds = 0, superset = true } } }));
        Assert.Contains(PlanEdits.BadCircuit, await Refused(new { exercises = new[] { new { exerciseId = "run", sets = 1, restSeconds = 0, format = "tabata" } } }));
        Assert.Contains(PlanEdits.BadClock, await Refused(new { exercises = new[] { new { exerciseId = "run", sets = 1, restSeconds = 0, format = "amrap" } } }));
        Assert.Contains(PlanEdits.BadClock, await Refused(new { exercises = new[] { new { exerciseId = "run", sets = 1, restSeconds = 0, format = "for_time", minutes = 10 } } }));

        // Someone else's plan, or a workout not in it, isn't there.
        var other = factory.AsUser(TestData.NewUser("plan-edit-other"));
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync($"/api/plan/workouts/{ids[1]}", edit)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PutAsJsonAsync($"/api/plan/workouts/{Guid.NewGuid()}", edit)).StatusCode);

        // Remaking the plan from the answers makes the workouts again, without the edit.
        using var remade = JsonDocument.Parse(await (await client.PutAsJsonAsync("/api/plan", Answers())).Content.ReadAsStringAsync());
        Assert.False(remade.RootElement.GetProperty("workouts")[1].GetProperty("edited").GetBoolean());
        Assert.Equal(ids, WorkoutIds(remade.RootElement));
    }

    [Fact]
    public async Task Your_own_plan_starts_empty_and_keeps_what_you_build()
    {
        var client = factory.AsUser(TestData.NewUser("plan-own"));
        var created = await client.PutAsJsonAsync("/api/plan", Answers(days: [0, 2, 4], split: "custom"));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var made = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var workouts = made.RootElement.GetProperty("workouts").EnumerateArray().ToList();
        Assert.Equal(["Workout A", "Workout B", "Workout C"], workouts.Select(item => item.GetProperty("name").GetString()));
        Assert.All(workouts, item => Assert.Equal(0, item.GetProperty("exercises").GetArrayLength()));
        Assert.All(workouts, item => Assert.Equal(0, item.GetProperty("minutes").GetInt32()));
        var ids = WorkoutIds(made.RootElement);

        var edit = new
        {
            name = "  Push   day ",
            exercises = new[] { new { exerciseId = "barbell-bench-press-medium-grip", sets = 3, repMin = 6, repMax = 10, restSeconds = 120 } },
        };
        using (var saved = JsonDocument.Parse(await (await client.PutAsJsonAsync($"/api/plan/workouts/{ids[1]}", edit)).Content.ReadAsStringAsync()))
        {
            Assert.Equal("Push day", saved.RootElement.GetProperty("workouts")[1].GetProperty("name").GetString());
        }

        async Task<string> Refused(string name)
        {
            var response = await client.PutAsJsonAsync($"/api/plan/workouts/{ids[1]}", new { name, edit.exercises });
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            return await response.Content.ReadAsStringAsync();
        }

        Assert.Contains(PlanEdits.BadName, await Refused("   "));
        Assert.Contains(PlanEdits.BadName, await Refused(new string('x', PlanEdits.MaxName + 1)));

        // A day more adds an empty workout and keeps the rest as built.
        using (var more = JsonDocument.Parse(await (await client.PutAsJsonAsync("/api/plan", Answers(days: [0, 2, 4, 5], split: "custom"))).Content.ReadAsStringAsync()))
        {
            var four = more.RootElement.GetProperty("workouts");
            Assert.Equal(ids, WorkoutIds(more.RootElement).Take(3));
            Assert.Equal(["Workout A", "Push day", "Workout C", "Workout D"], four.EnumerateArray().Select(item => item.GetProperty("name").GetString()));
            Assert.Equal("barbell-bench-press-medium-grip", four[1].GetProperty("exercises")[0].GetProperty("exerciseId").GetString());
            Assert.True(four[1].GetProperty("edited").GetBoolean());
        }

        // Fewer days drop the last ones.
        using (var fewer = JsonDocument.Parse(await (await client.PutAsJsonAsync("/api/plan", Answers(days: [0, 3], split: "custom"))).Content.ReadAsStringAsync()))
        {
            Assert.Equal(ids.Take(2), WorkoutIds(fewer.RootElement));
        }

        // Going to a suggested split makes its workouts.
        using var full = JsonDocument.Parse(await (await client.PutAsJsonAsync("/api/plan", Answers(days: [0, 3], split: "full_body"))).Content.ReadAsStringAsync());
        Assert.Equal("Full body A", full.RootElement.GetProperty("workouts")[0].GetProperty("name").GetString());
        Assert.True(full.RootElement.GetProperty("workouts")[0].GetProperty("exercises").GetArrayLength() > 0);
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
    [Fact]
    public async Task Warm_up_and_cool_down_are_kept_on_the_plan_and_follow_an_edit()
    {
        var client = factory.AsUser(TestData.NewUser("plan-mobility"));
        var body = new
        {
            goal = "muscle",
            weekdays = new[] { 0, 2, 4 },
            minutes = 45,
            experience = "some",
            equipment = new[] { "gym" },
            goEasy = Array.Empty<string>(),
            warmUp = true,
            coolDown = true,
            timeZone = "UTC",
        };
        using (var preview = JsonDocument.Parse(await (await client.PostAsJsonAsync("/api/plan/preview", body)).Content.ReadAsStringAsync()))
        {
            Assert.True(preview.RootElement.GetProperty("warmUp").GetBoolean());
            Assert.True(preview.RootElement.GetProperty("coolDown").GetBoolean());
        }

        var made = await client.PutAsJsonAsync("/api/plan", body);
        Assert.Equal(HttpStatusCode.Created, made.StatusCode);
        using var json = JsonDocument.Parse(await made.Content.ReadAsStringAsync());
        Assert.True(json.RootElement.GetProperty("warmUp").GetBoolean());
        Assert.True(json.RootElement.GetProperty("coolDown").GetBoolean());
        var first = json.RootElement.GetProperty("workouts")[0];
        Assert.Equal(5, first.GetProperty("warmUp").GetArrayLength());
        Assert.Equal(3, first.GetProperty("coolDown").GetArrayLength());

        // Edited to an upper-body workout, its warm-up and cool-down turn to the upper body.
        var id = first.GetProperty("id").GetString();
        var edit = new
        {
            exercises = new[]
            {
                new { exerciseId = "barbell-bench-press-medium-grip", sets = 3, repMin = 6, repMax = 10, restSeconds = 120 },
                new { exerciseId = "pullups", sets = 3, repMin = 6, repMax = 10, restSeconds = 120 },
            },
        };
        using var edited = JsonDocument.Parse(await (await client.PutAsJsonAsync($"/api/plan/workouts/{id}", edit)).Content.ReadAsStringAsync());
        var workout = edited.RootElement.GetProperty("workouts")[0];
        var warm = workout.GetProperty("warmUp").EnumerateArray().Select(item => item.GetProperty("exerciseId").GetString()).ToList();
        Assert.Contains("arm-circles", warm);
        Assert.DoesNotContain("front-leg-raises", warm);
        var cool = workout.GetProperty("coolDown").EnumerateArray().Select(item => item.GetProperty("exerciseId").GetString()).ToList();
        Assert.DoesNotContain("hamstring-stretch", cool);
        Assert.NotEmpty(cool);

        // Turned off, they go.
        using var off = JsonDocument.Parse(await (await client.PutAsJsonAsync("/api/plan", body with { warmUp = false, coolDown = false })).Content.ReadAsStringAsync());
        Assert.False(off.RootElement.GetProperty("warmUp").GetBoolean());
        Assert.All(off.RootElement.GetProperty("workouts").EnumerateArray(), item =>
        {
            Assert.Equal(JsonValueKind.Null, item.GetProperty("warmUp").ValueKind);
            Assert.Equal(JsonValueKind.Null, item.GetProperty("coolDown").ValueKind);
        });
    }
}
