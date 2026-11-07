using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

public sealed class FoodAliasTextTests
{
    [Theory]
    [InlineData("Chicken Breast", "chicken breast")]
    [InlineData("  chicken   breast  ", "chicken breast")]
    [InlineData("chicken-breast", "chicken breast")]
    [InlineData("chicken/breast", "chicken breast")]
    [InlineData("chicken breast.", "chicken breast")]
    [InlineData("KYLLINGBRYST", "kyllingbryst")]
    [InlineData("Hønebryst", "hønebryst")]
    [InlineData("...", "")]
    public void Phrases_ignore_case_punctuation_and_extra_spaces(string raw, string expected)
    {
        Assert.Equal(expected, FoodAliasCatalogue.Normalize(raw));
    }
}

[Collection(ApiCollection.Name)]
public sealed class FoodAliasTests(ApiFactory factory)
{
    private static readonly string[] FilletIds = ["03.205", "03.242", "03.418", "03.481"];

    private static readonly string[] OwnedIds =
    [
        "03.205", "03.242", "03.418", "03.481", "03.224", "03.236", "03.204", "03.241", "03.323", "03.330", "03.511",
    ];

    [Fact]
    public async Task Chicken_breast_finds_the_fillets_and_aliases_survive_import()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        try
        {
            var first = await Import(friedEnglishName: "Chicken drumstick, not a fillet");
            Assert.Equal(11, first.Upserted);
            var beforeFix = await Search("chicken breast");
            Assert.DoesNotContain(beforeFix, id => id == "03.242");
            Assert.Contains("03.205", beforeFix);

            var fixedImport = await Import(friedEnglishName: "Chicken fillet, fried in fat");
            Assert.Equal(11, fixedImport.Upserted);
            Assert.Equal(0, fixedImport.Retired);

            var user = TestData.NewUser("alias-a");
            var stranger = TestData.NewUser("alias-b");
            using var client = factory.AsUser(user);
            using var other = factory.AsUser(stranger);
            await Setup(client);

            var breast = await Search(client, "chicken breast");
            var fillet = await Search(client, "chicken fillet");
            Assert.Equal(FilletIds.OrderBy(id => id), breast.OrderBy(id => id));
            Assert.Equal(FilletIds.OrderBy(id => id), fillet.OrderBy(id => id));
            Assert.Equal(breast.Count, breast.Distinct().Count());

            Assert.Equal(breast, await Search(client, "  CHICKEN   BREAST "));
            Assert.Equal(breast, await Search(client, "chicken-breast"));
            Assert.Equal(breast, await Search(client, "chicken breast."));
            Assert.Equal(FilletIds.OrderBy(id => id), (await Search(client, "kyllingbryst")).OrderBy(id => id));
            Assert.Equal(FilletIds.OrderBy(id => id), (await Search(client, "kylling bryst")).OrderBy(id => id));

            Assert.Equal(["03.224"], await Search(client, "hen breast"));
            Assert.Equal(["03.224"], await Search(client, "hønebryst"));
            Assert.DoesNotContain("03.236", await Search(client, "hen breast"));
            Assert.Equal(["03.204", "03.241"], (await Search(client, "turkey fillet")).OrderBy(id => id));
            Assert.DoesNotContain("03.323", await Search(client, "turkey fillet"));

            Assert.DoesNotContain("03.330", breast);
            Assert.DoesNotContain("03.511", breast);
            Assert.Contains("03.330", await Search(client, "thigh"));
            Assert.Contains("03.330", await Search(client, "overlår"));
            Assert.Contains("03.511", await Search(client, "butter chicken"));
            Assert.Empty(await Search(client, "breast fillet"));
            var rawChicken = await Search(client, "raw chicken");
            Assert.Contains("03.205", rawChicken);
            Assert.Contains("03.330", rawChicken);
            Assert.DoesNotContain("03.242", rawChicken);
            Assert.DoesNotContain("03.511", rawChicken);

            var exact = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=Chicken%20fillet%2C%20fried%20in%20fat");
            var exactRows = exact.GetProperty("foods").EnumerateArray().ToList();
            var exactMatch = Assert.Single(exactRows);
            Assert.Equal("03.242", exactMatch.GetProperty("sourceId").GetString());
            Assert.False(exactMatch.TryGetProperty("aliases", out _));
            Assert.Equal("Chicken fillet, fried in fat", exactMatch.GetProperty("nameEn").GetString());

            var created = await other.PostAsJsonAsync("/api/foods", new
            {
                name = "Chicken breast",
                kcalPer100 = 99,
                proteinPer100 = 1,
                fatPer100 = 1,
                carbsPer100 = 1,
            });
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
            var privateId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
            Assert.Contains(privateId, await FoodIds(other, "chicken breast"));
            Assert.DoesNotContain(privateId, await FoodIds(client, "chicken breast"));

            var found = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=chicken%20breast");
            var raw = found.GetProperty("foods").EnumerateArray().Single(row => row.GetProperty("sourceId").GetString() == "03.205");
            var foodId = raw.GetProperty("id").GetGuid();
            Assert.Equal(110, raw.GetProperty("kcalPer100").GetDecimal());
            var logged = await client.PostAsync("/api/log-entries", Json(Entry("alias-snap", foodId)));
            Assert.Equal(HttpStatusCode.Created, logged.StatusCode);
            var snapshot = await logged.Content.ReadFromJsonAsync<JsonElement>();
            var entryId = snapshot.GetProperty("id").GetGuid();
            Assert.Equal(110, snapshot.GetProperty("kcal").GetDecimal());
            Assert.Equal("Kylling, filet, uten skinn, rå", snapshot.GetProperty("name").GetString());

            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.Foods.SingleAsync(food => food.Source == "mvt" && food.SourceId == "03.481");
                row.NameEn = "Renamed snack";
                await db.SaveChangesAsync();
                var applied = await FoodAliasCatalogue.ApplyAsync(db, CancellationToken.None);
                Assert.Equal(0, applied.Inserted);
                Assert.DoesNotContain("03.481", await Search(client, "chicken breast"));

                row.NameEn = "Chicken fillet, fried without fat";
                await db.SaveChangesAsync();
            }

