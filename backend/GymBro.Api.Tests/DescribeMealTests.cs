using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Describe;
using GymBro.Api.Foods;
using Anthropic.Models.Messages;
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
    public async Task Candidates_put_the_persons_own_foods_first_then_the_closest_match_then_the_shortest_name()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 20, 8, 30, 0, TimeSpan.Zero);
        var user = TestData.NewUser("describe-order");
        using var client = factory.AsUser(user);
        await Food("Quorbsort, 100 % wholemeal, home-made", 240);
        var plain = await Food("Quorbsort, plain", 250);
        await Food("Ed, quorbsort", 260);

        // The rule model takes the first candidate. By name the home-made one sorts first; the plain one is shorter.
        // "Ed, quorbsort" is shorter still, but only its last word matches, so a name that starts with it wins.
        var first = await (await client.PostAsJsonAsync("/api/describe", new { text = "quorbsort" })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(plain, first.GetProperty("items")[0].GetProperty("food").GetProperty("id").GetGuid());

        var mine = await (await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Quorbsort, my own long sourdough loaf", kcalPer100 = 260, proteinPer100 = 9, fatPer100 = 3, carbsPer100 = 50, basis = "g",
        })).Content.ReadFromJsonAsync<JsonElement>();
        var second = await (await client.PostAsJsonAsync("/api/describe", new { text = "quorbsort" })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(mine.GetProperty("id").GetGuid(), second.GetProperty("items")[0].GetProperty("food").GetProperty("id").GetGuid());
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
    public async Task A_photo_alone_or_with_words_is_described_and_the_photo_is_not_kept()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 20, 11, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("describe-photo");
        using var client = factory.AsUser(user);
        var pea = await Food("Quorbpea green", 80);
        var photo = new { mediaType = "image/jpeg", data = Convert.ToBase64String(Jpeg) };

        // The test model sees RuleMealModel.PhotoMeal in every photo.
        var alone = await client.PostAsJsonAsync("/api/describe", new { photo });
        Assert.Equal(HttpStatusCode.OK, alone.StatusCode);
        var aloneBody = await alone.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("", aloneBody.GetProperty("text").GetString());
        Assert.True(aloneBody.GetProperty("photo").GetBoolean());
        Assert.Equal("Kylling, ris kokt", aloneBody.GetProperty("seen").GetString());
        Assert.Equal(["150 g kylling", "ris kokt"], aloneBody.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("phrase").GetString()));

        var both = await (await client.PostAsJsonAsync("/api/describe", new { text = " quorbpea ", photo })).Content.ReadFromJsonAsync<JsonElement>();
        var items = both.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(3, items.Count);
        Assert.Equal(pea, items[2].GetProperty("food").GetProperty("id").GetGuid());
        Assert.Equal("Kylling, ris kokt, quorbpea", both.GetProperty("seen").GetString());

        // Words alone are as before: no photo, nothing seen.
        var words = await (await client.PostAsJsonAsync("/api/describe", new { text = "quorbpea" })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(words.GetProperty("photo").GetBoolean());
        Assert.Equal(JsonValueKind.Null, words.GetProperty("seen").ValueKind);

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var rows = await db.MealDescriptions.Where(row => row.UserId == user).OrderBy(row => row.Text).ToListAsync();
            Assert.Equal([true, true, false], rows.Select(row => row.HasPhoto).OrderByDescending(has => has));
            Assert.Contains(rows, row => row.HasPhoto && row.Text == "");
        }

        // Two photos with the same words are two recent ones: each photo is its own meal.
        var again = await (await client.PostAsJsonAsync("/api/describe", new { text = "quorbpea", photo })).Content.ReadFromJsonAsync<JsonElement>();
        foreach (var id in new[] { both.GetProperty("id").GetGuid(), again.GetProperty("id").GetGuid() })
        {
            var logged = await client.PostAsJsonAsync($"/api/describe/{id}/logged", new
            {
                items = new object[] { new { phrase = "quorbpea", name = "quorbpea", guessed = true, foodId = pea, amount = 50, unit = "g" } },
            });
            Assert.Equal(HttpStatusCode.NoContent, logged.StatusCode);
        }

        var recent = (await client.GetFromJsonAsync<JsonElement>("/api/describe")).GetProperty("recent").EnumerateArray().ToList();
        Assert.Equal(2, recent.Count);
        Assert.All(recent, row =>
        {
            Assert.True(row.GetProperty("photo").GetBoolean());
            Assert.Equal("quorbpea", row.GetProperty("text").GetString());
            // As logged: only the peas were kept.
            Assert.Equal("Quorbpea", row.GetProperty("seen").GetString());
        });
    }

    [Fact]
    public async Task Words_or_a_photo_are_needed_and_a_photo_must_be_an_image()
    {
        var user = TestData.NewUser("describe-photo-bad");
        using var client = factory.AsUser(user);

        async Task<string?> Refused(object body)
        {
            var response = await client.PostAsJsonAsync("/api/describe", body);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString();
        }

        var jpeg = Convert.ToBase64String(Jpeg);
        Assert.Equal(MealDescriber.TextRequired, await Refused(new { text = " " }));
        Assert.Equal(MealPhoto.Unreadable, await Refused(new { photo = new { mediaType = "image/png", data = jpeg } }));
        Assert.Equal(MealPhoto.Unreadable, await Refused(new { photo = new { mediaType = "image/gif", data = jpeg } }));
        Assert.Equal(MealPhoto.Unreadable, await Refused(new { photo = new { mediaType = "image/jpeg", data = "not base64!" } }));
        Assert.Equal(MealPhoto.Unreadable, await Refused(new { text = "an egg", photo = new { mediaType = "image/jpeg", data = "" } }));
        var huge = new byte[MealPhoto.MaxBytes + 1];
        Jpeg.CopyTo(huge, 0);
        Assert.Equal(MealPhoto.TooLarge, await Refused(new { photo = new { mediaType = "image/jpeg", data = Convert.ToBase64String(huge) } }));

        // Nothing reached the model, so nothing was saved or counted.
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.MealDescriptions.AnyAsync(row => row.UserId == user));
    }

    [Fact]
    public void A_photo_goes_to_the_split_before_the_words_and_the_pick_is_told_it_was_a_photo()
    {
        var photo = MealPhoto.Read("image/jpeg", Convert.ToBase64String(Jpeg)).Photo!;

        Assert.Equal("2 eggs", new MealNote("2 eggs").ForPick);
        Assert.Equal("A photo of the meal.", new MealNote("", photo).ForPick);
        Assert.Equal("A photo of the meal, with the words: fried in butter", new MealNote("fried in butter", photo).ForPick);

        var words = JsonSerializer.Serialize(new UserMessageParam { Content = ClaudeMealModel.SplitContent(new MealNote("2 eggs")) });
        Assert.DoesNotContain("image", words);
        var withPhoto = JsonSerializer.Serialize(new UserMessageParam { Content = ClaudeMealModel.SplitContent(new MealNote("fried in butter", photo)) });
        var image = withPhoto.IndexOf("\"type\":\"image\"", StringComparison.Ordinal);
        var text = withPhoto.IndexOf("Words with the photo: fried in butter", StringComparison.Ordinal);
        Assert.True(image >= 0 && text > image, withPhoto);
        Assert.Contains("image/jpeg", withPhoto);
        Assert.Contains("No words, only the photo.", JsonSerializer.Serialize(new UserMessageParam { Content = ClaudeMealModel.SplitContent(new MealNote("", photo)) }));
    }

    [Fact]
    public async Task Twenty_a_day_then_the_oldest_ages_out_and_failures_do_not_count()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 20, 12, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("describe-limit");
        using var client = factory.AsUser(user);
        await client.GetAsync("/api/me");
        Assert.Equal(20, new DescribeOptions().DailyLimit);
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            for (var i = 0; i < 19; i++)
            {
                db.MealDescriptions.Add(Seed(user, "seed " + i, factory.Clock.GetUtcNow().AddHours(-23 + i * 0.1)));
            }

            // Claude was down for these: they cost nothing and don't count.
            db.MealDescriptions.Add(Seed(user, "down", factory.Clock.GetUtcNow().AddHours(-1), MealOutcomes.Failed));
            db.MealDescriptions.Add(Seed(user, "down again", factory.Clock.GetUtcNow().AddHours(-1), MealOutcomes.Failed));
            await db.SaveChangesAsync();
        }

        var overview = await client.GetFromJsonAsync<JsonElement>("/api/describe");
        Assert.Equal(20, overview.GetProperty("limit").GetInt32());
        Assert.Equal(1, overview.GetProperty("left").GetInt32());
        Assert.Equal(JsonValueKind.Null, overview.GetProperty("nextAt").ValueKind);

        var last = await client.PostAsJsonAsync("/api/describe", new { text = "an apple" });
        Assert.NotEqual((HttpStatusCode)429, last.StatusCode);

        var limited = await client.PostAsJsonAsync("/api/describe", new { text = "an apple" });
        Assert.Equal((HttpStatusCode)429, limited.StatusCode);
        overview = await client.GetFromJsonAsync<JsonElement>("/api/describe");
        Assert.Equal(0, overview.GetProperty("left").GetInt32());
        // The oldest of the twenty, 23 hours ago, frees a place in an hour.
        Assert.Equal(factory.Clock.GetUtcNow().AddHours(1), overview.GetProperty("nextAt").GetDateTimeOffset());

        factory.Clock.UtcNow = factory.Clock.GetUtcNow().AddHours(1).AddMinutes(1);
        var later = await client.PostAsJsonAsync("/api/describe", new { text = "an apple" });
        Assert.NotEqual((HttpStatusCode)429, later.StatusCode);
    }

    [Fact]
    public async Task Every_attempt_is_kept_with_its_outcome_and_a_retry_points_at_the_one_before()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 20, 12, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("describe-attempts");
        using var client = factory.AsUser(user);
        await Food("Quorbretry egg", 150, piece: 60);

        var first = await client.PostAsJsonAsync("/api/describe", new { text = ", ." });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, first.StatusCode);
        var found = await client.PostAsJsonAsync("/api/describe", new { text = "2 quorbretry eggs" });
        found.EnsureSuccessStatusCode();
        var body = await found.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(18, body.GetProperty("left").GetInt32());
        var foundId = body.GetProperty("id").GetGuid();

        var retry = await client.PostAsJsonAsync("/api/describe", new { text = "3 quorbretry eggs", retryOf = foundId });
        retry.EnsureSuccessStatusCode();
        var retryId = (await retry.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        // Another person's id is not linked.
        using var other = factory.AsUser(TestData.NewUser("describe-attempts-other"));
        var stranger = await other.PostAsJsonAsync("/api/describe", new { text = "an apple", retryOf = foundId });

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rows = await db.MealDescriptions.Where(row => row.UserId == user).OrderBy(row => row.Text).ToListAsync();
        Assert.Equal([MealOutcomes.Found, MealOutcomes.Found, MealOutcomes.Nothing], rows.OrderBy(row => row.Outcome).Select(row => row.Outcome));
        Assert.All(rows, row => Assert.Equal("rule", row.Model));
        Assert.All(rows, row => Assert.True(row.Calls >= 1));
        Assert.Equal(foundId, rows.Single(row => row.Id == retryId).RetryOf);
        Assert.Equal("[]", rows.Single(row => row.Outcome == MealOutcomes.Nothing).Items);
        Assert.Null((await db.MealDescriptions.SingleAsync(row => row.Text == "an apple" && row.UserId != user)).RetryOf);
        Assert.NotEqual(HttpStatusCode.InternalServerError, stranger.StatusCode);

        // Only found descriptions can be read back or marked logged.
        var nothingId = rows.Single(row => row.Outcome == MealOutcomes.Nothing).Id;
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/describe/{nothingId}")).StatusCode);
    }

    [Theory]
    [InlineData(true, HttpStatusCode.UnprocessableEntity, "declined")]
    [InlineData(false, HttpStatusCode.ServiceUnavailable, "failed")]
    public async Task A_model_that_fails_says_so_and_keeps_the_attempt(bool refused, HttpStatusCode expected, string outcome)
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
        var row = await db.MealDescriptions.SingleAsync(row => row.UserId == user);
        Assert.Equal(outcome, row.Outcome);
        Assert.Equal("failing", row.Model);
        Assert.Equal(1, row.Calls);
        Assert.Equal(0, row.FoodCount);
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
    public void A_weight_far_from_the_estimate_falls_back_to_the_estimate()
    {
        var honey = new Food { Name = "Honning", Basis = "g", NutrientBasis = NutrientBases.Per100, KcalPer100 = 317, ServingQuantity = 15, ServingLabel = "spiseskje" };
        var choice = new MealChoice(
            new MealPart("honey", "honey", ["honning"], 15, true),
            [new MealCandidate(honey, false, MealDescriber.Units(honey, null))]);

        // 15 tablespoons is 225 g against an estimate of 15 g: the number was meant as grams.
        var spoons = MealDescriber.Resolve(choice, new MealPick(0, 0, 15, "serving"));
        Assert.Equal(15, spoons.Amount);
        Assert.Equal("g", spoons.Unit);

        // Within three times either way the pick stands.
        var two = MealDescriber.Resolve(choice, new MealPick(0, 0, 2, "serving"));
        Assert.Equal(2, two.Amount);
        Assert.Equal("serving", two.Unit);
        Assert.Equal(6, MealDescriber.Resolve(choice, new MealPick(0, 0, 6, "g")).Amount);
        Assert.Equal(15, MealDescriber.Resolve(choice, new MealPick(0, 0, 4, "g")).Amount);
    }

    [Fact]
    public void Each_pick_lands_on_the_food_it_names_even_when_one_is_missing()
    {
        using var reply = JsonDocument.Parse("""
            { "picks": [
              { "food": 1, "candidate": 2, "unit": "piece", "amount": 2 },
              { "food": 3, "candidate": 1, "unit": "g", "amount": 10 },
              { "food": 4, "candidate": 0, "unit": "g", "amount": 200 }
            ] }
            """);

        var picks = ClaudeMealModel.ReadPicks(reply.RootElement);
        Assert.Equal([0, 2, 3], picks.Select(pick => pick.Part));
        Assert.Equal([1, 0, null], picks.Select(pick => pick.Candidate));
        Assert.Equal(10, picks[1].Amount);
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

    [Fact]
    public void Table_measures_are_units_logged_as_grams()
    {
        var cheese = new Food
        {
            Name = "Gulost", Basis = "g", NutrientBasis = NutrientBases.Per100, KcalPer100 = 350, ServingQuantity = 40, ServingLabel = "porsjon",
            Portions = FoodPortions.Write(
            [
                new FoodPortion("porsjon", "porsjon", "portion", 40),
                new FoodPortion("skive", "skive", "slice", 10),
                new FoodPortion("ss", "spiseskje", null, 15),
            ]),
        };
        var units = MealDescriber.Units(cheese, null);

        // The portion is the serving already, so it isn't listed twice. The rest are named in English when the table has it.
        Assert.Equal(["g", "serving", "skive", "ss"], units.Select(unit => unit.Unit));
        Assert.Equal(["slice", "spiseskje"], units.Where(unit => unit.AsGrams).Select(unit => unit.Label));
        Assert.Contains("skive (1 slice = 10 g)", ClaudeMealModel.PickPrompt("3 skiver gulost",
            [new MealChoice(new MealPart("3 skiver gulost", "cheese", ["gulost"], 35, false), [new MealCandidate(cheese, false, units)])]), StringComparison.Ordinal);

        var choice = new MealChoice(new MealPart("3 skiver gulost", "cheese", ["gulost"], 35, false), [new MealCandidate(cheese, false, units)]);
        var slices = MealDescriber.Resolve(choice, new MealPick(0, 0, 3, "skive (1 slice = 10 g)"));
        Assert.Equal(30, slices.Amount);
        Assert.Equal("g", slices.Unit);
        Assert.Equal(23, MealDescriber.Resolve(choice, new MealPick(0, 0, 1.5m, "SS")).Amount);

        // Twenty slices is 200 g against an estimate of 35 g: the estimate wins.
        var many = MealDescriber.Resolve(choice, new MealPick(0, 0, 20, "skive"));
        Assert.Equal(35, many.Amount);
        Assert.Equal("g", many.Unit);

        Assert.Empty(FoodPortions.Read(new Food { Portions = "not json" }));
        Assert.Null(FoodPortions.Write([]));
    }

    [Fact]
    public async Task A_food_with_no_fit_gets_one_more_search_and_unmatched_cooking_fat_is_left_out()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 20, 13, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("describe-retry");
        var soft = await Food("Quorbzap soft", 300);
        var loaf = await Food("Zingleloaf sweet", 320);
        var mild = await Food("Quorbched mild", 350);
        var model = new ScriptedModel(
            [
                new MealPart("a zap bun", "zap bun", ["quorbzap"], 60, false),
                new MealPart("cheese", "cheese", ["quorbched"], 20, true),
                new MealPart("oil for frying", "oil", ["zzquorbnooil"], 10, true, Added: true),
            ],
            // Nothing fits the bun or the cheese; the bun gets another search. The cheese's suggestion finds nothing new.
            choices => [new MealPick(0, null, 1, "g", ["zingleloaf"]), new MealPick(1, null, 1, "g", ["quorbched"]), new MealPick(2, null, 1, "g")],
            choices => [new MealPick(0, 0, 60, "g")]);
        using var app = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IMealModel>();
            services.AddSingleton<IMealModel>(model);
        }));
        using var client = app.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-Oid", user);
        client.DefaultRequestHeaders.Add("X-Test-Name", "Test User");

        // Living in Sweden: the note carries the food country.
        await TestData.PutWeighIn(client, "2026-11-20", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "Europe/Stockholm"));

        var response = await client.PostAsJsonAsync("/api/describe", new { text = "a zap bun with cheese", time = "07:45" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var items = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").EnumerateArray().ToList();

        // The bun was found on the second search; the cheese stays a row to fix; the oil the model added is gone.
        Assert.Equal(["a zap bun", "cheese"], items.Select(item => item.GetProperty("phrase").GetString()));
        Assert.Equal(loaf, items[0].GetProperty("food").GetProperty("id").GetGuid());
        Assert.Equal(60, items[0].GetProperty("amount").GetDecimal());
        Assert.Equal(JsonValueKind.Null, items[1].GetProperty("food").ValueKind);

        Assert.Equal(2, model.Asked.Count);
        Assert.Contains(model.Asked[0][0].Candidates, candidate => candidate.Food.Id == soft);
        Assert.Contains(model.Asked[0][1].Candidates, candidate => candidate.Food.Id == mild);
        var again = Assert.Single(model.Asked[1]);
        Assert.Equal("a zap bun", again.Part.Phrase);
        Assert.DoesNotContain(again.Candidates, candidate => candidate.Food.Id == soft);
        Assert.Contains(again.Candidates, candidate => candidate.Food.Id == loaf);

        Assert.Equal((new TimeOnly(7, 45), "SE"), (model.Notes.Single().Time, model.Notes.Single().Home));
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(3, (await db.MealDescriptions.SingleAsync(row => row.UserId == user)).Calls);
    }

    [Fact]
    public void The_time_it_was_written_goes_before_the_words()
    {
        Assert.Equal(new TimeOnly(7, 5), MealNote.ReadTime("07:05"));
        Assert.Null(MealNote.ReadTime(null));
        Assert.Null(MealNote.ReadTime("7:05"));
        Assert.Null(MealNote.ReadTime("25:00"));
        Assert.Null(MealNote.ReadTime("07:05:00"));

        var words = JsonSerializer.Serialize(new UserMessageParam { Content = ClaudeMealModel.SplitContent(new MealNote("2 eggs", null, new TimeOnly(7, 5))) });
        Assert.Contains("Written at 07:05. Note: 2 eggs", words, StringComparison.Ordinal);
        var photo = MealPhoto.Read("image/jpeg", Convert.ToBase64String(Jpeg)).Photo!;
        var withPhoto = JsonSerializer.Serialize(new UserMessageParam { Content = ClaudeMealModel.SplitContent(new MealNote("", photo, new TimeOnly(19, 30))) });
        Assert.Contains("Written at 19:30. No words, only the photo.", withPhoto, StringComparison.Ordinal);
    }

    [Fact]
    public void Outside_norway_the_note_says_which_language_to_search_first()
    {
        Assert.Null(new MealNote("2 eggs").HomeHint);
        var swedish = new MealNote("2 eggs", null, new TimeOnly(7, 5), "SE");
        var words = JsonSerializer.Serialize(new UserMessageParam { Content = ClaudeMealModel.SplitContent(swedish) });
        Assert.Contains("search in Swedish first", words, StringComparison.Ordinal);
        Assert.Contains("Written at 07:05. Note: 2 eggs", words, StringComparison.Ordinal);
        Assert.Equal($"2 eggs\n{swedish.HomeHint}", swedish.ForPick);
        Assert.Contains("Finnish first", new MealNote("x", Home: "FI").HomeHint, StringComparison.Ordinal);
        Assert.Contains("English first", new MealNote("x", Home: "GB").HomeHint, StringComparison.Ordinal);
    }

    [Fact]
    public void A_pick_reads_its_suggested_searches()
    {
        using var reply = JsonDocument.Parse("""
            { "picks": [
              { "food": 1, "candidate": 0, "unit": "g", "amount": 50, "retry": ["lompe", " ", "pølsebrød"] },
              { "food": 2, "candidate": 1, "unit": "g", "amount": 10 }
            ] }
            """);

        var picks = ClaudeMealModel.ReadPicks(reply.RootElement);
        Assert.Equal(["lompe", "pølsebrød"], picks[0].Retry!);
        Assert.Empty(picks[1].Retry!);
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

    /// <summary>The start of a JPEG: enough for the type check. The test model never reads the picture.</summary>
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, (byte)'J', (byte)'F', (byte)'I', (byte)'F', 0x00, 0x01];

    private static MealDescription Seed(string user, string text, DateTimeOffset createdAt, string outcome = MealOutcomes.Found) => new()
    {
        Id = Guid.NewGuid(),
        UserId = user,
        Text = text,
        CreatedAt = createdAt,
        Outcome = outcome,
        Model = "rule",
    };

    /// <summary>Splits into the given parts and answers each pick with the next script, recording what it was asked.</summary>
    private sealed class ScriptedModel(IReadOnlyList<MealPart> parts, params Func<IReadOnlyList<MealChoice>, IReadOnlyList<MealPick>>[] picks) : IMealModel
    {
        public string Name => "scripted";

        public List<MealNote> Notes { get; } = [];

        public List<IReadOnlyList<MealChoice>> Asked { get; } = [];

        public Task<IReadOnlyList<MealPart>> SplitAsync(MealNote note, MealUsage usage, CancellationToken cancellationToken)
        {
            Notes.Add(note);
            usage.Add(100, 10);
            return Task.FromResult(parts);
        }

        public Task<IReadOnlyList<MealPick>> PickAsync(string text, IReadOnlyList<MealChoice> choices, MealUsage usage, CancellationToken cancellationToken)
        {
            Asked.Add([.. choices]);
            usage.Add(100, 10);
            return Task.FromResult(Asked.Count <= picks.Length ? picks[Asked.Count - 1](choices) : []);
        }
    }

    private sealed class FailingModel(bool refused) : IMealModel
    {
        public string Name => "failing";

        public Task<IReadOnlyList<MealPart>> SplitAsync(MealNote note, MealUsage usage, CancellationToken cancellationToken)
        {
            // A refusal is an answer, so it is paid for; a call that never got through costs nothing.
            usage.Add(refused ? 120 : 0, refused ? 5 : 0);
            throw new MealModelException("no", refused);
        }

        public Task<IReadOnlyList<MealPick>> PickAsync(string text, IReadOnlyList<MealChoice> choices, MealUsage usage, CancellationToken cancellationToken) =>
            throw new MealModelException("no", refused);
    }
}
