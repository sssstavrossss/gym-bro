using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Configuration;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using GymBro.Api.Hosting;
using GymBro.Api.Nutrition;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace GymBro.Api.Tests;

/// <summary>
/// Retro-review checks. Four cases assert the fixed behaviour; the log-entry
/// routes stay absent until a later pull request.
/// </summary>
public sealed class RetroMathTests
{
    [Fact]
    public void Female_rate_target_stays_whole_kcal_and_at_or_above_bmr()
    {
        var result = NutritionMath.Calculate(new NutritionInput(
            Sexes.Female, 83.6m, 180, 36, ActivityLevels.Moderate, Goals.Lose, 0.5m, 2.0m, 25));

        Assert.Equal(1620, result.Bmr);
        Assert.Equal(2511, result.Tdee);
        Assert.Equal(1961, result.Kcal);
        Assert.Equal(167, result.Protein);
        Assert.Equal(54, result.Fat);
        Assert.Equal(200, result.Carbs);
        Assert.False(result.FloorApplied);
        Assert.True(result.Kcal >= result.Bmr);
    }

    [Theory]
    [InlineData("sedentary", "lose", 0.25)]
    [InlineData("sedentary", "lose", 1.0)]
    [InlineData("light", "lose", 1.0)]
    [InlineData("moderate", "lose", 1.0)]
    [InlineData("very_active", "gain", 1.0)]
    [InlineData("athlete", "maintain", 0)]
    public void Grid_never_goes_below_bmr_and_carbs_never_go_negative(string activity, string goal, double rate)
    {
        foreach (var (sex, kg, cm, age) in new[]
        {
            (Sexes.Male, 60m, 160m, 18),
            (Sexes.Female, 45m, 150m, 80),
            (Sexes.Male, 140m, 200m, 40),
            (Sexes.Female, 90m, 170m, 36),
        })
        {
            var result = NutritionMath.Calculate(new NutritionInput(
                sex, kg, cm, age, activity, goal, (decimal)rate, 3.0m, 40));
            Assert.True(result.Kcal >= result.Bmr, $"{sex} {kg}kg {activity} {goal} kcal {result.Kcal} < bmr {result.Bmr}");
            Assert.True(result.Carbs >= 0, $"{sex} {kg}kg carbs {result.Carbs}");
            if (result.FloorApplied)
            {
                Assert.Equal(result.Bmr, result.Kcal);
            }
        }
    }

    [Fact]
    public void Floor_flag_is_set_only_when_the_unrounded_target_is_below_bmr()
    {
        var floored = NutritionMath.Calculate(new NutritionInput(
            Sexes.Female, 45, 150, 80, ActivityLevels.Sedentary, Goals.Lose, 1.0m, 2.0m, 25));
        Assert.True(floored.FloorApplied);
        Assert.Equal(floored.Bmr, floored.Kcal);

        var clear = NutritionMath.Calculate(new NutritionInput(
            Sexes.Male, 83.6m, 180, 36, ActivityLevels.Athlete, Goals.Gain, 0.25m, 2.0m, 25));
        Assert.False(clear.FloorApplied);
        Assert.True(clear.Kcal > clear.Bmr);
    }

    [Fact]
    public void Trend_window_is_seven_inclusive_days_and_half_rounds_away_from_zero()
    {
        var asOf = new DateOnly(2026, 10, 24);
        var edge = new List<(DateOnly, decimal)>
        {
            (asOf.AddDays(-6), 80m),
            (asOf.AddDays(-1), 80m),
            (asOf, 80m),
        };
        var justOutside = new List<(DateOnly, decimal)>
        {
            (asOf.AddDays(-7), 80m),
            (asOf.AddDays(-1), 80m),
            (asOf, 80m),
        };
        // Part A dropped the "shown after 3 weigh-ins" gate. The window is still
        // seven local days inclusive. Two weigh-ins in that window is a normal
        // published trend; fewer than two is low accuracy.
        var edgeSeries = TrendWeight.Compute(edge, asOf);
        Assert.Equal(3, edgeSeries.WeighInsInWindow);
        Assert.Equal(TrendWeight.Normal, edgeSeries.TrendState);
        var outsideSeries = TrendWeight.Compute(justOutside, asOf);
        Assert.Equal(2, outsideSeries.WeighInsInWindow);
        Assert.Equal(TrendWeight.Normal, outsideSeries.TrendState);

        var midpoint = TrendWeight.Compute([(asOf.AddDays(-1), 80.00m), (asOf, 80.05m)], asOf);
        Assert.Equal(80.01m, midpoint.TrendKg);
    }
}

