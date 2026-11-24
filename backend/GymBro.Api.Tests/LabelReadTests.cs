using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Describe;
using GymBro.Api.Endpoints;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class LabelReadTests(ApiFactory factory)
{
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, (byte)'J', (byte)'F', (byte)'I', (byte)'F', 0x00, 0x01];

    private static readonly object Photo = new { mediaType = "image/jpeg", data = Convert.ToBase64String(Jpeg) };

    [Fact]
    public async Task A_label_photo_fills_the_form_saves_nothing_and_counts_toward_describes_limit()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 24, 12, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("label-read");
        using var client = factory.AsUser(user);

        var response = await client.PostAsJsonAsync("/api/foods/label", new { photo = Photo });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Fictional label crispbread", body.GetProperty("name").GetString());
        Assert.Equal("Northbar", body.GetProperty("brand").GetString());
        Assert.Equal("100g", body.GetProperty("basis").GetString());
        Assert.Equal("slice", body.GetProperty("servingName").GetString());
        Assert.Equal(13m, body.GetProperty("servingGrams").GetDecimal());
        Assert.Equal(370m, body.GetProperty("kcal").GetDecimal());
        Assert.Equal(6.5m, body.GetProperty("fat").GetDecimal());
        Assert.Equal(17m, body.GetProperty("fiber").GetDecimal());
        Assert.Equal(1m, body.GetProperty("salt").GetDecimal());
        Assert.Equal(19, body.GetProperty("left").GetInt32());

        // No food was made, and the read is not a recent description.
        Assert.Empty((await client.GetFromJsonAsync<JsonElement>("/api/foods/mine")).GetProperty("foods").EnumerateArray());
        var overview = await client.GetFromJsonAsync<JsonElement>("/api/describe");
        Assert.Equal(19, overview.GetProperty("left").GetInt32());
        Assert.Empty(overview.GetProperty("recent").EnumerateArray());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = await db.MealDescriptions.SingleAsync(row => row.UserId == user);
        Assert.Equal(MealKinds.Label, row.Kind);
        Assert.Equal(MealOutcomes.Found, row.Outcome);
        Assert.True(row.HasPhoto);
        Assert.Equal("", row.Text);
        Assert.Equal("rule", row.Model);

        // A label row can't be read back or marked logged as a description.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/describe/{row.Id}")).StatusCode);
    }

    [Fact]
    public async Task A_photo_is_needed_and_must_be_an_image()
    {
        using var client = factory.AsUser(TestData.NewUser("label-photo"));
        var none = await client.PostAsJsonAsync("/api/foods/label", new { });
        Assert.Equal(HttpStatusCode.BadRequest, none.StatusCode);
        Assert.Contains(LabelEndpoints.PhotoMissing, await none.Content.ReadAsStringAsync());

        var text = await client.PostAsJsonAsync("/api/foods/label", new { photo = new { mediaType = "image/jpeg", data = Convert.ToBase64String("not a jpeg"u8.ToArray()) } });
        Assert.Equal(HttpStatusCode.BadRequest, text.StatusCode);
    }

    [Fact]
    public async Task Over_the_daily_limit_it_says_so()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 24, 12, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("label-limit");
        using var client = factory.AsUser(user);
        await client.GetAsync("/api/me");
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            for (var i = 0; i < 20; i++)
            {
                db.MealDescriptions.Add(new MealDescription
                {
                    Id = Guid.NewGuid(), UserId = user, Text = "seed " + i, CreatedAt = factory.Clock.GetUtcNow().AddHours(-2),
                    Outcome = MealOutcomes.Found, Model = "rule",
                });
            }

            await db.SaveChangesAsync();
        }

        var limited = await client.PostAsJsonAsync("/api/foods/label", new { photo = Photo });
        Assert.Equal((HttpStatusCode)429, limited.StatusCode);
        Assert.Contains(LabelEndpoints.DailyLimitReached, await limited.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("nothing", HttpStatusCode.UnprocessableEntity, "nothing")]
    [InlineData("refused", HttpStatusCode.UnprocessableEntity, "declined")]
    [InlineData("down", HttpStatusCode.ServiceUnavailable, "failed")]
    public async Task No_table_or_a_failing_model_says_so_and_keeps_the_attempt(string how, HttpStatusCode expected, string outcome)
    {
        using var app = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ILabelModel>();
            services.AddSingleton<ILabelModel>(new ScriptedLabel(how));
        }));
        var user = TestData.NewUser("label-" + how);
        using var client = app.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Oid", user);
        client.DefaultRequestHeaders.Add("X-Test-Name", "Test User");

        var response = await client.PostAsJsonAsync("/api/foods/label", new { photo = Photo });
        Assert.Equal(expected, response.StatusCode);
        if (how != "down")
        {
            Assert.Contains(LabelEndpoints.NoTable, await response.Content.ReadAsStringAsync());
        }

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = await db.MealDescriptions.SingleAsync(row => row.UserId == user);
        Assert.Equal(MealKinds.Label, row.Kind);
        Assert.Equal(outcome, row.Outcome);
    }

    [Fact]
    public void Fill_reads_kj_alone_prefers_nothing_to_an_impossible_number_and_keeps_a_serving_label()
    {
        var label = RuleLabelModel.Label;
        Assert.Null(LabelRules.Fill(label with { Table = false }));
        Assert.Null(LabelRules.Fill(label with { Kcal = null, Kj = null }));
        Assert.Null(LabelRules.Fill(label with { Kcal = 2000 }));

        var kj = LabelRules.Fill(label with { Kcal = null, Kj = 1550 })!;
        Assert.Equal(370m, kj.Kcal);

        // More than 100 g of something in 100 g is a misread: that field stays empty, the rest fill.
        var misread = LabelRules.Fill(label with { Carbs = 580, Salt = -1 })!;
        Assert.Null(misread.Carbs);
        Assert.Null(misread.Salt);
        Assert.Equal(12m, misread.Protein);

        // Only a serving printed: the values stay per serving, and can be larger than 100 g allows.
        var serving = LabelRules.Fill(label with { PerServing = true, ServingName = "bar", ServingGrams = 150, Kcal = 600, Carbs = 120 })!;
        Assert.Equal("serving", serving.Basis);
        Assert.Equal(120m, serving.Carbs);
        Assert.Null(LabelRules.Fill(label with { PerServing = true, ServingGrams = 40, Kcal = 600 }));

        var rounded = LabelRules.Fill(label with { Kcal = 369.6m, Protein = 12.04m, Name = "  Knekkebrød  " })!;
        Assert.Equal(370m, rounded.Kcal);
        Assert.Equal(12m, rounded.Protein);
        Assert.Equal("Knekkebrød", rounded.Name);
    }

    [Fact]
    public void Claude_reply_is_read_with_nulls_for_what_the_label_lacks()
    {
        using var document = JsonDocument.Parse("""
            { "table": true, "name": "Havregryn", "brand": "", "perServing": false, "servingName": "", "servingGrams": null,
              "kcal": null, "kj": 1560, "protein": 13, "fat": 7, "carbs": 58, "saturatedFat": 1.2, "sugars": null,
              "fiber": 10, "salt": 0 }
            """);
        var reading = ClaudeLabelModel.Read(document.RootElement);
        Assert.Null(reading.Kcal);
        Assert.Equal(1560m, reading.Kj);
        Assert.Null(reading.ServingGrams);
        Assert.Null(reading.Sugars);
        var fill = LabelRules.Fill(reading)!;
        Assert.Equal(373m, fill.Kcal);
        Assert.Equal(0m, fill.Salt);
    }

    private sealed class ScriptedLabel(string how) : ILabelModel
    {
        public string Name => "scripted";

        public Task<LabelReading> ReadAsync(MealPhoto photo, MealUsage usage, CancellationToken cancellationToken)
        {
            usage.Add(10, 5);
            return how switch
            {
                "nothing" => Task.FromResult(RuleLabelModel.Label with { Table = false }),
                "refused" => throw new MealModelException("no", refused: true),
                _ => throw new MealModelException("down"),
            };
        }
    }
}
