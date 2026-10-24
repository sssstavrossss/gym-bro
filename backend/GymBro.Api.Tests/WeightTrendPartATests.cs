using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Endpoints;
using GymBro.Api.Nutrition;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class WeightTrendPartATests(ApiFactory factory)
{
    private static readonly decimal[] PrototypeWeights =
    [
        85.0m, 84.7m, 85.1m, 84.8m, 84.9m, 84.6m,
        84.8m, 84.6m, 84.9m, 84.4m, 84.7m, 84.5m, 84.2m, 84.5m, 84.1m, 84.3m, 84.0m, 83.9m, 84.1m, 84.3m, 83.8m,
        83.8m, 84.0m, 84.2m, 83.8m, 83.6m, 84.0m, 83.3m, 83.8m, 83.3m, 83.2m, 83.1m, 83.2m, 83.4m, 82.9m, 83.3m,
    ];

    [Fact]
    public async Task Prototype_36_day_dataset_returns_trend_83_60_and_worked_example_targets()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("prototype");
        using var client = factory.AsUser(user);
        var start = new DateOnly(2026, 9, 19);
        for (var i = 0; i < PrototypeWeights.Length; i++)
        {
            var date = start.AddDays(i);
            // Decision 35.11: a new weigh-in has to be recorded inside the last 7 days,
            // so the dataset is entered on each of its own days.
            factory.Clock.UtcNow = new DateTimeOffset(date.ToDateTime(new TimeOnly(8, 0)), TimeSpan.Zero);
            await TestData.PutWeighIn(client, date.ToString("yyyy-MM-dd"), WeighIn(PrototypeWeights[i]));
        }

        var trend = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend?date=2026-10-24");
        Assert.Equal(83.60m, trend.GetProperty("trendKg").GetDecimal());
        Assert.Equal(TrendWeight.Normal, trend.GetProperty("trendState").GetString());
        Assert.Equal(0, trend.GetProperty("reasons").GetArrayLength());
        Assert.Equal(83.3m, trend.GetProperty("latestKg").GetDecimal());
        Assert.False(trend.GetProperty("goalReached").GetBoolean());

        var saved = await TestData.PutProfile(client, TestData.Profile());
        Assert.Equal(83.60m, saved.GetProperty("weight").GetProperty("trendKg").GetDecimal());
        Assert.Equal(83.60m, saved.GetProperty("weight").GetProperty("usedKg").GetDecimal());
        Assert.Equal(83.60m, saved.GetProperty("targets").GetProperty("weightKg").GetDecimal());
        var targets = saved.GetProperty("targets");
        Assert.Equal(1786, targets.GetProperty("bmr").GetInt32());
        Assert.Equal(2768, targets.GetProperty("tdee").GetInt32());
        Assert.Equal(2218, targets.GetProperty("kcal").GetInt32());
        Assert.Equal(167, targets.GetProperty("protein").GetInt32());
        Assert.Equal(62, targets.GetProperty("fat").GetInt32());
        Assert.Equal(249, targets.GetProperty("carbs").GetInt32());

        var chart = await client.GetFromJsonAsync<JsonElement>("/api/weight/chart?date=2026-10-24&days=30");
        Assert.Equal(30, chart.GetProperty("series").GetArrayLength());
        Assert.Equal(83.60m, chart.GetProperty("trendKg").GetDecimal());
        var last = chart.GetProperty("series")[29];
        Assert.Equal("2026-10-24", last.GetProperty("date").GetString());
        Assert.True(last.GetProperty("realWeighIn").GetBoolean());
        Assert.False(last.GetProperty("estimated").GetBoolean());
        Assert.Equal(83.3m, last.GetProperty("weighInKg").GetDecimal());
    }

    [Fact]
    public async Task Setup_current_weight_is_the_first_weigh_in_and_targets_are_calculated_immediately()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("setup-trend");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-24", WeighIn(83.6m));
        var saved = await TestData.PutProfile(client, TestData.Profile());

        var weight = saved.GetProperty("weight");
        Assert.Equal(83.60m, weight.GetProperty("trendKg").GetDecimal());
        Assert.Equal(TrendWeight.LowAccuracy, weight.GetProperty("trendState").GetString());
        Assert.Equal(TrendWeight.FewerThanTwoWeighInsInSevenDays, weight.GetProperty("reasons")[0].GetString());
        Assert.Equal("trend", weight.GetProperty("source").GetString());
        Assert.Equal(2218, saved.GetProperty("targets").GetProperty("kcal").GetInt32());
        Assert.Equal(1786, saved.GetProperty("targets").GetProperty("bmr").GetInt32());
        Assert.False(weight.GetProperty("goalReached").GetBoolean());

        var listed = await client.GetFromJsonAsync<JsonElement>("/api/weigh-ins");
        Assert.Equal(1, listed.GetProperty("weighIns").GetArrayLength());
        Assert.Equal("2026-10-24", listed.GetProperty("weighIns")[0].GetProperty("localDate").GetString());
        Assert.Equal(83.6m, listed.GetProperty("weighIns")[0].GetProperty("kg").GetDecimal());
    }

    [Fact]
    public async Task Consecutive_80_then_90_is_normal_and_one_weigh_in_in_seven_days_is_low_accuracy()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("eighty-ninety");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-23", WeighIn(80m));
        var early = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend?date=2026-10-23");
        Assert.Equal(TrendWeight.LowAccuracy, early.GetProperty("trendState").GetString());

        await TestData.PutWeighIn(client, "2026-10-24", WeighIn(90m, confirm: true));
        var trend = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend?date=2026-10-24");
        Assert.Equal(81.00m, trend.GetProperty("trendKg").GetDecimal());
        Assert.Equal(TrendWeight.Normal, trend.GetProperty("trendState").GetString());
        Assert.Equal(0, trend.GetProperty("reasons").GetArrayLength());
        Assert.Equal(2, trend.GetProperty("weighInsInWindow").GetInt32());

        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 30, 8, 0, 0, TimeSpan.Zero);
        var later = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.Equal(81.00m, later.GetProperty("trendKg").GetDecimal());
        Assert.Equal(1, later.GetProperty("weighInsInWindow").GetInt32());
        Assert.Equal(TrendWeight.LowAccuracy, later.GetProperty("trendState").GetString());
        Assert.Equal(TrendWeight.FewerThanTwoWeighInsInSevenDays, later.GetProperty("reasons")[0].GetString());
    }

    [Fact]
    public async Task Three_day_gap_chart_flags_real_weigh_ins_and_estimated_days()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("gap-3");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-21", WeighIn(80m));
        await TestData.PutWeighIn(client, "2026-10-24", WeighIn(83m));

        var chart = await client.GetFromJsonAsync<JsonElement>("/api/weight/chart?date=2026-10-24&days=4");
        var series = chart.GetProperty("series");
        Assert.Equal(4, series.GetArrayLength());
        AssertPoint(series[0], "2026-10-21", 80.00m, real: true, weighIn: 80m);
        AssertPoint(series[1], "2026-10-22", 80.10m, real: false, reading: 81m);
        AssertPoint(series[2], "2026-10-23", 80.29m, real: false, reading: 82m);
        AssertPoint(series[3], "2026-10-24", 80.56m, real: true, weighIn: 83m);
    }

    [Fact]
    public async Task Twenty_eight_day_gap_is_interpolated_and_twenty_nine_day_gap_fresh_start_accepts_or_declines()
    {
        var interpolatedUser = TestData.NewUser("gap-28");
        using var interpolated = factory.AsUser(interpolatedUser);
        factory.Clock.UtcNow = new DateTimeOffset(2026, 9, 1, 8, 0, 0, TimeSpan.Zero);
        await TestData.PutWeighIn(interpolated, "2026-09-01", WeighIn(80m));
        factory.Clock.UtcNow = new DateTimeOffset(2026, 9, 29, 8, 0, 0, TimeSpan.Zero);
        await TestData.PutWeighIn(interpolated, "2026-09-29", WeighIn(83m));
        var held = await interpolated.GetFromJsonAsync<JsonElement>("/api/weight/trend?date=2026-09-29");
        Assert.NotEqual(TrendWeight.FreshStartState, held.GetProperty("trendState").GetString());
        Assert.Equal(JsonValueKind.Null, held.GetProperty("freshStart").ValueKind);
        Assert.NotEqual(83.00m, held.GetProperty("trendKg").GetDecimal());
        Assert.Equal(TrendWeight.LowAccuracy, held.GetProperty("trendState").GetString());

        factory.Clock.UtcNow = new DateTimeOffset(2026, 9, 1, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("gap-29");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-09-01", WeighIn(80m));
        await TestData.PutProfile(client, TestData.Profile(goalWeightKg: 70));
        var before = await History(user);

        factory.Clock.UtcNow = new DateTimeOffset(2026, 9, 30, 8, 0, 0, TimeSpan.Zero);
        await TestData.PutWeighIn(client, "2026-09-30", WeighIn(90m, confirm: true));
        var fresh = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.Equal(90.00m, fresh.GetProperty("trendKg").GetDecimal());
        Assert.Equal(TrendWeight.FreshStartState, fresh.GetProperty("trendState").GetString());
        Assert.Contains(TrendWeight.FewerThanTwoWeighInsInSevenDays, Reasons(fresh));
        var info = fresh.GetProperty("freshStart");
        Assert.Equal(29, info.GetProperty("daysSincePrevious").GetInt32());
        Assert.Equal(4, info.GetProperty("weeksSincePrevious").GetInt32());
        Assert.Equal("2026-09-01", info.GetProperty("previousDate").GetString());
        Assert.True(info.GetProperty("recalculatePending").GetBoolean());
        var chart = await client.GetFromJsonAsync<JsonElement>("/api/weight/chart?date=2026-09-30&days=30");
        Assert.True(chart.GetProperty("series")[1].GetProperty("gap").GetBoolean());
        Assert.Equal(JsonValueKind.Null, chart.GetProperty("series")[1].GetProperty("trendKg").ValueKind);
        Assert.False(chart.GetProperty("series")[29].GetProperty("gap").GetBoolean());
        Assert.Equal(90.00m, chart.GetProperty("series")[29].GetProperty("trendKg").GetDecimal());

        var declined = await client.PostAsJsonAsync("/api/weight/fresh-start", new { accept = false });
        Assert.Equal(HttpStatusCode.OK, declined.StatusCode);
        var declinedBody = await declined.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(declinedBody.GetProperty("accepted").GetBoolean());
        Assert.False(declinedBody.GetProperty("wrote").GetBoolean());
        AssertSame(before, await History(user));

        var accepted = await client.PostAsJsonAsync("/api/weight/fresh-start", new { accept = true });
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        var acceptedBody = await accepted.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(acceptedBody.GetProperty("wrote").GetBoolean());
        Assert.Equal(TargetReasons.FreshStart, acceptedBody.GetProperty("targets").GetProperty("reason").GetString());
        Assert.Equal(
            TargetReasons.FreshStart,
            acceptedBody.GetProperty("targets").GetProperty("reasons")[0].GetString());
        Assert.Equal("2026-09-30", acceptedBody.GetProperty("targets").GetProperty("effectiveDate").GetString());
        Assert.Equal(90.00m, acceptedBody.GetProperty("targets").GetProperty("weightKg").GetDecimal());

        var after = await History(user);
        Assert.Equal(2, after.Count);
        Assert.Equal(before[0], after[0]);
        Assert.Equal(TargetReasons.FreshStart, after[1].Reasons);
        Assert.Equal(new DateOnly(2026, 9, 30), after[1].EffectiveDate);

        var again = await client.PostAsJsonAsync("/api/weight/fresh-start", new { accept = true });
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        var upserted = await History(user);
        Assert.Equal(2, upserted.Count);
        Assert.Equal(after[1].Id, upserted[1].Id);
        Assert.Equal(TargetReasons.FreshStart, upserted[1].Reasons);

        var pending = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.False(pending.GetProperty("freshStart").GetProperty("recalculatePending").GetBoolean());
        Assert.Equal(TrendWeight.FreshStartState, pending.GetProperty("trendState").GetString());
    }

    [Fact]
    public async Task Fresh_start_accept_merges_into_the_target_row_already_written_today()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 9, 1, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("merge-today");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-09-01", WeighIn(80m));
        await TestData.PutProfile(client, TestData.Profile());

        factory.Clock.UtcNow = new DateTimeOffset(2026, 9, 30, 8, 0, 0, TimeSpan.Zero);
        await TestData.PutWeighIn(client, "2026-09-30", WeighIn(90m, confirm: true));
        await TestData.PutProfile(client, TestData.Profile(fatSetting: "more", fatPercent: 30));
        var before = await History(user);
        Assert.Equal(2, before.Count);
        Assert.Equal(TargetReasons.MacroBalanceChange, before[1].Reasons);
        Assert.Equal(new DateOnly(2026, 9, 30), before[1].EffectiveDate);

        var accepted = await client.PostAsJsonAsync("/api/weight/fresh-start", new { accept = true });
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        var acceptedBody = await accepted.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(TargetReasons.FreshStart, acceptedBody.GetProperty("targets").GetProperty("reason").GetString());
        var mergedReasons = acceptedBody.GetProperty("targets").GetProperty("reasons").EnumerateArray().Select(item => item.GetString()!).ToArray();
        Assert.Equal([TargetReasons.MacroBalanceChange, TargetReasons.FreshStart], mergedReasons);
        var after = await History(user);
        Assert.Equal(2, after.Count);
        Assert.Equal(before[0], after[0]);
        Assert.Equal(before[1].Id, after[1].Id);
        Assert.Equal($"{TargetReasons.MacroBalanceChange},{TargetReasons.FreshStart}", after[1].Reasons);
        Assert.Equal(90.00m, after[1].WeightKg);
        Assert.Equal(before[1].FatGrams, after[1].FatGrams);
        Assert.Equal(before[1].Kcal, after[1].Kcal);
    }

    [Fact]
    public async Task Typo_guard_with_trend_83_6_asks_for_38_6_and_86_7_and_saves_86_5()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 25, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("typo");
        using var client = factory.AsUser(user);
        var first = await client.PutAsync("/api/weigh-ins/2026-10-24", Json(WeighIn(38.6m)));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        // The only weigh-in can be edited (35.2) but not deleted, so replace it in place.
        await TestData.PutWeighIn(client, "2026-10-24", WeighIn(83.6m));
        var tooLow = await client.PutAsync("/api/weigh-ins/2026-10-25", Json(WeighIn(38.6m)));
        await AssertConfirm(tooLow, 38.6m, 83.60m);
        var tooHigh = await client.PutAsync("/api/weigh-ins/2026-10-25", Json(WeighIn(86.7m)));
        await AssertConfirm(tooHigh, 86.7m, 83.60m);
        Assert.Equal(1, (await client.GetFromJsonAsync<JsonElement>("/api/weigh-ins")).GetProperty("weighIns").GetArrayLength());

        var saved = await client.PutAsync("/api/weigh-ins/2026-10-25", Json(WeighIn(86.5m)));
        Assert.Equal(HttpStatusCode.Created, saved.StatusCode);

        var editFar = await client.PutAsync("/api/weigh-ins/2026-10-25", Json(WeighIn(86.7m)));
        await AssertConfirm(editFar, 86.7m, 83.60m);
        var listed = await client.GetFromJsonAsync<JsonElement>("/api/weigh-ins?from=2026-10-25&to=2026-10-25");
        Assert.Equal(86.5m, listed.GetProperty("weighIns")[0].GetProperty("kg").GetDecimal());

        var boundary = await client.PutAsync("/api/weigh-ins/2026-10-25", Json(WeighIn(86.6m)));
        Assert.Equal(HttpStatusCode.OK, boundary.StatusCode);

        var confirmed = await client.PutAsync("/api/weigh-ins/2026-10-25", Json("""{"kg":38.6,"timeZone":"UTC","confirm":true}"""));
        Assert.Equal(HttpStatusCode.OK, confirmed.StatusCode);
        var replaced = await client.GetFromJsonAsync<JsonElement>("/api/weigh-ins?from=2026-10-25&to=2026-10-25");
        Assert.Equal(38.6m, replaced.GetProperty("weighIns")[0].GetProperty("kg").GetDecimal());
    }

    [Fact]
    public async Task Back_dated_weigh_in_in_a_gap_changes_todays_trend_and_leaves_target_history()
    {
        var user = TestData.NewUser("backdate");
        using var client = factory.AsUser(user);
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 1, 8, 0, 0, TimeSpan.Zero);
        await TestData.PutWeighIn(client, "2026-10-01", WeighIn(80m));
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 11, 8, 0, 0, TimeSpan.Zero);
        await TestData.PutWeighIn(client, "2026-10-11", WeighIn(86m, confirm: true));
        await TestData.PutProfile(client, TestData.Profile());
        var historyBefore = await History(user);
        var trendBefore = (await client.GetFromJsonAsync<JsonElement>("/api/weight/trend")).GetProperty("trendKg").GetDecimal();
        var chartBefore = await client.GetFromJsonAsync<JsonElement>("/api/weight/chart?date=2026-10-11&days=11");
        var gapDay = chartBefore.GetProperty("series")[5];
        Assert.Equal("2026-10-06", gapDay.GetProperty("date").GetString());
        Assert.False(gapDay.GetProperty("realWeighIn").GetBoolean());
        Assert.True(gapDay.GetProperty("estimated").GetBoolean());

        var inserted = await client.PutAsync("/api/weigh-ins/2026-10-06", Json("""{"kg":82.0,"timeZone":"UTC","confirm":true}"""));
        Assert.Equal(HttpStatusCode.Created, inserted.StatusCode);

        var trendAfter = (await client.GetFromJsonAsync<JsonElement>("/api/weight/trend")).GetProperty("trendKg").GetDecimal();
        Assert.NotEqual(trendBefore, trendAfter);
        var chartAfter = await client.GetFromJsonAsync<JsonElement>("/api/weight/chart?date=2026-10-11&days=11");
        var filled = chartAfter.GetProperty("series")[5];
        Assert.True(filled.GetProperty("realWeighIn").GetBoolean());
        Assert.Equal(82.0m, filled.GetProperty("weighInKg").GetDecimal());
        Assert.NotEqual(
            chartBefore.GetProperty("series")[10].GetProperty("trendKg").GetDecimal(),
            chartAfter.GetProperty("series")[10].GetProperty("trendKg").GetDecimal());
        AssertSame(historyBefore, await History(user));
    }

    [Fact]
    public async Task Deleting_a_weigh_in_matches_never_having_entered_it()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var userA = TestData.NewUser("delete-a");
        var userB = TestData.NewUser("delete-b");
        using var clientA = factory.AsUser(userA);
        using var clientB = factory.AsUser(userB);
        await TestData.PutWeighIn(clientA, "2026-10-21", WeighIn(80m));
        await TestData.PutWeighIn(clientA, "2026-10-24", WeighIn(83m));
        await TestData.PutWeighIn(clientB, "2026-10-21", WeighIn(80m));
        await TestData.PutWeighIn(clientB, "2026-10-24", WeighIn(83m));
        var before = await clientA.GetFromJsonAsync<JsonElement>("/api/weight/chart?date=2026-10-24&days=4");

        await TestData.PutWeighIn(clientA, "2026-10-22", """{"kg":90,"timeZone":"UTC","confirm":true}""");
        var changed = (await clientA.GetFromJsonAsync<JsonElement>("/api/weight/trend")).GetProperty("trendKg").GetDecimal();
        Assert.NotEqual(before.GetProperty("trendKg").GetDecimal(), changed);

        var removed = await clientA.DeleteAsync("/api/weigh-ins/2026-10-22");
        Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);
        var after = await clientA.GetFromJsonAsync<JsonElement>("/api/weight/chart?date=2026-10-24&days=4");
        var other = await clientB.GetFromJsonAsync<JsonElement>("/api/weight/chart?date=2026-10-24&days=4");
        Assert.Equal(before.GetProperty("trendKg").GetDecimal(), after.GetProperty("trendKg").GetDecimal());
        Assert.Equal(before.GetProperty("series").ToString(), after.GetProperty("series").ToString());
        Assert.Equal(other.GetProperty("series").ToString(), after.GetProperty("series").ToString());
        Assert.Equal(80.56m, after.GetProperty("trendKg").GetDecimal());
    }

    [Fact]
    public async Task Goal_reached_follows_the_latest_real_weigh_in_and_changes_nothing()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("goal-reached");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-24", WeighIn(83.6m));
        await TestData.PutProfile(client, TestData.Profile(goal: "lose", goalWeightKg: 84));

        var onWeighIn = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend?date=2026-10-24");
        Assert.True(onWeighIn.GetProperty("goalReached").GetBoolean());
        var carried = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend?date=2026-10-25");
        Assert.Equal(83.60m, carried.GetProperty("trendKg").GetDecimal());
        // Decision 35.10: the card is only on the weigh-in's own day.
        Assert.False(carried.GetProperty("goalReached").GetBoolean());

        var profile = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal("lose", profile.GetProperty("profile").GetProperty("goal").GetString());
        Assert.True(profile.GetProperty("weight").GetProperty("goalReached").GetBoolean());

        await TestData.PutProfile(client, TestData.Profile(goal: "lose", goalWeightKg: 80));
        var notYet = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend?date=2026-10-24");
        Assert.False(notYet.GetProperty("goalReached").GetBoolean());

        await TestData.PutProfile(client, TestData.Profile(goal: "gain", goalWeightKg: 80, rateKgPerWeek: 0.5m));
        var gain = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend?date=2026-10-24");
        Assert.True(gain.GetProperty("goalReached").GetBoolean());
        var gainCarried = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend?date=2026-10-23");
        Assert.False(gainCarried.GetProperty("goalReached").GetBoolean());

        await TestData.PutProfile(client, TestData.Profile(goal: "maintain", rateKgPerWeek: null, goalWeightKg: 83.6m));
        var maintain = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend?date=2026-10-24");
        Assert.False(maintain.GetProperty("goalReached").GetBoolean());
        var still = await client.GetFromJsonAsync<JsonElement>("/api/profile");
        Assert.Equal("maintain", still.GetProperty("profile").GetProperty("goal").GetString());
    }

    [Fact]
    public async Task One_users_weigh_ins_do_not_affect_anothers_trend()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var userA = TestData.NewUser("trend-a");
        var userB = TestData.NewUser("trend-b");
        using var clientA = factory.AsUser(userA);
        using var clientB = factory.AsUser(userB);

        await TestData.PutWeighIn(clientA, "2026-10-23", WeighIn(80m));
        await TestData.PutWeighIn(clientA, "2026-10-24", WeighIn(90m, confirm: true));
        await TestData.PutProfile(clientA, TestData.Profile());
        var trendA = await clientA.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.Equal(81.00m, trendA.GetProperty("trendKg").GetDecimal());

        await TestData.PutWeighIn(clientB, "2026-10-24", WeighIn(70m));
        var trendB = await clientB.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.Equal(70.00m, trendB.GetProperty("trendKg").GetDecimal());
        Assert.Equal(TrendWeight.LowAccuracy, trendB.GetProperty("trendState").GetString());
        var chartB = await clientB.GetFromJsonAsync<JsonElement>("/api/weight/chart?days=7");
        Assert.DoesNotContain("81", chartB.GetProperty("series").ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain("90", chartB.GetProperty("series").ToString(), StringComparison.Ordinal);

        Assert.Equal(HttpStatusCode.NotFound, (await clientB.DeleteAsync("/api/weigh-ins/2026-10-23")).StatusCode);
        var stillA = await clientA.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.Equal(81.00m, stillA.GetProperty("trendKg").GetDecimal());
        var targetsB = await clientB.GetFromJsonAsync<JsonElement>("/api/targets");
        Assert.Equal(JsonValueKind.Null, targetsB.GetProperty("targets").ValueKind);

        var declineB = await clientB.PostAsJsonAsync("/api/weight/fresh-start", new { accept = false });
        Assert.Equal(HttpStatusCode.BadRequest, declineB.StatusCode);
        Assert.Single(await History(userA));
    }

    [Fact]
    public async Task Long_gap_still_asks_the_typo_guard_before_the_fresh_start_saves()
    {
        var user = TestData.NewUser("typo-gap");
        using var client = factory.AsUser(user);
        factory.Clock.UtcNow = new DateTimeOffset(2026, 9, 1, 8, 0, 0, TimeSpan.Zero);
        await TestData.PutWeighIn(client, "2026-09-01", WeighIn(80m));
        factory.Clock.UtcNow = new DateTimeOffset(2026, 9, 30, 8, 0, 0, TimeSpan.Zero);
        var asked = await client.PutAsync("/api/weigh-ins/2026-09-30", Json(WeighIn(90m)));
        // 29 days is 4 full weeks: the threshold is 7 kg, and 90 is still past it.
        await AssertConfirm(asked, 90.0m, 80.00m, 7.0m);
        Assert.Equal(1, (await client.GetFromJsonAsync<JsonElement>("/api/weigh-ins")).GetProperty("weighIns").GetArrayLength());
    }

    [Fact]
    public async Task Deleting_the_only_weigh_in_is_blocked_and_the_trend_stays()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("delete-only");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-24", WeighIn(83.6m));
        var removed = await client.DeleteAsync("/api/weigh-ins/2026-10-24");
        Assert.Equal(HttpStatusCode.Conflict, removed.StatusCode);
        var body = await removed.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(WeighInEndpoints.OnlyWeighIn, body.GetProperty("code").GetString());
        Assert.NotEqual(WeighInEndpoints.ConfirmWeighIn, body.GetProperty("code").GetString());
        var trend = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.Equal(83.60m, trend.GetProperty("trendKg").GetDecimal());
    }

    [Fact]
    public async Task Back_dated_weigh_in_that_closes_a_fresh_start_leaves_the_target_row()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 9, 1, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("close-gap");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-09-01", WeighIn(80m));
        await TestData.PutProfile(client, TestData.Profile(goalWeightKg: 70));
        factory.Clock.UtcNow = new DateTimeOffset(2026, 9, 30, 8, 0, 0, TimeSpan.Zero);
        await TestData.PutWeighIn(client, "2026-09-30", WeighIn(90m, confirm: true));
        var accepted = await client.PostAsJsonAsync("/api/weight/fresh-start", new { accept = true });
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        var written = await History(user);
        var freshRow = written[^1];
        Assert.Equal(TargetReasons.FreshStart, freshRow.Reasons);

        // 35.11: today − 10 is rejected, so the closing weigh-in is today − 7 (22-day and 7-day gaps).
        await TestData.PutWeighIn(client, "2026-09-23", WeighIn(85m, confirm: true));
        var closed = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.NotEqual(TrendWeight.FreshStartState, closed.GetProperty("trendState").GetString());
        var after = await History(user);
        Assert.Contains(after, row => row.Id == freshRow.Id && row.Reasons == TargetReasons.FreshStart && row.Kcal == freshRow.Kcal);
    }

    private static void AssertSame(IReadOnlyList<HistoryRow> before, IReadOnlyList<HistoryRow> after)
    {
        Assert.Equal(before.Count, after.Count);
        for (var i = 0; i < before.Count; i++)
        {
            Assert.Equal(before[i], after[i]);
        }
    }

    private static void AssertPoint(JsonElement point, string date, decimal trend, bool real, decimal? weighIn = null, decimal? reading = null)
    {
        Assert.Equal(date, point.GetProperty("date").GetString());
        Assert.Equal(trend, point.GetProperty("trendKg").GetDecimal());
        Assert.Equal(real, point.GetProperty("realWeighIn").GetBoolean());
        Assert.Equal(!real, point.GetProperty("estimated").GetBoolean());
        if (weighIn is decimal kg)
        {
            Assert.Equal(kg, point.GetProperty("weighInKg").GetDecimal());
        }
        else
        {
            Assert.Equal(JsonValueKind.Null, point.GetProperty("weighInKg").ValueKind);
        }

        if (reading is decimal line)
        {
            Assert.Equal(line, point.GetProperty("readingKg").GetDecimal());
        }
    }

    private static async Task AssertConfirm(HttpResponseMessage response, decimal kg, decimal previousTrend, decimal limitKg = 3.0m)
    {
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(WeighInEndpoints.ConfirmWeighIn, body.GetProperty("code").GetString());
        var culture = CultureInfo.InvariantCulture;
        var difference = kg - previousTrend;
        var direction = difference < 0 ? "below" : "above";
        var shownDifference = decimal.Round(Math.Abs(difference), 1, MidpointRounding.AwayFromZero).ToString("0.0", culture);
        var shownTrend = decimal.Round(previousTrend, 1, MidpointRounding.AwayFromZero).ToString("0.0", culture);
        var error = body.GetProperty("error").GetString();
        Assert.Equal($"Is {kg.ToString("0.0", culture)} kg right? That's {shownDifference} kg {direction} your trend ({shownTrend} kg). Nothing is saved until you choose.", error);
        Assert.DoesNotContain(previousTrend.ToString("0.00", culture), error);
        Assert.Equal(kg, body.GetProperty("kg").GetDecimal());
        Assert.Equal(previousTrend, body.GetProperty("previousTrendKg").GetDecimal());
        Assert.Equal(limitKg, body.GetProperty("limitKg").GetDecimal());
    }

    private static List<string> Reasons(JsonElement trend)
    {
        var reasons = new List<string>();
        foreach (var reason in trend.GetProperty("reasons").EnumerateArray())
        {
            reasons.Add(reason.GetString()!);
        }

        return reasons;
    }

    private async Task<List<HistoryRow>> History(string userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.TargetHistories.AsNoTracking()
            .Where(row => row.UserId == userId)
            .OrderBy(row => row.EffectiveDate)
            .ThenBy(row => row.Id)
            .Select(row => new HistoryRow(
                row.Id,
                row.EffectiveDate,
                string.Join(",", row.Reasons),
                row.WeightKg,
                row.Kcal,
                row.Bmr,
                row.ProteinGrams,
                row.FatGrams,
                row.CarbGrams))
            .ToListAsync();
    }

    private static string WeighIn(decimal kg, bool confirm = false)
    {
        var number = kg.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var flag = confirm ? ",\"confirm\":true" : "";
        return $$"""{"kg":{{number}},"timeZone":"UTC"{{flag}}}""";
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private sealed record HistoryRow(
        long Id,
        DateOnly EffectiveDate,
        string Reasons,
        decimal WeightKg,
        int Kcal,
        int Bmr,
        int ProteinGrams,
        int FatGrams,
        int CarbGrams);
}