public sealed class RetroProxyTests
{
    [Fact]
    public async Task Search_query_cannot_change_the_upstream_host()
    {
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("""{"products":[]}"""),
        });
        using var http = new HttpClient(handler);
        var client = new OpenFoodFactsClient(
            http,
            new OpenFoodFactsGate(new ManualTimeProvider()),
            Options.Create(new FoodOptions()));

        var outcome = await client.SearchAsync("https://127.0.0.1/latest/meta-data?x=1&y=2", CancellationToken.None);

        Assert.Equal(OffStatus.Ok, outcome.Status);
        var uri = Assert.Single(handler.Uris);
        Assert.Equal("https", uri.Scheme);
        Assert.Equal("world.openfoodfacts.org", uri.Host);
        Assert.Equal("/cgi/search.pl", uri.AbsolutePath);
        Assert.Contains("search_terms=https%3A%2F%2F127.0.0.1%2Flatest%2Fmeta-data%3Fx%3D1%26y%3D2", uri.Query, StringComparison.Ordinal);
        Assert.DoesNotContain("127.0.0.1", uri.Host, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Upstream_failures_and_timeouts_become_unavailable()
    {
        await AssertStatus(new HttpRequestException("down"), OffStatus.Unavailable);
        await AssertStatus(new TaskCanceledException("timed out"), OffStatus.Unavailable);
        await AssertStatus(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("<html>not json</html>"),
        }, OffStatus.Unavailable);
    }

    [Fact]
    public async Task Redirects_are_not_followed()
    {
        using var redirector = new RedirectProbe();
        using var http = new HttpClient(OpenFoodFactsClient.CreateHandler());
        http.Timeout = TimeSpan.FromSeconds(8);
        var client = new OpenFoodFactsClient(
            http,
            new OpenFoodFactsGate(new ManualTimeProvider()),
            Options.Create(new FoodOptions { OpenFoodFactsSearchUrl = redirector.StartUrl }));

        var outcome = await client.SearchAsync("oats", CancellationToken.None);

        Assert.Equal(OffStatus.Unavailable, outcome.Status);
        Assert.Equal(0, redirector.SecretHits);
    }

    private static async Task AssertStatus(Exception error, OffStatus expected)
    {
        var handler = new RecordingHandler(_ => throw error);
        using var http = new HttpClient(handler);
        var client = new OpenFoodFactsClient(http, new OpenFoodFactsGate(new ManualTimeProvider()), Options.Create(new FoodOptions()));
        Assert.Equal(expected, (await client.SearchAsync("oats", CancellationToken.None)).Status);
    }

    private static async Task AssertStatus(HttpResponseMessage response, OffStatus expected)
    {
        var handler = new RecordingHandler(_ => response);
        using var http = new HttpClient(handler);
        var client = new OpenFoodFactsClient(http, new OpenFoodFactsGate(new ManualTimeProvider()), Options.Create(new FoodOptions()));
        Assert.Equal(expected, (await client.SearchAsync("oats", CancellationToken.None)).Status);
    }

    private sealed class RecordingHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<Uri> Uris { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Uris.Add(request.RequestUri!);
            return Task.FromResult(respond(request));
        }
    }

    private sealed class RedirectProbe : IDisposable
    {
        private readonly HttpListener _gate = new();
        private readonly HttpListener _secret = new();

        private int _secretHits;

        public string StartUrl { get; }

        public int SecretHits => _secretHits;

        public RedirectProbe()
        {
            _gate.Prefixes.Add("http://127.0.0.1:18181/");
            _secret.Prefixes.Add("http://127.0.0.1:18182/");
            _gate.Start();
            _secret.Start();
            StartUrl = "http://127.0.0.1:18181/search";
            _ = Task.Run(ServeGate);
            _ = Task.Run(ServeSecret);
        }

        private async Task ServeGate()
        {
            var context = await _gate.GetContextAsync();
            context.Response.Redirect("http://127.0.0.1:18182/secret");
            context.Response.Close();
        }

        private async Task ServeSecret()
        {
            var context = await _secret.GetContextAsync();
            Interlocked.Increment(ref _secretHits);
            var bytes = """{"products":[]}"""u8.ToArray();
            context.Response.ContentType = "application/json";
            await context.Response.OutputStream.WriteAsync(bytes);
            context.Response.Close();
        }

        public void Dispose()
        {
            _gate.Close();
            _secret.Close();
        }
    }
}

[Collection(ApiCollection.Name)]
public sealed class RetroApiTests(ApiFactory factory)
{
    [Fact]
    public async Task Wildcard_characters_in_search_are_literals()
    {
        var user = TestData.NewUser("wild");
        using var client = factory.AsUser(user);
        var created = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "100% oat_brick",
            kcalPer100 = 100,
            proteinPer100 = 1,
            fatPer100 = 1,
            carbsPer100 = 1,
            basis = "g",
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        var literal = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=" + Uri.EscapeDataString("oat_brick"));
        Assert.Equal(1, literal.GetProperty("foods").GetArrayLength());

        var percents = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=" + Uri.EscapeDataString("%%%%"));
        Assert.Equal(0, percents.GetProperty("foods").GetArrayLength());

        var underscore = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=" + Uri.EscapeDataString("oatXbrick"));
        Assert.Equal(0, underscore.GetProperty("foods").GetArrayLength());
    }