            var again = await Import(friedEnglishName: "Chicken fillet, fried in fat");
            Assert.Equal(11, again.Upserted);
            var restored = await Search(client, "chicken breast");
            Assert.Equal(FilletIds.OrderBy(id => id), restored.OrderBy(id => id));

            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var second = await FoodAliasCatalogue.ApplyAsync(db, CancellationToken.None);
                Assert.Equal(0, second.Inserted);
                Assert.True(second.AlreadyPresent > 0);
                var stored = await db.FoodAliases
                    .Where(alias => OwnedIds.Contains(alias.SourceId))
                    .Select(alias => new { alias.SourceId, alias.Normalized })
                    .ToListAsync();
                foreach (var seed in FoodAliasCatalogue.Seeds)
                {
                    foreach (var phrase in seed.Phrases)
                    {
                        var normalized = FoodAliasCatalogue.Normalize(phrase);
                        Assert.Contains(stored, alias => alias.SourceId == seed.SourceId && alias.Normalized == normalized);
                    }
                }

                Assert.True(stored.Count >= 25);
                var copies = await db.Foods.CountAsync(food => food.Source == "mvt" && food.SourceId == "03.205");
                Assert.Equal(1, copies);
                var food = await db.Foods.SingleAsync(row => row.Source == "mvt" && row.SourceId == "03.205");
                Assert.Equal(110, food.KcalPer100);
                Assert.Equal("Kylling, filet, uten skinn, rå", food.Name);
                var entry = await db.LogEntries.SingleAsync(row => row.Id == entryId);
                Assert.Equal(110, entry.Kcal);
                Assert.Equal("Kylling, filet, uten skinn, rå", entry.Name);
                var customAliases = await db.FoodAliases.CountAsync(alias => alias.Source == "custom");
                Assert.Equal(0, customAliases);
            }

            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.Foods.SingleAsync(food => food.Source == "mvt" && food.SourceId == "03.205");
                row.RetiredAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync();
            }

            Assert.DoesNotContain("03.205", await Search(client, "chicken breast"));
            Assert.Contains("03.242", await Search(client, "chicken breast"));
        }
        finally
        {
            await using var scope = factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var rows = await db.Foods.Where(food => food.Source == "mvt" && OwnedIds.Contains(food.SourceId)).ToListAsync();
            var now = DateTimeOffset.UtcNow;
            foreach (var row in rows)
            {
                row.RetiredAt ??= now;
            }

            if (rows.Count > 0)
            {
                await db.SaveChangesAsync();
            }
        }
    }

    private async Task<List<string>> Search(string query)
    {
        using var client = factory.AsUser(TestData.NewUser("alias-probe"));
        return await Search(client, query);
    }

    private static async Task<List<string>> Search(HttpClient client, string query)
    {
        var response = await client.GetAsync("/api/foods/search?q=" + Uri.EscapeDataString(query));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("foods").EnumerateArray()
            .Select(row => row.GetProperty("sourceId").GetString() ?? "")
            .ToList();
    }

    private static async Task<List<Guid>> FoodIds(HttpClient client, string query)
    {
        var body = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=" + Uri.EscapeDataString(query));
        return body.GetProperty("foods").EnumerateArray().Select(row => row.GetProperty("id").GetGuid()).ToList();
    }

    private async Task<MatvaretabellenImportResult> Import(string friedEnglishName)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var importer = scope.ServiceProvider.GetRequiredService<MatvaretabellenImporter>();
        await using var nb = new MemoryStream(Encoding.UTF8.GetBytes(Norwegian()));
        await using var en = new MemoryStream(Encoding.UTF8.GetBytes(English(friedEnglishName)));
        return await importer.ImportAsync(nb, en, CancellationToken.None);
    }

    private static string Norwegian() =>
        $$"""
        {
          "foods": [
            {{Food("03.205", "Kylling, filet, uten skinn, rå", 110)}},
            {{Food("03.242", "Kylling, filet, stekt i fett", 160)}},
            {{Food("03.418", "Kylling, filet, kokt", 130)}},
            {{Food("03.481", "Kylling, filet, stekt uten fett", 140)}},
            {{Food("03.224", "Høne, bryst, filet, uten skinn, rå", 150)}},
            {{Food("03.236", "Høne, filet, kokt", 155)}},
            {{Food("03.204", "Kalkun, bryst, filet, uten skinn, rå", 120)}},
            {{Food("03.241", "Kalkun, brystfilet, uten skinn, ovnsstekt", 125)}},
            {{Food("03.323", "Kalkunfilet, naturell/røkt", 100)}},
            {{Food("03.330", "Kylling, overlår (lår uten lårklubbe), med skinn, rå", 200)}},
            {{Food("03.511", "Kylling i smørsaus, butter chicken, kjøpt", 180)}}
          ]
        }
        """;

    private static string English(string friedEnglishName) =>
        $$"""
        {
          "foods": [
            { "foodId": "03.205", "foodName": "Chicken, fillet, without skin, raw" },
            { "foodId": "03.242", "foodName": "{{friedEnglishName}}" },
            { "foodId": "03.418", "foodName": "Chicken, fillet, simmered" },
            { "foodId": "03.481", "foodName": "Chicken fillet, fried without fat" },
            { "foodId": "03.224", "foodName": "Hen, fillet, raw" },
            { "foodId": "03.236", "foodName": "Hen, fillet, boiled" },
            { "foodId": "03.204", "foodName": "Turkey, breast, without skin, raw" },
            { "foodId": "03.241", "foodName": "Turkey breast, without skin, roasted" },
            { "foodId": "03.323", "foodName": "Ham, turkey, smoked" },
            { "foodId": "03.330", "foodName": "Chicken, thigh (leg without drumstick), with skin, raw" },
            { "foodId": "03.511", "foodName": "Butter chicken, industrially made" }
          ]
        }
        """;

    private static string Food(string id, string name, int kcal) =>
        $$"""
        {
          "foodId": "{{id}}",
          "foodName": "{{name}}",
          "calories": { "quantity": {{kcal}}, "unit": "kcal" },
          "constituents": [
            { "nutrientId": "Protein", "quantity": 20, "unit": "g" },
            { "nutrientId": "Fett", "quantity": 2, "unit": "g" },
            { "nutrientId": "Karbo", "quantity": 0, "unit": "g" }
          ],
          "portions": []
        }
        """;

    private static async Task Setup(HttpClient client)
    {
        await TestData.PutWeighIn(client, "2026-10-24", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "UTC"));
    }

    private static string Entry(string key, Guid foodId) =>
        $$"""
        {"idempotencyKey":"{{key}}","localDate":"2026-10-24","timeZone":"UTC","foodId":"{{foodId}}","amount":100,"unit":"g"}
        """;

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");
}
