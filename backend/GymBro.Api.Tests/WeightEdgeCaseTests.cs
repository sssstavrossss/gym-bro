using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Endpoints;
using GymBro.Api.Hosting;
using GymBro.Api.Nutrition;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

/// <summary>Decision 35. Each test is named with its check id.</summary>
[Collection(ApiCollection.Name)]
public sealed class WeightEdgeCaseTests(ApiFactory factory)
{
    [Fact(DisplayName = "35.1a")]
    public async Task Check_35_1a()
    {
        var today = new DateOnly(2026, 10, 24);
        var user = TestData.NewUser("35-1a");
        using var client = factory.AsUser(user);
        await PutOn(client, today.AddDays(-15), 83.6m);
        On(today);

        var trend = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.Equal(83.60m, trend.GetProperty("trendKg").GetDecimal());

        var asks = await client.PutAsync($"/api/weigh-ins/{today:yyyy-MM-dd}", Json(WeighIn(88.7m)));
        await AssertConfirm(asks, 88.7m, 83.60m, 5.0m);
        Assert.Equal(1, await Count(client));

        var saves = await client.PutAsync($"/api/weigh-ins/{today:yyyy-MM-dd}", Json(WeighIn(88.5m)));
        Assert.Equal(HttpStatusCode.Created, saves.StatusCode);
        Assert.Equal(88.5m, await KgOn(client, today));
    }

    [Fact(DisplayName = "35.1b")]
    public async Task Check_35_1b()
    {
        var today = new DateOnly(2026, 10, 24);
        var user = TestData.NewUser("35-1b");
        using var client = factory.AsUser(user);
        await PutOn(client, today.AddDays(-70), 83.6m);
        On(today);

        var trend = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.Equal(83.60m, trend.GetProperty("trendKg").GetDecimal());

        var asks = await client.PutAsync($"/api/weigh-ins/{today:yyyy-MM-dd}", Json(WeighIn(93.7m)));
        await AssertConfirm(asks, 93.7m, 83.60m, 10.0m);
        Assert.Equal(1, await Count(client));

        var saves = await client.PutAsync($"/api/weigh-ins/{today:yyyy-MM-dd}", Json(WeighIn(93.5m)));
        Assert.Equal(HttpStatusCode.Created, saves.StatusCode);
        Assert.Equal(93.5m, await KgOn(client, today));
    }

    [Fact(DisplayName = "35.1c")]
    public async Task Check_35_1c()
    {
        var today = new DateOnly(2026, 10, 24);
        var user = TestData.NewUser("35-1c");
        using var client = factory.AsUser(user);
        await PutOn(client, today.AddDays(-1), 83.6m);
        On(today);

        var saves = await client.PutAsync($"/api/weigh-ins/{today:yyyy-MM-dd}", Json(WeighIn(86.5m)));
        Assert.Equal(HttpStatusCode.Created, saves.StatusCode);

        var asks = await client.PutAsync($"/api/weigh-ins/{today:yyyy-MM-dd}", Json(WeighIn(86.7m)));
        await AssertConfirm(asks, 86.7m, 83.60m, 3.0m);
        Assert.Equal(86.5m, await KgOn(client, today));
    }

    [Fact(DisplayName = "35.2a")]
    public async Task Check_35_2a()
    {
        var today = new DateOnly(2026, 10, 24);
        var user = TestData.NewUser("35-2a");
        using var client = factory.AsUser(user);
        await PutOn(client, today, 83.6m);

        var listed = await client.GetFromJsonAsync<JsonElement>("/api/weigh-ins");
        Assert.False(listed.GetProperty("weighIns")[0].GetProperty("canDelete").GetBoolean());

        var removed = await client.DeleteAsync($"/api/weigh-ins/{today:yyyy-MM-dd}");
        Assert.Equal(HttpStatusCode.Conflict, removed.StatusCode);
        var body = await removed.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(WeighInEndpoints.OnlyWeighIn, body.GetProperty("code").GetString());
        Assert.NotEqual(WeighInEndpoints.ConfirmWeighIn, body.GetProperty("code").GetString());
        Assert.Equal(WeighInEndpoints.OnlyWeighInMessage, body.GetProperty("error").GetString());
        Assert.Equal(83.6m, await KgOn(client, today));
    }

