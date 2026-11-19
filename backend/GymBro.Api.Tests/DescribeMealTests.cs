using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Describe;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class DescribeMealTests(ApiFactory factory)
{
    [Fact]
    public async Task Describe_matches_foods_with_amounts_and_logs_nothing()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 20, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("describe-match");
        using var client = factory.AsUser(user);
        var egg = await Food("Quorbleg boiled", 150, piece: 60);
        var bread = await Food("Quorbread grainy", 240);

        var response = await client.PostAsJsonAsync("/api/describe", new { text = "2 quorbleg, 80 g quorbread and mum's zzlasagne" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(3, items.Count);

        Assert.Equal("2 quorbleg", items[0].GetProperty("phrase").GetString());
        Assert.Equal(egg, items[0].GetProperty("food").GetProperty("id").GetGuid());
        Assert.Equal(2, items[0].GetProperty("amount").GetDecimal());
        Assert.Equal("piece", items[0].GetProperty("unit").GetString());
        Assert.False(items[0].GetProperty("guessed").GetBoolean());

        Assert.Equal(bread, items[1].GetProperty("food").GetProperty("id").GetGuid());
        Assert.Equal(80, items[1].GetProperty("amount").GetDecimal());
        Assert.Equal("g", items[1].GetProperty("unit").GetString());

        Assert.Equal(JsonValueKind.Null, items[2].GetProperty("food").ValueKind);
        Assert.Equal("mum's zzlasagne", items[2].GetProperty("phrase").GetString());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.LogEntries.AnyAsync(entry => entry.UserId == user));
        var row = await db.MealDescriptions.SingleAsync(found => found.UserId == user);
        Assert.Equal(2, row.FoodCount);
        Assert.Equal(180m + 192m, row.Kcal);
        Assert.Null(row.LoggedAt);

        // Not logged yet, so it isn't a recent description.
        var overview = await client.GetFromJsonAsync<JsonElement>("/api/describe");
        Assert.True(overview.GetProperty("available").GetBoolean());
        Assert.Empty(overview.GetProperty("recent").EnumerateArray());
    }

    [Fact]
    public async Task A_logged_description_comes_back_as_logged_and_stays_private()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 20, 9, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("describe-logged");
        var other = TestData.NewUser("describe-other");
        using var client = factory.AsUser(user);
        using var otherClient = factory.AsUser(other);
        var oats = await Food("Quorboats rolled", 370);
        var milk = await Food("Quormilk light", 40, basis: "ml");

        var described = await (await client.PostAsJsonAsync("/api/describe", new { text = "quorboats with quormilk" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        var id = described.GetProperty("id").GetGuid();

        // The person changed the oats to 60 g, kept 200 ml milk, and skipped nothing.
        var logged = await client.PostAsJsonAsync($"/api/describe/{id}/logged", new
        {
            items = new object[]
            {
                new { phrase = "quorboats", name = "quorboats", guessed = true, foodId = oats, amount = 60, unit = "g" },
                new { phrase = "quormilk", name = "quormilk", guessed = true, foodId = milk, amount = 200, unit = "ml" },
            },
        });
        Assert.Equal(HttpStatusCode.NoContent, logged.StatusCode);

        var overview = await client.GetFromJsonAsync<JsonElement>("/api/describe");
        var recent = Assert.Single(overview.GetProperty("recent").EnumerateArray());
        Assert.Equal("quorboats with quormilk", recent.GetProperty("text").GetString());
        Assert.Equal(2, recent.GetProperty("foods").GetInt32());
        Assert.Equal(222m + 80m, recent.GetProperty("kcal").GetDecimal());

        var again = await client.GetFromJsonAsync<JsonElement>($"/api/describe/{id}");
        var items = again.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(60, items[0].GetProperty("amount").GetDecimal());
        Assert.Equal(oats, items[0].GetProperty("food").GetProperty("id").GetGuid());
        Assert.Equal("ml", items[1].GetProperty("unit").GetString());

        Assert.Equal(HttpStatusCode.NotFound, (await otherClient.GetAsync($"/api/describe/{id}")).StatusCode);
        var stolen = await otherClient.PostAsJsonAsync($"/api/describe/{id}/logged", new { items = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.NotFound, stolen.StatusCode);
        Assert.Empty((await otherClient.GetFromJsonAsync<JsonElement>("/api/describe")).GetProperty("recent").EnumerateArray());
    }

    [Fact]
    public async Task Logged_keeps_only_foods_that_can_be_logged()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 20, 10, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("describe-keep");
        using var client = factory.AsUser(user);
        var rice = await Food("Quorrice cooked", 130);
        var described = await (await client.PostAsJsonAsync("/api/describe", new { text = "quorrice" }))
            .Content.ReadFromJsonAsync<JsonElement>();
        var id = described.GetProperty("id").GetGuid();

        var none = await client.PostAsJsonAsync($"/api/describe/{id}/logged", new
        {
            items = new object[] { new { phrase = "quorrice", name = "rice", foodId = rice, amount = 2, unit = "piece" } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, none.StatusCode);

        var some = await client.PostAsJsonAsync($"/api/describe/{id}/logged", new
        {
            items = new object[]
            {
                new { phrase = "quorrice", name = "rice", foodId = rice, amount = 150, unit = "g" },
                new { phrase = "ghost", name = "ghost", foodId = Guid.NewGuid(), amount = 1, unit = "g" },
            },
        });
        Assert.Equal(HttpStatusCode.NoContent, some.StatusCode);
        var again = await client.GetFromJsonAsync<JsonElement>($"/api/describe/{id}");
        Assert.Single(again.GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task Text_is_required_and_capped()
    {
        using var client = factory.AsUser(TestData.NewUser("describe-text"));
        var empty = await client.PostAsJsonAsync("/api/describe", new { text = "  " });
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        var tooLong = await client.PostAsJsonAsync("/api/describe", new { text = new string('a', MealDescriber.TextMax + 1) });
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        var nothing = await client.PostAsJsonAsync("/api/describe", new { text = ", , ." });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, nothing.StatusCode);
    }

    [Fact]
    public async Task A_day_has_a_limit()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 20, 12, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("describe-limit");
        using var client = factory.AsUser(user);
        await client.GetAsync("/api/me");
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            for (var i = 0; i < new DescribeOptions().DailyLimit; i++)
            {
                db.MealDescriptions.Add(new MealDescription
                {
                    Id = Guid.NewGuid(),
                    UserId = user,
                    Text = "seed " + i,
                    CreatedAt = factory.Clock.GetUtcNow().AddHours(-23),
                });
            }

            await db.SaveChangesAsync();
        }

        var limited = await client.PostAsJsonAsync("/api/describe", new { text = "an apple" });
        Assert.Equal((HttpStatusCode)429, limited.StatusCode);

        factory.Clock.UtcNow = factory.Clock.GetUtcNow().AddHours(2);
        var tomorrow = await client.PostAsJsonAsync("/api/describe", new { text = "an apple" });
        Assert.NotEqual((HttpStatusCode)429, tomorrow.StatusCode);
    }

    [Theory]
    [InlineData(true, HttpStatusCode.UnprocessableEntity)]
    [InlineData(false, HttpStatusCode.ServiceUnavailable)]
    public async Task A_model_that_fails_says_so_and_saves_nothing(bool refused, HttpStatusCode expected)
    {
        using var failing = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IMealModel>();
            services.AddSingleton<IMealModel>(new FailingModel(refused));
        }));
        var user = TestData.NewUser("describe-fail");
        using var client = failing.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Oid", user);
        client.DefaultRequestHeaders.Add("X-Test-Name", "Test User");

        var response = await client.PostAsJsonAsync("/api/describe", new { text = "2 eggs" });
        Assert.Equal(expected, response.StatusCode);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.MealDescriptions.AnyAsync(row => row.UserId == user));
    }

    [Fact]
    public void A_unit_the_food_lacks_falls_back_to_the_gram_estimate()
    {
        var food = new Food { Name = "Plain", Basis = "g", NutrientBasis = NutrientBases.Per100, KcalPer100 = 100 };
        var choice = new MealChoice(
            new MealPart("a big bowl of plain", "plain", ["plain"], 312.4m, false),
            [new MealCandidate(food, false, MealDescriber.Units(food, null))]);

        var piece = MealDescriber.Resolve(choice, new MealPick(0, 0, 2, "piece"));
        Assert.Same(food, piece.Food);
        Assert.Equal(312, piece.Amount);
        Assert.Equal("g", piece.Unit);

        var grams = MealDescriber.Resolve(choice, new MealPick(0, 0, 250, "G"));
        Assert.Equal(250, grams.Amount);
        Assert.Equal("g", grams.Unit);

        Assert.Null(MealDescriber.Resolve(choice, new MealPick(0, 5, 1, "g")).Food);
        Assert.Null(MealDescriber.Resolve(choice, null).Food);
    }

    [Fact]
    public void Units_follow_how_the_food_is_measured()
    {
        var perServing = new Food { NutrientBasis = NutrientBases.PerServing, Basis = "serving", ServingLabel = "bar" };
        Assert.Equal(["serving"], MealDescriber.Units(perServing, null).Select(unit => unit.Unit));

        var drink = new Food { NutrientBasis = NutrientBases.Per100, Basis = "ml" };
        Assert.Equal(["ml"], MealDescriber.Units(drink, null).Select(unit => unit.Unit));

        var egg = new Food { NutrientBasis = NutrientBases.Per100, Basis = "g", PieceQuantity = 60, PieceLabel = "egg", ServingQuantity = 120 };
        var slice = new UserServing { Name = "Slice", Grams = 30 };
        var units = MealDescriber.Units(egg, [slice]);
        Assert.Equal(["g", "serving", "piece", "Slice"], units.Select(unit => unit.Unit));
        Assert.Equal("egg", units[2].Label);
        Assert.Equal(30, units[3].Grams);

        // A serving of the person's own is a unit too, whatever its case in the reply.
        var choice = new MealChoice(new MealPart("2 slices", "plain", [], 60, false), [new MealCandidate(egg, true, units)]);
        var picked = MealDescriber.Resolve(choice, new MealPick(0, 0, 2, "slice"));
        Assert.Equal("Slice", picked.Unit);
        Assert.Equal(2, picked.Amount);
    }

    [Fact]
    public void The_pick_prompt_numbers_candidates_and_lists_their_units()
    {
        var egg = new Food { Name = "Egg, kokt", NameEn = "Egg, boiled", NutrientBasis = NutrientBases.Per100, Basis = "g", PieceQuantity = 60, PieceLabel = "egg" };
        var choices = new List<MealChoice>
        {
            new(new MealPart("2 eggs", "boiled egg", ["egg"], 120, false), [new MealCandidate(egg, true, MealDescriber.Units(egg, null))]),
            new(new MealPart("coffee", "coffee", ["kaffe"], 250, true), []),
        };

        var prompt = ClaudeMealModel.PickPrompt("2 eggs and coffee", choices);
        Assert.Contains("Note: 2 eggs and coffee", prompt, StringComparison.Ordinal);
        Assert.Contains("Food 1: \"2 eggs\" (boiled egg, about 120 g)", prompt, StringComparison.Ordinal);
        Assert.Contains("1. Egg, kokt / Egg, boiled (yours). Units: g (1 g = 1 g); piece (1 egg = 60 g)", prompt, StringComparison.Ordinal);
        Assert.Contains("Food 2: \"coffee\" (coffee, about 250 g, no amount given)", prompt, StringComparison.Ordinal);
        Assert.Contains("No candidates.", prompt, StringComparison.Ordinal);
    }

    private async Task<Guid> Food(string name, decimal kcal, decimal? piece = null, string basis = "g")
    {
        var id = Guid.NewGuid();
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Foods.Add(new Food
        {
            Id = id,
            Source = "test",
            SourceId = "describe-" + id.ToString("N"),
            Name = name,
            Basis = basis,
            NutrientBasis = NutrientBases.Per100,
            KcalPer100 = kcal,
            ProteinPer100 = 5,
            FatPer100 = 5,
            CarbsPer100 = 5,
            PieceQuantity = piece,
            PieceLabel = piece is null ? null : "piece",
            UpdatedAt = factory.Clock.GetUtcNow(),
        });
        await db.SaveChangesAsync();
        return id;
    }

    private sealed class FailingModel(bool refused) : IMealModel
    {
        public Task<IReadOnlyList<MealPart>> SplitAsync(string text, CancellationToken cancellationToken) =>
            throw new MealModelException("no", refused);

        public Task<IReadOnlyList<MealPick>> PickAsync(string text, IReadOnlyList<MealChoice> choices, CancellationToken cancellationToken) =>
            throw new MealModelException("no", refused);
    }
}
