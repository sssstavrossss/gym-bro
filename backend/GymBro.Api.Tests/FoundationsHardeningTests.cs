using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Hosting;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class FoundationsHardeningTests(ApiFactory factory)
{
    [Fact]
    public async Task Security_headers_are_present_on_api_and_unknown_routes()
    {
        using var client = factory.CreateClient();
        foreach (var path in new[] { "/api/health", "/not-a-page" })
        {
            var response = await client.GetAsync(path);
            Assert.Equal(SecurityHeaders.ContentSecurityPolicy, response.Headers.GetValues("Content-Security-Policy").Single());
            Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
            Assert.Equal("SAMEORIGIN", response.Headers.GetValues("X-Frame-Options").Single());
            Assert.Equal("strict-origin-when-cross-origin", response.Headers.GetValues("Referrer-Policy").Single());
            var policy = response.Headers.GetValues("Content-Security-Policy").Single();
            Assert.Contains("frame-src 'self' https://*.ciamlogin.com", policy, StringComparison.Ordinal);
            Assert.Contains("frame-ancestors 'self'", policy, StringComparison.Ordinal);
            Assert.Contains("https://*.ciamlogin.com", policy, StringComparison.Ordinal);
            Assert.DoesNotContain("unsafe-eval", policy, StringComparison.Ordinal);
            Assert.DoesNotContain("script-src 'self' 'unsafe-inline'", policy, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Silent_renewal_frame_policy_allows_the_redirect_page_and_ciam()
    {
        using var client = factory.CreateClient();
        var response = await client.GetAsync("/api/health");
        var policy = response.Headers.GetValues("Content-Security-Policy").Single();
        Assert.Contains("frame-src 'self' https://*.ciamlogin.com", policy, StringComparison.Ordinal);
        Assert.Contains("frame-ancestors 'self'", policy, StringComparison.Ordinal);
        Assert.Equal("SAMEORIGIN", response.Headers.GetValues("X-Frame-Options").Single());
    }

    [Fact]
    public void Data_protection_keys_are_written_under_the_content_root()
    {
        using var scope = factory.Services.CreateScope();
        var protector = scope.ServiceProvider.GetRequiredService<IDataProtectionProvider>().CreateProtector("gymbro-tests");
        Assert.Equal("phase-3", protector.Unprotect(protector.Protect("phase-3")));

        var env = scope.ServiceProvider.GetRequiredService<IWebHostEnvironment>();
        var keys = Path.Combine(env.ContentRootPath, ".data", "keys");
        Assert.True(Directory.Exists(keys), keys);
        Assert.Contains(Directory.GetFiles(keys), path => Path.GetFileName(path).StartsWith("key-", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_per_serving_food_stores_one_serving_and_rejects_a_gram_weight()
    {
        using var client = factory.AsUser(TestData.NewUser("per-serving"));
        var created = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional scoop",
            nutrientBasis = "per_serving",
            kcalPer100 = 180,
            proteinPer100 = 20,
            fatPer100 = 4,
            carbsPer100 = 8,
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var food = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("per_serving", food.GetProperty("nutrientBasis").GetString());
        Assert.Equal("serving", food.GetProperty("basis").GetString());
        Assert.Equal(180, food.GetProperty("kcalPer100").GetDecimal());
        Assert.Equal(JsonValueKind.Null, food.GetProperty("servingQuantity").ValueKind);

        var weighed = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional weighed scoop",
            nutrientBasis = "per_serving",
            kcalPer100 = 180,
            proteinPer100 = 20,
            fatPer100 = 4,
            carbsPer100 = 8,
            servingQuantity = 40,
        });
        Assert.Equal(HttpStatusCode.BadRequest, weighed.StatusCode);
    }

    [Fact]
    public async Task Adding_a_weight_later_scales_future_values_and_leaves_the_log_snapshot()
    {
        var user = TestData.NewUser("scale");
        using var client = factory.AsUser(user);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/me")).StatusCode);
        var created = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional bite",
            nutrientBasis = "per_serving",
            kcalPer100 = 200,
            proteinPer100 = 10,
            fatPer100 = 5,
            carbsPer100 = 20,
            servingLabel = "bite",
        });
        var foodId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.LogEntries.Add(Entry(user, foodId, user, grams: null, kcal: 200, key: "snap-" + foodId.ToString("N")));
            await db.SaveChangesAsync();
        }

        var tooDense = await client.PutAsJsonAsync("/api/foods/" + foodId, new
        {
            name = "Fictional bite",
            nutrientBasis = "per_serving",
            kcalPer100 = 600,
            proteinPer100 = 10,
            fatPer100 = 5,
            carbsPer100 = 20,
            servingQuantity = 40,
            servingLabel = "bite",
        });
        Assert.Equal(HttpStatusCode.BadRequest, tooDense.StatusCode);

        var updated = await client.PutAsJsonAsync("/api/foods/" + foodId, new
        {
            name = "Fictional bite",
            nutrientBasis = "per_serving",
            kcalPer100 = 200,
            proteinPer100 = 10,
            fatPer100 = 5,
            carbsPer100 = 20,
            servingQuantity = 50,
            servingLabel = "bite",
        });
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var body = await updated.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("per_100", body.GetProperty("nutrientBasis").GetString());
        Assert.Equal("g", body.GetProperty("basis").GetString());
        Assert.Equal(400, body.GetProperty("kcalPer100").GetDecimal());
        Assert.Equal(20, body.GetProperty("proteinPer100").GetDecimal());
        Assert.Equal(50, body.GetProperty("servingQuantity").GetDecimal());

        await using var check = factory.Services.CreateAsyncScope();
        var saved = check.ServiceProvider.GetRequiredService<AppDbContext>();
        var log = await saved.LogEntries.SingleAsync(row => row.UserId == user && row.FoodId == foodId);
        Assert.Null(log.Grams);
        Assert.Equal(200, log.Kcal);
    }

    [Fact]
    public async Task Serving_and_piece_labels_longer_than_80_characters_are_400()
    {
        using var client = factory.AsUser(TestData.NewUser("labels"));
        var ok = await client.PostAsJsonAsync("/api/foods", Custom("ok", new string('a', 80), null));
        Assert.Equal(HttpStatusCode.Created, ok.StatusCode);

        var serving = await client.PostAsJsonAsync("/api/foods", Custom("serving", new string('b', 81), null));
        Assert.Equal(HttpStatusCode.BadRequest, serving.StatusCode);
        Assert.Contains("80", await serving.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        var piece = await client.PostAsJsonAsync("/api/foods", Custom("piece", null, new string('c', 81)));
        Assert.Equal(HttpStatusCode.BadRequest, piece.StatusCode);
    }

    [Fact]
    public async Task Log_rows_can_reference_catalogue_and_own_foods_only()
    {
        var owner = TestData.NewUser("fk-owner");
        var other = TestData.NewUser("fk-other");
        using var ownerClient = factory.AsUser(owner);
        using var otherClient = factory.AsUser(other);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync("/api/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await otherClient.GetAsync("/api/me")).StatusCode);
        var created = await ownerClient.PostAsJsonAsync("/api/foods", Custom("Private", "bar", null));
        var customId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var catalogueId = Guid.NewGuid();
        db.Foods.Add(new Food
        {
            Id = catalogueId,
            UserId = null,
            Source = "off",
            SourceId = "fk-" + catalogueId.ToString("N"),
            Name = "Fictional catalogue oats",
            Basis = "g",
            NutrientBasis = NutrientBases.Per100,
            KcalPer100 = 100,
            ProteinPer100 = 1,
            FatPer100 = 1,
            CarbsPer100 = 1,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        var ownGroup = new EntryGroup
        {
            Id = Guid.NewGuid(),
            UserId = owner,
            Name = "Own bowl",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        var otherGroup = new EntryGroup
        {
            Id = Guid.NewGuid(),
            UserId = other,
            Name = "Other bowl",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.EntryGroups.AddRange(ownGroup, otherGroup);
        await db.SaveChangesAsync();

        db.LogEntries.Add(Entry(owner, catalogueId, Food.CatalogueOwnerKey, grams: null, kcal: 100, key: "cat-" + catalogueId.ToString("N")[..16]));
        db.LogEntries.Add(Entry(owner, customId, owner, grams: 40, kcal: 100, key: "own-" + customId.ToString("N")[..16], groupId: ownGroup.Id));
        await db.SaveChangesAsync();

        db.ChangeTracker.Clear();
        db.LogEntries.Add(Entry(other, customId, other, grams: 40, kcal: 100, key: "spoof-key"));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());

        db.ChangeTracker.Clear();
        db.LogEntries.Add(Entry(owner, null, Food.CatalogueOwnerKey, grams: null, kcal: 10, key: "group-ok", groupId: ownGroup.Id));
        await db.SaveChangesAsync();

        db.ChangeTracker.Clear();
        db.LogEntries.Add(Entry(owner, null, Food.CatalogueOwnerKey, grams: null, kcal: 10, key: "group-no", groupId: otherGroup.Id));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());

        db.ChangeTracker.Clear();
        var food = await db.Foods.SingleAsync(row => row.Id == customId);
        db.Foods.Remove(food);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        var cleared = await db.LogEntries.SingleAsync(row => row.UserId == owner && row.IdempotencyKey.StartsWith("own-"));
        Assert.Null(cleared.FoodId);
        Assert.Equal(owner, cleared.FoodOwnerKey);
        Assert.Equal(40, cleared.Grams);
    }

    private static object Custom(string name, string? servingLabel, string? pieceLabel) => new
    {
        name = "Fictional " + name,
        kcalPer100 = 10,
        proteinPer100 = 1,
        fatPer100 = 1,
        carbsPer100 = 1,
        basis = "g",
        servingLabel,
        pieceLabel,
    };

    private static LogEntry Entry(
        string userId,
        Guid? foodId,
        string foodOwnerKey,
        decimal? grams,
        decimal kcal,
        string key,
        Guid? groupId = null) => new()
    {
        Id = Guid.NewGuid(),
        UserId = userId,
        LocalDate = new DateOnly(2026, 10, 24),
        LoggedAt = new DateTime(2026, 10, 24, 8, 0, 0),
        TimeZone = "UTC",
        FoodId = foodId,
        FoodOwnerKey = foodOwnerKey,
        GroupId = groupId,
        Name = "Fictional logged food",
        Source = foodId is null ? "manual" : "custom",
        Grams = grams,
        Amount = 1,
        Unit = grams is null ? "serving" : "g",
        Kcal = kcal,
        Protein = 1,
        Fat = 1,
        Carbs = 1,
        IdempotencyKey = key,
    };
}