    [Fact(DisplayName = "35.2b")]
    public async Task Check_35_2b()
    {
        var today = new DateOnly(2026, 10, 24);
        var user = TestData.NewUser("35-2b");
        using var client = factory.AsUser(user);
        await PutOn(client, today, 80m);

        var edited = await client.PutAsync($"/api/weigh-ins/{today:yyyy-MM-dd}", Json(WeighIn(90m)));
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
        var body = await edited.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(90.00m, body.GetProperty("trend").GetProperty("trendKg").GetDecimal());
        Assert.Equal(90m, await KgOn(client, today));

        var removed = await client.DeleteAsync($"/api/weigh-ins/{today:yyyy-MM-dd}");
        Assert.Equal(HttpStatusCode.Conflict, removed.StatusCode);
    }

    [Fact(DisplayName = "35.4a")]
    public async Task Check_35_4a()
    {
        var today = new DateOnly(2026, 10, 24);
        var previous = today.AddDays(-35);
        var bridging = today.AddDays(-7);
        var user = TestData.NewUser("35-4a");
        using var client = factory.AsUser(user);
        await PutOn(client, previous, 80m);
        await TestData.PutProfile(client, TestData.Profile(goalWeightKg: 70));
        On(today);
        await TestData.PutWeighIn(client, Iso(today), WeighIn(90m, confirm: true));

        var open = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.Equal(TrendWeight.FreshStartState, open.GetProperty("trendState").GetString());
        Assert.True(open.GetProperty("freshStart").GetProperty("recalculatePending").GetBoolean());
        Assert.Equal(35, open.GetProperty("freshStart").GetProperty("daysSincePrevious").GetInt32());

        var accepted = await client.PostAsJsonAsync("/api/weight/fresh-start", new { accept = true });
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        var freshRow = (await History(user))[^1];
        Assert.Equal(TargetReasons.FreshStart, freshRow.Reasons);

        var inserted = await client.PutAsync($"/api/weigh-ins/{Iso(bridging)}", Json(WeighIn(85m)));
        Assert.Equal(HttpStatusCode.Created, inserted.StatusCode);

        var closed = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.NotEqual(TrendWeight.FreshStartState, closed.GetProperty("trendState").GetString());
        Assert.Equal(JsonValueKind.Null, closed.GetProperty("freshStart").ValueKind);
        Assert.NotEqual(90.00m, closed.GetProperty("trendKg").GetDecimal());

        var chart = await client.GetFromJsonAsync<JsonElement>($"/api/weight/chart?date={Iso(today)}&days=40");
        var between = chart.GetProperty("series").EnumerateArray()
            .Single(point => point.GetProperty("date").GetString() == Iso(previous.AddDays(1)));
        Assert.False(between.GetProperty("gap").GetBoolean());
        Assert.NotEqual(JsonValueKind.Null, between.GetProperty("trendKg").ValueKind);

        var after = await History(user);
        Assert.Contains(after, row => row.Id == freshRow.Id && row.Reasons == TargetReasons.FreshStart && row.Kcal == freshRow.Kcal);
    }

