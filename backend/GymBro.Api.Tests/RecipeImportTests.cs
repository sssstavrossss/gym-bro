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
public sealed class RecipeImportTests(ApiFactory factory)
{
    [Fact]
    public async Task A_link_brings_the_recipes_name_portions_and_ingredients_matched_and_saves_nothing()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 24, 12, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("recipe-link");
        using var client = factory.AsUser(user);
        var chicken = await Food("Fictional stew chicken", 110);
        var rice = await Food("Fictional stew rice", 130);

        var response = await client.PostAsJsonAsync("/api/recipes/import", new { url = "https://www.example.com/oppskrift/stew" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Fictional test stew & rice", body.GetProperty("name").GetString());
        Assert.Equal(4, body.GetProperty("portions").GetInt32());
        Assert.Equal("example.com", body.GetProperty("site").GetString());
        Assert.Equal(19, body.GetProperty("left").GetInt32());
        var items = body.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(["400 g fictional stew chicken", "200 g fictional stew rice", "1 klype fictional spice"], items.Select(item => item.GetProperty("phrase").GetString()));
        Assert.Equal(chicken, items[0].GetProperty("food").GetProperty("id").GetGuid());
        Assert.Equal(400m, items[0].GetProperty("amount").GetDecimal());
        Assert.Equal(rice, items[1].GetProperty("food").GetProperty("id").GetGuid());
        Assert.Equal(JsonValueKind.Null, items[2].GetProperty("food").ValueKind);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.Recipes.AnyAsync(recipe => recipe.UserId == user));
        var row = await db.MealDescriptions.SingleAsync(found => found.UserId == user);
        Assert.Equal(MealKinds.Recipe, row.Kind);
        Assert.Equal(MealOutcomes.Found, row.Outcome);
        Assert.Equal("https://www.example.com/oppskrift/stew", row.Text);
        Assert.Equal(2, row.FoodCount);

        // Not a meal description: Describe's list and "use again" never see it.
        var overview = await client.GetFromJsonAsync<JsonElement>("/api/describe");
        Assert.Empty(overview.GetProperty("recent").EnumerateArray());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/describe/{row.Id}")).StatusCode);
    }