    [Fact]
    public async Task A_token_without_the_api_scope_is_forbidden()
    {
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Oid", TestData.NewUser("scope"));
        client.DefaultRequestHeaders.Add("X-Test-Scope", "openid");
        var response = await client.GetAsync("/api/profile");
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Log_entries_reject_a_request_without_a_date_or_key()
    {
        using var client = factory.AsUser(TestData.NewUser("nolog"));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/log-entries")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/log-entries", new { name = "oats" })).StatusCode);
    }

    [Fact]
    public async Task Oslo_monday_is_dated_monday_while_utc_is_still_sunday()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 25, 12, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("oslo");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-25", """{"kg":83.6,"timeZone":"Europe/Oslo"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "Europe/Oslo"));

        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 25, 23, 30, 0, TimeSpan.Zero);
        Assert.True(await RunWeekly() >= 1);

        var sunday = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-10-25");
        var monday = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-10-26");
        Assert.Equal("profile_change", sunday.GetProperty("targets").GetProperty("reason").GetString());
        Assert.Equal("2026-10-25", sunday.GetProperty("targets").GetProperty("effectiveDate").GetString());
        Assert.Equal("weekly_recalculation", monday.GetProperty("targets").GetProperty("reason").GetString());
        Assert.Equal("2026-10-26", monday.GetProperty("targets").GetProperty("effectiveDate").GetString());
    }

    [Fact]
    public async Task Los_Angeles_does_not_start_monday_while_it_is_still_sunday_there()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 19, 18, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("la");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-19", """{"kg":83.6,"timeZone":"America/Los_Angeles"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "America/Los_Angeles"));
        Assert.True(await RunWeekly() >= 1);

        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 26, 6, 0, 0, TimeSpan.Zero);
        var before = await RowsFor(user);
        await RunWeekly();
        Assert.Equal(before, await RowsFor(user));
        var stillSunday = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-10-25");
        Assert.Equal("weekly_recalculation", stillSunday.GetProperty("targets").GetProperty("reason").GetString());
        Assert.Equal("2026-10-19", stillSunday.GetProperty("targets").GetProperty("effectiveDate").GetString());

        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 26, 7, 0, 0, TimeSpan.Zero);
        Assert.True(await RunWeekly() >= 1);
        var monday = await client.GetFromJsonAsync<JsonElement>("/api/targets?date=2026-10-26");
        Assert.Equal("2026-10-26", monday.GetProperty("targets").GetProperty("effectiveDate").GetString());
    }

    [Fact]
    public async Task A_midweek_signup_keeps_a_single_history_row()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 28, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("midweek");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-28", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());
        await RunWeekly();

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rows = await db.TargetHistories.Where(row => row.UserId == user).OrderBy(row => row.Id).ToListAsync();
        var row = Assert.Single(rows);
        Assert.Equal(new DateOnly(2026, 10, 28), row.EffectiveDate);
        Assert.Equal(["profile_change"], row.Reasons);
    }

    [Fact]
    public async Task Log_row_cannot_reference_another_users_food()
    {
        var owner = TestData.NewUser("food-owner");
        var other = TestData.NewUser("food-other");
        using var ownerClient = factory.AsUser(owner);
        using var otherClient = factory.AsUser(other);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync("/api/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await otherClient.GetAsync("/api/me")).StatusCode);
        var created = await ownerClient.PostAsJsonAsync("/api/foods", new
        {
            name = "Private bar",
            kcalPer100 = 100,
            proteinPer100 = 1,
            fatPer100 = 1,
            carbsPer100 = 1,
            basis = "g",
        });
        var foodId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.LogEntries.Add(new LogEntry
        {
            Id = Guid.NewGuid(),
            UserId = other,
            LocalDate = new DateOnly(2026, 10, 24),
            LoggedAt = new DateTime(2026, 10, 24, 8, 0, 0),
            TimeZone = "UTC",
            FoodId = foodId,
            Name = "Private bar",
            Amount = 1,
            Unit = "serving",
            Kcal = 100,
            IdempotencyKey = "cross-" + Guid.NewGuid().ToString("N"),
        });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task A_very_long_serving_label_is_rejected()
    {
        using var client = factory.AsUser(TestData.NewUser("label"));
        var response = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Long label",
            kcalPer100 = 10,
            proteinPer100 = 1,
            fatPer100 = 1,
            carbsPer100 = 1,
            basis = "g",
            servingQuantity = 40,
            servingLabel = new string('a', 200),
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private async Task<int> RunWeekly()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var job = scope.ServiceProvider.GetRequiredService<WeeklyTargetRecalculator>();
        return await job.RunAsync(CancellationToken.None);
    }

    private async Task<int> RowsFor(string userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.TargetHistories.CountAsync(row => row.UserId == userId);
    }
}