    [Fact(DisplayName = "35.5a")]
    public async Task Check_35_5a()
    {
        var wednesday = new DateOnly(2026, 10, 21);
        var sunday = new DateOnly(2026, 10, 25);
        var monday = new DateOnly(2026, 10, 26);
        Assert.Equal(DayOfWeek.Wednesday, wednesday.DayOfWeek);
        Assert.Equal(DayOfWeek.Sunday, sunday.DayOfWeek);
        Assert.Equal(DayOfWeek.Monday, monday.DayOfWeek);

        var user = TestData.NewUser("35-5a");
        using var client = factory.AsUser(user);
        await PutOn(client, wednesday.AddDays(-35), 80m);
        await TestData.PutProfile(client, TestData.Profile(goalWeightKg: 70));
        On(wednesday);
        await TestData.PutWeighIn(client, Iso(wednesday), WeighIn(90m, confirm: true));

        var prompted = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.True(prompted.GetProperty("freshStart").GetProperty("recalculatePending").GetBoolean());

        On(sunday);
        var still = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.Equal(Iso(sunday), still.GetProperty("asOf").GetString());
        Assert.Equal(TrendWeight.FreshStartState, still.GetProperty("trendState").GetString());
        Assert.True(still.GetProperty("freshStart").GetProperty("recalculatePending").GetBoolean());

        On(monday);
        Assert.True(await RunWeekly() >= 1);
        var cleared = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.Equal(Iso(monday), cleared.GetProperty("asOf").GetString());
        Assert.Equal(TrendWeight.FreshStartState, cleared.GetProperty("trendState").GetString());
        Assert.False(cleared.GetProperty("freshStart").GetProperty("recalculatePending").GetBoolean());
        Assert.DoesNotContain(await History(user), row => row.Reasons.Contains(TargetReasons.FreshStart, StringComparison.Ordinal));
        Assert.Contains(await History(user), row => row.Reasons.Contains(TargetReasons.WeeklyRecalculation, StringComparison.Ordinal));
    }

    [Fact(DisplayName = "35.6a")]
    public async Task Check_35_6a()
    {
        var today = new DateOnly(2026, 10, 24);
        var anchor = today.AddDays(-2);
        var backDated = today.AddDays(-1);
        var user = TestData.NewUser("35-6a");
        using var client = factory.AsUser(user);
        await PutOn(client, anchor, 83.6m);
        On(today);
        await TestData.PutWeighIn(client, Iso(today), WeighIn(90m, confirm: true));

        var dayBefore = await client.GetFromJsonAsync<JsonElement>($"/api/weight/trend?date={Iso(anchor)}");
        var current = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.Equal(83.60m, dayBefore.GetProperty("trendKg").GetDecimal());
        Assert.NotEqual(dayBefore.GetProperty("trendKg").GetDecimal(), current.GetProperty("trendKg").GetDecimal());

        var asked = await client.PutAsync($"/api/weigh-ins/{Iso(backDated)}", Json(WeighIn(87m)));
        await AssertConfirm(asked, 87.0m, 83.60m, 3.0m);
        Assert.Equal(2, await Count(client));
    }

    [Fact(DisplayName = "35.6b")]
    public async Task Check_35_6b()
    {
        var first = new DateOnly(2026, 10, 1);
        var edited = first.AddDays(14);
        var today = edited.AddDays(6);
        var user = TestData.NewUser("35-6b");
        using var client = factory.AsUser(user);
        await PutOn(client, first, 70m);
        On(edited);
        await TestData.PutWeighIn(client, Iso(edited), WeighIn(83.6m, confirm: true));
        On(today);
        await TestData.PutWeighIn(client, Iso(today), WeighIn(90m, confirm: true));

        var todayTrend = (await client.GetFromJsonAsync<JsonElement>("/api/weight/trend")).GetProperty("trendKg").GetDecimal();
        Assert.NotEqual(70.00m, todayTrend);

        var within = await client.PutAsync($"/api/weigh-ins/{Iso(edited)}", Json(WeighIn(74.9m)));
        Assert.Equal(HttpStatusCode.OK, within.StatusCode);
        Assert.Equal(74.9m, await KgOn(client, edited));

        var asks = await client.PutAsync($"/api/weigh-ins/{Iso(edited)}", Json(WeighIn(75.1m)));
        await AssertConfirm(asks, 75.1m, 70.00m, 5.0m);
        Assert.Equal(74.9m, await KgOn(client, edited));
    }

    [Fact(DisplayName = "35.7a")]
    public async Task Check_35_7a()
    {
        var today = new DateOnly(2026, 10, 24);
        var user = TestData.NewUser("35-7a");
        using var client = factory.AsUser(user);
        On(today);
        var tomorrow = await client.PutAsync($"/api/weigh-ins/{Iso(today.AddDays(1))}", Json(WeighIn(80m)));
        Assert.Equal(HttpStatusCode.BadRequest, tomorrow.StatusCode);
        var body = await tomorrow.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("That date is in the future.", body.GetProperty("error").GetString());
        Assert.Equal(0, await Count(client));
    }