    [Fact]
    public async Task Pasted_ingredients_are_one_a_line_with_no_name_or_portions()
    {
        var user = TestData.NewUser("recipe-text");
        using var client = factory.AsUser(user);
        var oats = await Food("Fictional paste oats", 370);

        var response = await client.PostAsJsonAsync("/api/recipes/import", new { text = "  80 g fictional paste oats\n\n  2 dl water, cold  \n" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("", body.GetProperty("name").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("portions").ValueKind);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("site").ValueKind);
        var items = body.GetProperty("items").EnumerateArray().ToList();
        // A comma inside a line doesn't split it: a recipe is one ingredient a line.
        Assert.Equal(["80 g fictional paste oats", "2 dl water, cold"], items.Select(item => item.GetProperty("phrase").GetString()));
        Assert.Equal(oats, items[0].GetProperty("food").GetProperty("id").GetGuid());
    }

    [Theory]
    [InlineData(null, null, RecipeImportEndpoints.Missing)]
    [InlineData("ftp://example.com/stew", null, RecipeImportEndpoints.BadLink)]
    [InlineData("https://example.com:8080/stew", null, RecipeImportEndpoints.BadLink)]
    [InlineData("https://user:pass@example.com/stew", null, RecipeImportEndpoints.BadLink)]
    [InlineData("not a link", null, RecipeImportEndpoints.BadLink)]
    public async Task A_missing_or_unusable_link_is_refused_before_anything_is_fetched(string? url, string? text, string message)
    {
        using var client = factory.AsUser(TestData.NewUser("recipe-bad"));
        var response = await client.PostAsJsonAsync("/api/recipes/import", new { url, text });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(message, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Too_much_text_is_refused()
    {
        using var client = factory.AsUser(TestData.NewUser("recipe-long"));
        var response = await client.PostAsJsonAsync("/api/recipes/import", new { text = new string('a', RecipeImportEndpoints.TextMax + 1) });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(RecipeImportEndpoints.TooLong, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_page_without_a_recipe_or_that_cant_be_read_says_so_and_costs_nothing()
    {
        var user = TestData.NewUser("recipe-none");
        using var client = factory.AsUser(user);
        var none = await client.PostAsJsonAsync("/api/recipes/import", new { url = "https://example.com/no-recipe" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, none.StatusCode);
        Assert.Contains(RecipeImportEndpoints.NoRecipe, await none.Content.ReadAsStringAsync());

        using var app = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IRecipePageFetcher>();
            services.AddSingleton<IRecipePageFetcher>(new NoPage());
        }));
        using var other = app.CreateClient();
        other.DefaultRequestHeaders.Add("X-Test-Oid", user);
        other.DefaultRequestHeaders.Add("X-Test-Name", "Test User");
        var unreadable = await other.PostAsJsonAsync("/api/recipes/import", new { url = "https://example.com/stew" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, unreadable.StatusCode);
        Assert.Contains(RecipeImportEndpoints.Unreadable, await unreadable.Content.ReadAsStringAsync());

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.MealDescriptions.AnyAsync(row => row.UserId == user));
    }

    [Fact]
    public async Task Over_the_daily_limit_it_says_so_before_fetching()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 11, 24, 12, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("recipe-limit");
        using var client = factory.AsUser(user);
        await client.GetAsync("/api/me");
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            for (var i = 0; i < 20; i++)
            {
                db.MealDescriptions.Add(new MealDescription
                {
                    Id = Guid.NewGuid(), UserId = user, Text = "seed " + i, CreatedAt = factory.Clock.GetUtcNow().AddHours(-1),
                    Outcome = MealOutcomes.Found, Model = "rule", Kind = MealKinds.Label,
                });
            }

            await db.SaveChangesAsync();
        }

        var limited = await client.PostAsJsonAsync("/api/recipes/import", new { text = "80 g oats" });
        Assert.Equal((HttpStatusCode)429, limited.StatusCode);
        Assert.Contains(RecipeImportEndpoints.DailyLimitReached, await limited.Content.ReadAsStringAsync());
    }

    [Fact]
    public void The_page_reader_finds_a_recipe_in_a_graph_or_a_list_and_reads_its_yield()
    {
        var page = RecipePage.Read("""
            <script type="application/ld+json">{"@type":"Organization","name":"Not it"}</script>
            <script type='application/ld+json'>
            [{"@type":["Recipe","NewsArticle"],"name":"  Pasta &amp; pesto ","recipeYield":"4-6 servings",
              "recipeIngredient":["<a href='/x'>200 g</a> pasta","", "1 dl pesto", ],}]
            </script>
            """)!;
        Assert.Equal("Pasta & pesto", page.Name);
        Assert.Equal(4, page.Portions);
        Assert.Equal(["200 g pasta", "1 dl pesto"], page.Ingredients);

        Assert.Null(RecipePage.Read("<script type=\"application/ld+json\">{\"@type\":\"Recipe\",\"name\":\"No lines\"}</script>"));
        Assert.Null(RecipePage.Read("<script type=\"application/ld+json\">{ broken</script>"));
        Assert.Null(RecipePage.Read("<html>No data</html>"));

        using var yields = JsonDocument.Parse("""[4, "2 porsjoner", ["", "6"], "0", 1000, 2.5, "about four"]""");
        var read = yields.RootElement.EnumerateArray().Select(RecipePage.YieldPortions).ToList();
        Assert.Equal([4, 2, 6, null, null, null, null], read);

        var many = RecipePage.Read("<script type=\"application/ld+json\">{\"@type\":\"Recipe\",\"recipeIngredient\":["
            + string.Join(",", Enumerable.Range(1, 50).Select(i => $"\"{i} g x\"")) + "]}</script>")!;
        Assert.Equal(RecipePage.IngredientsMax, many.Ingredients.Count);
    }

    [Theory]
    [InlineData("93.184.215.14", true)]
    [InlineData("2606:4700::6810:84e5", true)]
    [InlineData("127.0.0.1", false)]
    [InlineData("10.1.2.3", false)]
    [InlineData("172.20.0.5", false)]
    [InlineData("192.168.1.10", false)]
    [InlineData("100.101.102.103", false)]
    [InlineData("169.254.169.254", false)]
    [InlineData("0.0.0.0", false)]
    [InlineData("224.0.0.1", false)]
    [InlineData("::1", false)]
    [InlineData("::ffff:192.168.1.10", false)]
    [InlineData("fd7a:115c:a1e0::1", false)]
    [InlineData("fe80::1", false)]
    [InlineData("2002:c0a8:0101::1", false)]
    [InlineData("64:ff9b::a00:1", false)]
    public void Only_public_internet_addresses_are_fetched(string address, bool expected)
    {
        Assert.Equal(expected, PublicAddress.IsPublic(IPAddress.Parse(address)));
    }

    [Fact]
    public async Task The_real_fetcher_refuses_a_private_address_without_connecting()
    {
        var fetcher = new PublicPageFetcher(Microsoft.Extensions.Logging.Abstractions.NullLogger<PublicPageFetcher>.Instance);
        Assert.Null(await fetcher.FetchAsync(new Uri("http://127.0.0.1/"), CancellationToken.None));
        Assert.Null(await fetcher.FetchAsync(new Uri("http://localhost/"), CancellationToken.None));
        Assert.Null(await fetcher.FetchAsync(new Uri("http://169.254.169.254/latest/meta-data/"), CancellationToken.None));
    }

    [Fact]
    public void A_recipe_note_tells_both_questions_it_is_a_recipe()
    {
        var note = new MealNote("400 g kylling\n3 dl ris", Recipe: true);
        Assert.StartsWith(MealNote.RecipeNote, note.ForPick);
        Assert.EndsWith("Ingredients:\n400 g kylling\n3 dl ris", note.ForPick);
        var split = JsonSerializer.Serialize(new Anthropic.Models.Messages.UserMessageParam { Content = ClaudeMealModel.SplitContent(note) });
        Assert.Contains("not a meal", split);
        Assert.Contains("400 g kylling\\n3 dl ris", split);
        Assert.Equal("2 eggs", new MealNote("2 eggs").ForPick);
    }

    private async Task<Guid> Food(string name, decimal kcal)
    {
        var id = Guid.NewGuid();
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Foods.Add(new Food
        {
            Id = id,
            Source = "test",
            SourceId = "recipe-import-" + id.ToString("N"),
            Name = name,
            Basis = "g",
            NutrientBasis = NutrientBases.Per100,
            KcalPer100 = kcal,
            ProteinPer100 = 5,
            FatPer100 = 5,
            CarbsPer100 = 5,
            UpdatedAt = factory.Clock.GetUtcNow(),
        });
        await db.SaveChangesAsync();
        return id;
    }

    private sealed class NoPage : IRecipePageFetcher
    {
        public Task<string?> FetchAsync(Uri url, CancellationToken cancellationToken) => Task.FromResult<string?>(null);
    }
}
