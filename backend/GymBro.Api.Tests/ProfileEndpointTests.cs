using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Hosting;
using GymBro.Api.Nutrition;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class ProfileEndpointTests(ApiFactory factory)
{
    [Fact]
    public async Task Worked_example_is_saved_for_the_caller_and_a_repeat_does_not_add_a_row()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("example");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-24", """{"kg":83.6,"timeZone":"UTC"}""");

        var saved = await TestData.PutProfile(client, TestData.Profile());
        var targets = saved.GetProperty("targets");
        Assert.Equal(1786, targets.GetProperty("bmr").GetInt32());
        Assert.Equal(2768, targets.GetProperty("tdee").GetInt32());
        Assert.Equal(2218, targets.GetProperty("kcal").GetInt32());
        Assert.Equal(167, targets.GetProperty("protein").GetInt32());
        Assert.Equal(62, targets.GetProperty("fat").GetInt32());
        Assert.Equal(249, targets.GetProperty("carbs").GetInt32());
        Assert.False(targets.GetProperty("floorApplied").GetBoolean());
        Assert.Equal(TargetReasons.ProfileChange, targets.GetProperty("reason").GetString());
        Assert.Equal("Matvaretabellen 2026. Mattilsynet. www.matvaretabellen.no", saved.GetProperty("citation").GetString());
        Assert.Equal("weigh_in", saved.GetProperty("weight").GetProperty("source").GetString());
        Assert.False(saved.GetProperty("weight").GetProperty("trendVisible").GetBoolean());
        Assert.Null(saved.GetProperty("weight").GetProperty("trendKg").GetString());
        Assert.Equal(83.60m, targets.GetProperty("weightKg").GetDecimal());

        await TestData.PutProfile(client, TestData.Profile());
        Assert.Equal(1, await HistoryCount(user));
    }

    [Fact]
    public async Task Profile_requires_a_weigh_in_and_rejects_invented_macro_steps()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("invalid");
        using var client = factory.AsUser(user);

        var missing = await client.PutAsJsonAsync("/api/profile", TestData.Profile());
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Contains("weigh-in", await missing.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);

        await TestData.PutWeighIn(client, "2026-10-24", """{"kg":"83,6","timeZone":"UTC"}""");
        var badProtein = await client.PutAsJsonAsync("/api/profile", TestData.Profile(proteinSetting: "exact", proteinGramsPerKg: 1.25m));
        Assert.Equal(HttpStatusCode.BadRequest, badProtein.StatusCode);

        var badFat = await client.PutAsJsonAsync("/api/profile", TestData.Profile(fatSetting: "exact", fatPercent: 22));
        Assert.Equal(HttpStatusCode.BadRequest, badFat.StatusCode);

        var commaHeight = await TestData.PutProfile(client, new
        {
            sex = "male",
            birthYear = 1990,
            heightCm = "180,5",
            activity = "very",
            goal = "lose",
            rateKgPerWeek = "0,5",
            goalWeightKg = "80,0",
            proteinSetting = "normal",
            proteinGramsPerKg = "2,0",
            fatSetting = "normal",
            fatPercent = "25",
            timeZone = "UTC",
        });
        Assert.Equal(180.5m, commaHeight.GetProperty("profile").GetProperty("heightCm").GetDecimal());
        Assert.Equal("very_active", commaHeight.GetProperty("profile").GetProperty("activity").GetString());
    }

    [Fact]
    public async Task Past_days_keep_their_targets_when_macros_change()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 26, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("history");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-26", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());

        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 27, 8, 0, 0, TimeSpan.Zero);
        var updated = await TestData.PutProfile(client, TestData.Profile(fatSetting: "more", fatPercent: 30));
        Assert.Equal(TargetReasons.MacroBalanceChange, updated.GetProperty("targets").GetProperty("reason").GetString());
        Assert.Equal(2218, updated.GetProperty("targets").GetProperty("kcal").GetInt32());
        Assert.NotEqual(62, updated.GetProperty("targets").GetProperty("fat").GetInt32());

        var monday = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-10-26");
        var tuesday = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-10-27");
        Assert.Equal(62, monday.GetProperty("targets").GetProperty("fat").GetInt32());
        Assert.Equal(TargetReasons.ProfileChange, monday.GetProperty("targets").GetProperty("reason").GetString());
        Assert.Equal(TargetReasons.MacroBalanceChange, tuesday.GetProperty("targets").GetProperty("reason").GetString());
        Assert.NotEqual(
            monday.GetProperty("targets").GetProperty("fat").GetInt32(),
            tuesday.GetProperty("targets").GetProperty("fat").GetInt32());
    }

    [Fact]
    public async Task Floor_is_stored_when_the_deficit_would_pass_bmr()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("floor");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-24", """{"kg":83.6,"timeZone":"UTC"}""");
        var saved = await TestData.PutProfile(client, TestData.Profile(rateKgPerWeek: 1.0m));
        var targets = saved.GetProperty("targets");
        Assert.True(targets.GetProperty("floorApplied").GetBoolean());
        Assert.Equal(targets.GetProperty("bmr").GetInt32(), targets.GetProperty("kcal").GetInt32());
    }

    [Fact]
    public async Task Preview_uses_the_server_weight_and_does_not_write_history()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("preview");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-24", """{"kg":83.6,"timeZone":"UTC"}""");

        var response = await client.PostAsJsonAsync("/api/targets/preview", TestData.Profile(goal: "gain"));
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(3318, body.GetProperty("kcal").GetInt32());
        Assert.Equal(0, await HistoryCount(user));
    }

    [Fact]
    public async Task Weekly_recalculation_runs_on_Monday_and_is_idempotent()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 26, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("weekly");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-26", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());

        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 26, 9, 0, 0, TimeSpan.Zero);
        Assert.Equal(1, await HistoryCount(user));
        Assert.True(await RunWeekly() >= 1);
        Assert.Equal(2, await HistoryCount(user));
        Assert.Equal(0, await RunWeekly());
        Assert.Equal(2, await HistoryCount(user));

        var monday = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-10-26");
        Assert.Equal(TargetReasons.WeeklyRecalculation, monday.GetProperty("targets").GetProperty("reason").GetString());
        Assert.Equal(2218, monday.GetProperty("targets").GetProperty("kcal").GetInt32());

        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 27, 9, 0, 0, TimeSpan.Zero);
        Assert.Equal(0, await RunWeekly());
        var stillMonday = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-10-26");
        Assert.Equal(TargetReasons.WeeklyRecalculation, stillMonday.GetProperty("targets").GetProperty("reason").GetString());
    }

    [Fact]
    public async Task A_missed_Monday_is_written_on_the_day_the_job_actually_runs()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 25, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("missed-monday");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-25", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());

        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 28, 9, 0, 0, TimeSpan.Zero);
        Assert.True(await RunWeekly() >= 1);
        Assert.Equal(0, await RunWeekly());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var weekly = await db.TargetHistories.SingleAsync(
            row => row.UserId == user && row.Reason == TargetReasons.WeeklyRecalculation);
        Assert.Equal(new DateOnly(2026, 10, 28), weekly.EffectiveDate);
        Assert.Equal(83.60m, weekly.WeightKg);

        var monday = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-10-26");
        Assert.Equal(TargetReasons.ProfileChange, monday.GetProperty("targets").GetProperty("reason").GetString());
        var wednesday = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-10-28");
        Assert.Equal(TargetReasons.WeeklyRecalculation, wednesday.GetProperty("targets").GetProperty("reason").GetString());
        Assert.Equal("2026-10-28", wednesday.GetProperty("targets").GetProperty("effectiveDate").GetString());
    }

    [Fact]
    public async Task Two_weigh_ins_still_feed_the_weekly_target_while_the_trend_stays_hidden()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 26, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("sparse");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-25", """{"kg":80,"timeZone":"UTC"}""");
        await TestData.PutWeighIn(client, "2026-10-26", """{"kg":90,"timeZone":"UTC"}""");
        var saved = await TestData.PutProfile(client, TestData.Profile());
        Assert.False(saved.GetProperty("weight").GetProperty("trendVisible").GetBoolean());
        Assert.Equal("trend", saved.GetProperty("weight").GetProperty("source").GetString());
        Assert.Equal(81.00m, saved.GetProperty("targets").GetProperty("weightKg").GetDecimal());

        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 2, 9, 0, 0, TimeSpan.Zero);
        Assert.True(await RunWeekly() >= 1);
        var next = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-11-02");
        Assert.Equal(TargetReasons.WeeklyRecalculation, next.GetProperty("targets").GetProperty("reason").GetString());
        Assert.Equal(81.00m, next.GetProperty("targets").GetProperty("weightKg").GetDecimal());
        Assert.Equal("2026-11-02", next.GetProperty("targets").GetProperty("effectiveDate").GetString());
    }

    private async Task<int> HistoryCount(string userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.TargetHistories.CountAsync(row => row.UserId == userId);
    }

    private async Task<int> RunWeekly()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var job = scope.ServiceProvider.GetRequiredService<WeeklyTargetRecalculator>();
        return await job.RunAsync(CancellationToken.None);
    }
}