    [Fact(DisplayName = "35.7b")]
    public async Task Check_35_7b()
    {
        var today = new DateOnly(2026, 10, 24);
        var user = TestData.NewUser("35-7b");
        using var client = factory.AsUser(user);
        await PutOn(client, today.AddDays(-1), 83.6m);
        On(today);

        foreach (var kg in new[] { "29.9", "300.1" })
        {
            var rejected = await client.PutAsync($"/api/weigh-ins/{Iso(today)}", Json(WeighIn(kg)));
            Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        }

        foreach (var kg in new[] { 30.0m, 300.0m })
        {
            var guarded = await client.PutAsync($"/api/weigh-ins/{Iso(today)}", Json(WeighIn(kg)));
            Assert.Equal(HttpStatusCode.Conflict, guarded.StatusCode);
            var body = await guarded.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(WeighInEndpoints.ConfirmWeighIn, body.GetProperty("code").GetString());
        }

        Assert.Equal(1, await Count(client));
    }

    [Fact(DisplayName = "35.7c")]
    public async Task Check_35_7c()
    {
        var today = new DateOnly(2026, 10, 24);
        var setup = today.AddDays(-3);
        var before = today.AddDays(-5);
        var user = TestData.NewUser("35-7c");
        using var client = factory.AsUser(user);
        On(today);
        await TestData.PutWeighIn(client, Iso(setup), WeighIn(80m));

        var guarded = await client.PutAsync($"/api/weigh-ins/{Iso(before)}", Json(WeighIn(70m)));
        await AssertConfirm(guarded, 70.0m, 80.00m, 3.0m);

        var saved = await client.PutAsync($"/api/weigh-ins/{Iso(before)}", Json(WeighIn(70m, confirm: true)));
        Assert.Equal(HttpStatusCode.Created, saved.StatusCode);

        var chart = await client.GetFromJsonAsync<JsonElement>($"/api/weight/chart?date={Iso(today)}&days=10");
        var series = chart.GetProperty("series").EnumerateArray().ToList();
        var start = series.First(point => point.GetProperty("realWeighIn").GetBoolean());
        Assert.Equal(Iso(before), start.GetProperty("date").GetString());
        Assert.Equal(70.00m, start.GetProperty("trendKg").GetDecimal());
        Assert.NotEqual(80.00m, chart.GetProperty("trendKg").GetDecimal());
    }

    [Fact(DisplayName = "35.8a")]
    public async Task Check_35_8a()
    {
        var today = new DateOnly(2026, 10, 24);
        var earlier = today.AddDays(-4);
        var user = TestData.NewUser("35-8a");
        using var client = factory.AsUser(user);
        On(today);
        await TestData.PutWeighIn(client, Iso(today), WeighIn(90m));
        await TestData.PutProfile(client, TestData.Profile(goal: "lose", goalWeightKg: 80));

        var before = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.False(before.GetProperty("goalReached").GetBoolean());
        Assert.True(before.GetProperty("trendKg").GetDecimal() > 80m);

        await TestData.PutWeighIn(client, Iso(earlier), WeighIn(80m, confirm: true));
        var after = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.Equal(Iso(today), after.GetProperty("latestDate").GetString());
        Assert.False(after.GetProperty("goalReached").GetBoolean());

        var onTheBackDate = await client.GetFromJsonAsync<JsonElement>($"/api/weight/trend?date={Iso(earlier)}");
        Assert.True(onTheBackDate.GetProperty("goalReached").GetBoolean());
    }

