using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class FoodSearchPartialTests(ApiFactory factory)
{
    [Fact]
    public async Task Partial_words_stay_on_one_food_and_exact_names_rank_first()
    {
        var user = TestData.NewUser("partial-a");
        var stranger = TestData.NewUser("partial-b");
        using var client = factory.AsUser(user);
        using var other = factory.AsUser(stranger);
        var ids = new[] { "srch.raw", "srch.fried", "srch.thigh", "srch.bread", "srch.turkey", "srch.exact" };
        try
        {
            await Clear(ids);
            await Add(client, "srch.raw", "Kylling, filet, uten skinn, rå", "Chicken, fillet, without skin, raw",
                ["chicken breast", "chicken breast fillet", "raw chicken breast", "kyllingbryst", "kylling bryst"]);
            await Add(client, "srch.fried", "Kylling, filet, stekt i fett", "Chicken fillet, fried in fat",
                ["chicken breast", "fried chicken breast", "chicken fillet"]);
            await Add(client, "srch.thigh", "Kylling, overlår, rå", "Chicken, thigh, raw", []);
            await Add(client, "srch.bread", "Kyllingburger, panert", "Chicken burger, breaded", []);
            await Add(client, "srch.turkey", "Kalkun, bryst, rå", "Turkey, breast, raw", []);
            await Add(client, "srch.exact", "Hirse", "Millet", []);
            for (var i = 0; i < 30; i++)
            {
                await Add(client, "srch.millet." + i, "Hirsebolle " + i, "Millet roll " + i, []);
            }

            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var retired = await db.Foods.SingleAsync(food => food.SourceId == "srch.raw");
                var copy = new Food
                {
                    Id = Guid.NewGuid(),
                    Source = "mvt",
                    SourceId = "srch.retired",
                    Name = retired.Name,
                    NameEn = retired.NameEn,
                    Basis = "g",
                    NutrientBasis = NutrientBases.Per100,
                    KcalPer100 = retired.KcalPer100,
                    UpdatedAt = DateTimeOffset.UtcNow,
                    RetiredAt = DateTimeOffset.UtcNow,
                };
                db.Foods.Add(copy);
                db.FoodAliases.Add(new FoodAlias
                {
                    Id = Guid.NewGuid(),
                    Source = "mvt",
                    SourceId = "srch.retired",
                    Phrase = "chicken breast",
                    Normalized = "chicken breast",
                    ExpectedNameEn = copy.NameEn ?? "",
                });
                await db.SaveChangesAsync();
            }

            var breast = await Ids(client, "chicken breast");
            Assert.Equal(["srch.fried", "srch.raw"], breast.OrderBy(id => id));
            Assert.DoesNotContain("srch.thigh", breast);
            Assert.DoesNotContain("srch.turkey", await Ids(client, "chicken br"));

            var typing = await Ids(client, "chicken br");
            Assert.Equal(["srch.fried", "srch.raw"], typing.Take(2).OrderBy(id => id));
            Assert.Contains("srch.bread", typing);
            Assert.True(typing.IndexOf("srch.raw") < typing.IndexOf("srch.bread"));
            Assert.True(typing.IndexOf("srch.fried") < typing.IndexOf("srch.bread"));
            Assert.DoesNotContain("srch.thigh", typing);
            Assert.DoesNotContain("srch.retired", typing);

            Assert.Equal(["srch.raw"], await Ids(client, "raw chicken br"));
            Assert.Equal(["srch.fried"], await Ids(client, "fried chicken br"));
            Assert.Equal(["srch.fried", "srch.raw"], (await Ids(client, "chicken fillet")).OrderBy(id => id));
            Assert.Equal(["srch.raw"], await Ids(client, "kyllingbr"));
            Assert.Equal(["srch.raw"], await Ids(client, "kylling br"));
            Assert.Equal(typing, await Ids(client, "  Chicken-BR "));
            Assert.Equal(["srch.fried", "srch.raw"], (await Ids(client, "fillet chicken")).OrderBy(id => id));

            var exactName = await Ids(client, "Chicken fillet, fried in fat");
            Assert.Equal("srch.fried", exactName[0]);

            var millet = await Ids(client, "millet");
            Assert.Equal(25, millet.Count);
            Assert.Equal("srch.exact", millet[0]);

            var custom = await other.PostAsJsonAsync("/api/foods", new
            {
                name = "Chicken breast house blend",
                kcalPer100 = 10,
                proteinPer100 = 1,
                fatPer100 = 1,
                carbsPer100 = 1,
            });
            Assert.True(custom.IsSuccessStatusCode, await custom.Content.ReadAsStringAsync());
            var privateId = (await custom.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
            Assert.Contains(privateId, await FoodIds(other, "chicken br"));
            Assert.DoesNotContain(privateId, await FoodIds(client, "chicken br"));

            var bare = await Ids(client, "breast");
            Assert.Contains("srch.turkey", bare);
            Assert.Contains("srch.raw", bare);
            Assert.DoesNotContain("srch.thigh", bare);
        }
        finally
        {
            await Clear(ids.Append("srch.retired").Concat(Enumerable.Range(0, 30).Select(i => "srch.millet." + i)).ToArray());
        }
    }

    [Fact]
    public async Task Catalogue_prefix_search_stays_fast_on_the_pinned_names()
    {
        var file = FoodAliasPlanTests.LoadNames();
        var ids = file.Foods.Select(food => food.Id).ToArray();
        var user = TestData.NewUser("partial-cat");
        using var client = factory.AsUser(user);
        try
        {
            await Clear(ids);
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var now = DateTimeOffset.UtcNow;
                db.Foods.AddRange(file.Foods.Select(food => new Food
                {
                    Id = Guid.NewGuid(),
                    Source = "mvt",
                    SourceId = food.Id,
                    Name = food.Nb,
                    NameEn = food.En,
                    Basis = "g",
                    NutrientBasis = NutrientBases.Per100,
                    KcalPer100 = 1,
                    UpdatedAt = now,
                }));
                await db.SaveChangesAsync();
                await FoodAliasCatalogue.ApplyAsync(db, CancellationToken.None);
            }

            var watch = Stopwatch.StartNew();
            var typing = await Ids(client, "chicken br");
            var raw = await Ids(client, "raw chicken br");
            var fried = await Ids(client, "fried chicken br");
            watch.Stop();
            await File.WriteAllTextAsync("/tmp/food-search-latency.txt", watch.ElapsedMilliseconds.ToString());

            Assert.Contains("03.205", typing);
            Assert.Contains("03.242", typing);
            Assert.DoesNotContain("03.330", typing);
            Assert.Equal("03.205", raw[0]);
            Assert.DoesNotContain("03.242", raw);
            Assert.DoesNotContain("03.330", raw);
            Assert.Contains("03.242", fried);
            Assert.Contains("03.481", fried);
            Assert.DoesNotContain("03.205", fried);
            Assert.True(watch.ElapsedMilliseconds < 3000, watch.ElapsedMilliseconds + " ms");
        }
        finally
        {
            await Clear(ids);
        }
    }

    private async Task Add(HttpClient client, string sourceId, string name, string nameEn, string[] phrases)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Foods.Add(new Food
        {
            Id = Guid.NewGuid(),
            Source = "mvt",
            SourceId = sourceId,
            Name = name,
            NameEn = nameEn,
            Basis = "g",
            NutrientBasis = NutrientBases.Per100,
            KcalPer100 = 100,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        foreach (var phrase in phrases)
        {
            db.FoodAliases.Add(new FoodAlias
            {
                Id = Guid.NewGuid(),
                Source = "mvt",
                SourceId = sourceId,
                Phrase = phrase,
                Normalized = FoodAliasCatalogue.Normalize(phrase),
                ExpectedNameEn = nameEn,
            });
        }

        await db.SaveChangesAsync();
        _ = client;
    }

    private async Task Clear(string[] ids)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.FoodAliases.Where(alias => alias.Source == "mvt" && ids.Contains(alias.SourceId)).ExecuteDeleteAsync();
        await db.Foods.Where(food => food.Source == "mvt" && ids.Contains(food.SourceId)).ExecuteDeleteAsync();
    }

    private static async Task<List<string>> Ids(HttpClient client, string query)
    {
        var body = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=" + Uri.EscapeDataString(query));
        return body.GetProperty("foods").EnumerateArray().Select(row => row.GetProperty("sourceId").GetString() ?? "").ToList();
    }

    private static async Task<List<Guid>> FoodIds(HttpClient client, string query)
    {
        var body = await client.GetFromJsonAsync<JsonElement>("/api/foods/search?q=" + Uri.EscapeDataString(query));
        return body.GetProperty("foods").EnumerateArray().Select(row => row.GetProperty("id").GetGuid()).ToList();
    }
}