    [Fact(DisplayName = "35.9a")]
    public async Task Check_35_9a()
    {
        var today = new DateOnly(2026, 10, 24);
        var previous = today.AddDays(-35);
        var user = TestData.NewUser("35-9a");
        using var client = factory.AsUser(user);
        await PutOn(client, previous, 80m);
        await TestData.PutProfile(client, TestData.Profile(goalWeightKg: 70));
        On(today);
        await TestData.PutWeighIn(client, Iso(today), WeighIn(90m, confirm: true));
        var accepted = await client.PostAsJsonAsync("/api/weight/fresh-start", new { accept = true });
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        var freshRow = (await History(user))[^1];
        Assert.Equal(TargetReasons.FreshStart, freshRow.Reasons);

        var removed = await client.DeleteAsync($"/api/weigh-ins/{Iso(today)}");
        Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);

        var closed = await client.GetFromJsonAsync<JsonElement>("/api/weight/trend");
        Assert.NotEqual(TrendWeight.FreshStartState, closed.GetProperty("trendState").GetString());
        Assert.Equal(JsonValueKind.Null, closed.GetProperty("freshStart").ValueKind);
        Assert.Equal(80.00m, closed.GetProperty("trendKg").GetDecimal());
        var after = await History(user);
        Assert.Contains(after, row => row.Id == freshRow.Id && row.Reasons == TargetReasons.FreshStart && row.Kcal == freshRow.Kcal);
    }

    [Fact(DisplayName = "35.10a")]
    public async Task Check_35_10a()
    {
        var day1 = new DateOnly(2026, 10, 20);
        var day2 = day1.AddDays(1);
        var day3 = day1.AddDays(2);
        var day4 = day1.AddDays(3);
        var day5 = day1.AddDays(4);
        var user = TestData.NewUser("35-10a");
        using var client = factory.AsUser(user);
        await PutOn(client, day1, 83.6m);
        await TestData.PutProfile(client, TestData.Profile(goal: "lose", goalWeightKg: 84));

        Assert.True((await TrendOn(client, day1)).GetProperty("goalReached").GetBoolean());
        On(day3);
        Assert.False((await TrendOn(client, day2)).GetProperty("goalReached").GetBoolean());
        Assert.False((await TrendOn(client, day3)).GetProperty("goalReached").GetBoolean());

        On(day4);
        await TestData.PutWeighIn(client, Iso(day4), WeighIn(83.6m));
        var reachedAgain = await TrendOn(client, day4);
        Assert.True(reachedAgain.GetProperty("goalReached").GetBoolean());
        Assert.True(reachedAgain.GetProperty("trendKg").GetDecimal() <= 84m);

        On(day5);
        await TestData.PutWeighIn(client, Iso(day5), WeighIn(88m, confirm: true));
        var above = await TrendOn(client, day5);
        Assert.True(above.GetProperty("trendKg").GetDecimal() > 84m);
        Assert.False(above.GetProperty("goalReached").GetBoolean());
    }

    [Fact(DisplayName = "35.11a")]
    public async Task Check_35_11a()
    {
        var today = new DateOnly(2026, 10, 24);
        var user = TestData.NewUser("35-11a");
        using var client = factory.AsUser(user);
        On(today);

        var tooOld = await client.PutAsync($"/api/weigh-ins/{Iso(today.AddDays(-8))}", Json(WeighIn(80m)));
        Assert.Equal(HttpStatusCode.BadRequest, tooOld.StatusCode);
        var body = await tooOld.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(WeighInEndpoints.DateWindowMessage, body.GetProperty("error").GetString());

        var edge = await client.PutAsync($"/api/weigh-ins/{Iso(today.AddDays(-7))}", Json(WeighIn(80m)));
        Assert.Equal(HttpStatusCode.Created, edge.StatusCode);
        var current = await client.PutAsync($"/api/weigh-ins/{Iso(today)}", Json(WeighIn(81m)));
        Assert.Equal(HttpStatusCode.Created, current.StatusCode);
    }

    [Fact(DisplayName = "35.11c")]
    public async Task Check_35_11c()
    {
        var today = new DateOnly(2026, 10, 24);
        var old = today.AddDays(-20);
        var moved = today.AddDays(-10);
        var user = TestData.NewUser("35-11c");
        using var client = factory.AsUser(user);
        await PutOn(client, old, 80m);
        On(today);

        var edited = await client.PutAsync($"/api/weigh-ins/{Iso(old)}", Json(WeighIn(81m)));
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
        Assert.Equal(81m, await KgOn(client, old));

        var outside = await client.PutAsync($"/api/weigh-ins/{Iso(moved)}", Json(WeighIn(82m)));
        Assert.Equal(HttpStatusCode.BadRequest, outside.StatusCode);
        var body = await outside.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(WeighInEndpoints.DateWindowMessage, body.GetProperty("error").GetString());
        Assert.Equal(81m, await KgOn(client, old));
        var listed = await client.GetFromJsonAsync<JsonElement>($"/api/weigh-ins?from={Iso(moved)}&to={Iso(moved)}");
        Assert.Equal(0, listed.GetProperty("weighIns").GetArrayLength());
    }

    [Fact(DisplayName = "35.11d")]
    public async Task Check_35_11d()
    {
        var user = TestData.NewUser("35-11d");
        using var client = factory.AsUser(user);
        On(new DateOnly(2026, 10, 24));
        var rejected = await client.PutAsync("/api/weigh-ins/2000-01-01", Json(WeighIn(80m)));
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        var body = await rejected.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(WeighInEndpoints.DateWindowMessage, body.GetProperty("error").GetString());
        Assert.Equal(0, await Count(client));
    }

    private void On(DateOnly date)
    {
        factory.Clock.UtcNow = new DateTimeOffset(date.ToDateTime(new TimeOnly(8, 0)), TimeSpan.Zero);
    }

    private async Task PutOn(HttpClient client, DateOnly date, decimal kg)
    {
        On(date);
        await TestData.PutWeighIn(client, Iso(date), WeighIn(kg));
    }

    private static async Task<JsonElement> TrendOn(HttpClient client, DateOnly date) =>
        (await client.GetFromJsonAsync<JsonElement>($"/api/weight/trend?date={Iso(date)}"))!;

    private static string Iso(DateOnly date) => date.ToString("yyyy-MM-dd");

    private static async Task<int> Count(HttpClient client)
    {
        var listed = await client.GetFromJsonAsync<JsonElement>("/api/weigh-ins");
        return listed.GetProperty("weighIns").GetArrayLength();
    }

    private static async Task<decimal> KgOn(HttpClient client, DateOnly date)
    {
        var listed = await client.GetFromJsonAsync<JsonElement>($"/api/weigh-ins?from={Iso(date)}&to={Iso(date)}");
        return listed.GetProperty("weighIns")[0].GetProperty("kg").GetDecimal();
    }

    private static async Task AssertConfirm(HttpResponseMessage response, decimal kg, decimal previousTrend, decimal limitKg)
    {
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(WeighInEndpoints.ConfirmWeighIn, body.GetProperty("code").GetString());
        Assert.Equal(kg, body.GetProperty("kg").GetDecimal());
        Assert.Equal(previousTrend, body.GetProperty("previousTrendKg").GetDecimal());
        Assert.Equal(limitKg, body.GetProperty("limitKg").GetDecimal());
    }

    private async Task<int> RunWeekly()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var job = scope.ServiceProvider.GetRequiredService<WeeklyTargetRecalculator>();
        return await job.RunAsync(CancellationToken.None);
    }

    private async Task<List<HistoryRow>> History(string userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.TargetHistories.AsNoTracking()
            .Where(row => row.UserId == userId)
            .OrderBy(row => row.EffectiveDate)
            .ThenBy(row => row.Id)
            .Select(row => new HistoryRow(row.Id, string.Join(",", row.Reasons), row.Kcal))
            .ToListAsync();
    }

    private static string WeighIn(decimal kg, bool confirm = false)
    {
        var number = kg.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var flag = confirm ? ",\"confirm\":true" : "";
        return $$"""{"kg":{{number}},"timeZone":"UTC"{{flag}}}""";
    }

    private static string WeighIn(string kg) => $$"""{"kg":{{kg}},"timeZone":"UTC"}""";

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private sealed record HistoryRow(long Id, string Reasons, int Kcal);
}
