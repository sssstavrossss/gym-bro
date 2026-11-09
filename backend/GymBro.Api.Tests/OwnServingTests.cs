using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Logging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

public sealed class OwnServingRuleTests
{
    [Fact]
    public void A_named_serving_uses_the_grams_given_at_log_time()
    {
        var food = new Food
        {
            Basis = "g",
            NutrientBasis = NutrientBases.Per100,
            KcalPer100 = 200,
            ProteinPer100 = 30,
            FatPer100 = 4,
            CarbsPer100 = 0,
            ServingQuantity = 40,
        };
        var logged = LogEntryRules.Snapshot(food, 2, "slice", 35);
        Assert.Null(logged.Error);
        Assert.Equal("slice", logged.Unit);
        Assert.Equal(70, logged.Grams);
        Assert.Equal(140, logged.Kcal);
        Assert.Equal(21, logged.Protein);

        var entry = new LogEntry { Amount = 2, Unit = "slice", Grams = 70, Kcal = 140, Protein = 21, Fat = 2.8m, Carbs = 0 };
        var scaled = LogEntryRules.ScaleStored(entry, 3, "slice");
        Assert.Null(scaled.Error);
        Assert.Equal(105, scaled.Grams);
        Assert.Equal(210, scaled.Kcal);
        var asGrams = LogEntryRules.ScaleStored(entry, 70, "g");
        Assert.Equal(70, asGrams.Grams);
        Assert.Equal(140, asGrams.Kcal);
        Assert.Equal(LogEntryRules.KeepLoggedUnit, LogEntryRules.ScaleStored(entry, 1, "sandwich").Error);
    }

    [Fact]
    public void A_per_serving_food_and_a_liquid_cannot_take_a_gram_serving()
    {
        var bar = new Food { Basis = "serving", NutrientBasis = NutrientBases.PerServing, KcalPer100 = 80 };
        Assert.Equal(LogEntryRules.PerServingUnit, LogEntryRules.Snapshot(bar, 1, "slice", 35).Error);
        var milk = new Food { Basis = "ml", NutrientBasis = NutrientBases.Per100, KcalPer100 = 50 };
        Assert.Equal(LogEntryRules.MeasuredInMillilitres, LogEntryRules.Snapshot(milk, 1, "glass", 250).Error);
        var unknown = new Food { Basis = null, NutrientBasis = NutrientBases.Unconfirmed, KcalPer100 = 40 };
        Assert.Equal(LogEntryRules.NoGramBasis, LogEntryRules.Snapshot(unknown, 1, "cup", 200).Error);
        Assert.Equal(LogEntryRules.ServingsLimit, LogEntryRules.RejectAmount(51, "slice"));
        Assert.Null(LogEntryRules.RejectAmount(50, "slice"));
        Assert.Equal(LogEntryRules.ReservedServingName, LogEntryRules.RejectServingName("grams", out _));
        Assert.Equal(LogEntryRules.ServingGramsLimit, LogEntryRules.RejectServingGrams(0));
        Assert.Equal(LogEntryRules.ServingGramsLimit, LogEntryRules.RejectServingGrams(10_001));
        Assert.Null(LogEntryRules.RejectServingGrams(10_000));
    }
}

[Collection(ApiCollection.Name)]
public sealed class OwnServingTests(ApiFactory factory)
{
    [Fact]
    public async Task A_serving_is_private_and_old_logs_keep_the_grams_they_were_saved_with()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 4, 2, 8, 0, 0, TimeSpan.Zero);
        var owner = TestData.NewUser("serve-owner");
        var other = TestData.NewUser("serve-other");
        using var client = factory.AsUser(owner);
        using var stranger = factory.AsUser(other);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await stranger.GetAsync("/api/me")).StatusCode);
        await TestData.PutWeighIn(client, "2026-04-02", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());
        await TestData.PutWeighIn(stranger, "2026-04-02", """{"kg":70,"timeZone":"UTC"}""");
        await TestData.PutProfile(stranger, TestData.Profile());

        var foodId = await CatalogueFood("Fictional rye bread");
        var created = await client.PostAsJsonAsync("/api/foods/" + foodId + "/servings", new { name = "  slice  ", grams = "35,0" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var slice = await created.Content.ReadFromJsonAsync<JsonElement>();
        var sliceId = slice.GetProperty("id").GetGuid();
        Assert.Equal("slice", slice.GetProperty("name").GetString());
        Assert.Equal(35, slice.GetProperty("grams").GetDecimal());

        var sandwich = await client.PostAsJsonAsync("/api/foods/" + foodId + "/servings", new { name = "sandwich", grams = 90 });
        Assert.Equal(HttpStatusCode.Created, sandwich.StatusCode);
        var again = await client.PostAsJsonAsync("/api/foods/" + foodId + "/servings", new { name = "Slice", grams = 40 });
        Assert.Equal(HttpStatusCode.BadRequest, again.StatusCode);
        Assert.Contains("already have a serving", await again.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        var detail = await client.GetFromJsonAsync<JsonElement>("/api/foods/" + foodId);
        var names = detail.GetProperty("servings").EnumerateArray().Select(row => row.GetProperty("name").GetString()).ToArray();
        Assert.Equal("sandwich", names[0]);
        Assert.Equal("slice", names[1]);

        var hidden = await stranger.GetFromJsonAsync<JsonElement>("/api/foods/" + foodId);
        Assert.Equal(0, hidden.GetProperty("servings").GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PutAsJsonAsync($"/api/foods/{foodId}/servings/{sliceId}", new { name = "slice", grams = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.DeleteAsync($"/api/foods/{foodId}/servings/{sliceId}")).StatusCode);
        var stolen = await stranger.PostAsJsonAsync("/api/log-entries", Entry("stolen-slice", foodId, 1, "slice"));
        Assert.Equal(HttpStatusCode.BadRequest, stolen.StatusCode);
        Assert.Contains("No serving called", await stolen.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        var logged = await client.PostAsJsonAsync("/api/log-entries", Entry("own-slice", foodId, 1, "slice"));
        Assert.Equal(HttpStatusCode.Created, logged.StatusCode);
        var entry = await logged.Content.ReadFromJsonAsync<JsonElement>();
        var entryId = entry.GetProperty("id").GetGuid();
        Assert.Equal("slice", entry.GetProperty("unit").GetString());
        Assert.Equal(35, entry.GetProperty("grams").GetDecimal());
        Assert.Equal(70, entry.GetProperty("kcal").GetDecimal());

        var renamed = await client.PutAsJsonAsync($"/api/foods/{foodId}/servings/{sliceId}", new { name = "thin slice", grams = 50 });
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        var kept = await EntryOnDay(client, entryId);
        Assert.Equal("slice", kept.GetProperty("unit").GetString());
        Assert.Equal(35, kept.GetProperty("grams").GetDecimal());
        Assert.Equal(70, kept.GetProperty("kcal").GetDecimal());

        var scaled = await client.PatchAsJsonAsync($"/api/log-entries/{entryId}", new { amount = 2, unit = "slice" });
        Assert.Equal(HttpStatusCode.OK, scaled.StatusCode);
        var doubled = await scaled.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(70, doubled.GetProperty("grams").GetDecimal());
        Assert.Equal(140, doubled.GetProperty("kcal").GetDecimal());
        Assert.Equal("slice", doubled.GetProperty("unit").GetString());

        factory.Clock.UtcNow = factory.Clock.UtcNow.AddMinutes(10);
        var fresh = await client.PostAsJsonAsync("/api/log-entries", Entry("new-thin", foodId, 1, "thin slice"));
        Assert.Equal(HttpStatusCode.Created, fresh.StatusCode);
        var next = await fresh.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(50, next.GetProperty("grams").GetDecimal());
        Assert.Equal(100, next.GetProperty("kcal").GetDecimal());

        var theirs = await stranger.PostAsJsonAsync("/api/foods/" + foodId + "/servings", new { name = "slice", grams = 20 });
        Assert.Equal(HttpStatusCode.Created, theirs.StatusCode);
        var theirLog = await stranger.PostAsJsonAsync("/api/log-entries", Entry("their-slice", foodId, 1, "slice"));
        Assert.Equal(HttpStatusCode.Created, theirLog.StatusCode);
        Assert.Equal(20, (await theirLog.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("grams").GetDecimal());
        Assert.Equal(70, (await EntryOnDay(client, entryId)).GetProperty("grams").GetDecimal());

        var recent = await client.GetFromJsonAsync<JsonElement>("/api/foods/recents");
        var row = recent.GetProperty("foods").EnumerateArray().Single(item => item.GetProperty("id").GetGuid() == foodId);
        Assert.Equal("thin slice", row.GetProperty("unit").GetString());
        Assert.Equal(1, row.GetProperty("amount").GetDecimal());
        Assert.Contains(row.GetProperty("servings").EnumerateArray(), item => item.GetProperty("name").GetString() == "thin slice");
        var strangerRecent = await stranger.GetFromJsonAsync<JsonElement>("/api/foods/recents");
        var strangerRow = strangerRecent.GetProperty("foods").EnumerateArray().Single(item => item.GetProperty("id").GetGuid() == foodId);
        Assert.Equal("slice", strangerRow.GetProperty("unit").GetString());
        Assert.Equal(20, Assert.Single(strangerRow.GetProperty("servings").EnumerateArray()).GetProperty("grams").GetDecimal());

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/foods/{foodId}/servings/{sliceId}")).StatusCode);
        var after = await client.GetFromJsonAsync<JsonElement>("/api/foods/" + foodId);
        Assert.DoesNotContain(after.GetProperty("servings").EnumerateArray(), item => item.GetProperty("name").GetString() == "thin slice");
        Assert.Contains(after.GetProperty("servings").EnumerateArray(), item => item.GetProperty("name").GetString() == "sandwich");
        var gone = await client.PostAsJsonAsync("/api/log-entries", Entry("gone-slice", foodId, 1, "thin slice"));
        Assert.Equal(HttpStatusCode.BadRequest, gone.StatusCode);
        var still = await EntryOnDay(client, entryId);
        Assert.Equal(70, still.GetProperty("grams").GetDecimal());
        Assert.Equal("slice", still.GetProperty("unit").GetString());
        var edited = await client.PatchAsJsonAsync($"/api/log-entries/{entryId}", new { amount = 1, unit = "slice" });
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
        Assert.Equal(35, (await edited.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("grams").GetDecimal());

        var empty = await client.PostAsJsonAsync("/api/foods/" + foodId + "/servings", new { name = "", grams = 10 });
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        var heavy = await client.PostAsJsonAsync("/api/foods/" + foodId + "/servings", new { name = "loaf", grams = 10001 });
        Assert.Equal(HttpStatusCode.BadRequest, heavy.StatusCode);
        var reserved = await client.PostAsJsonAsync("/api/foods/" + foodId + "/servings", new { name = "grams", grams = 1 });
        Assert.Equal(HttpStatusCode.BadRequest, reserved.StatusCode);
        var tooMany = await client.PostAsJsonAsync("/api/log-entries", Entry("too-many", foodId, 51, "sandwich"));
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
    }

    [Fact]
    public async Task A_serving_only_custom_food_and_a_liquid_reject_a_gram_serving()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 4, 2, 9, 0, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("serve-only"));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/me")).StatusCode);
        await TestData.PutWeighIn(client, "2026-04-02", """{"kg":83.6,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());

        var bar = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional serving bar",
            nutrientBasis = "per_serving",
            kcalPer100 = 80,
            proteinPer100 = 10,
        });
        Assert.Equal(HttpStatusCode.Created, bar.StatusCode);
        var barId = (await bar.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var rejected = await client.PostAsJsonAsync("/api/foods/" + barId + "/servings", new { name = "slice", grams = 35 });
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        Assert.Equal(LogEntryRules.PerServingUnit, (await rejected.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        var logged = await client.PostAsJsonAsync("/api/log-entries", Entry("bar-serve", barId, 1, "serving"));
        Assert.Equal(HttpStatusCode.Created, logged.StatusCode);
        var barEntry = await logged.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, barEntry.GetProperty("grams").ValueKind);
        Assert.Equal("serving", barEntry.GetProperty("unit").GetString());
        Assert.Equal(80, barEntry.GetProperty("kcal").GetDecimal());

        var milk = await client.PostAsJsonAsync("/api/foods", new
        {
            name = "Fictional oat drink",
            nutrientBasis = "per_100",
            basis = "ml",
            kcalPer100 = 48,
            proteinPer100 = 1,
            fatPer100 = 1.5m,
            carbsPer100 = 7,
        });
        Assert.Equal(HttpStatusCode.Created, milk.StatusCode);
        var milkId = (await milk.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var milkServing = await client.PostAsJsonAsync("/api/foods/" + milkId + "/servings", new { name = "glass", grams = 250 });
        Assert.Equal(HttpStatusCode.BadRequest, milkServing.StatusCode);
        Assert.Equal(LogEntryRules.MeasuredInMillilitres, (await milkServing.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
    }

    private async Task<Guid> CatalogueFood(string name)
    {
        var id = Guid.NewGuid();
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Foods.Add(new Food
        {
            Id = id,
            Source = "test",
            SourceId = "serve-" + id.ToString("N"),
            Name = name,
            Basis = "g",
            NutrientBasis = NutrientBases.Per100,
            KcalPer100 = 200,
            ProteinPer100 = 8,
            FatPer100 = 2,
            CarbsPer100 = 36,
            UpdatedAt = factory.Clock.GetUtcNow(),
        });
        await db.SaveChangesAsync();
        return id;
    }

    private static object Entry(string key, Guid foodId, decimal amount, string unit, string date = "2026-04-02") => new
    {
        idempotencyKey = key + "-" + foodId.ToString("N"),
        localDate = date,
        timeZone = "UTC",
        foodId,
        amount,
        unit,
        kcal = 1,
        protein = 0,
        fat = 0,
        carbs = 0,
    };

    private static async Task<JsonElement> EntryOnDay(HttpClient client, Guid id)
    {
        var list = await client.GetFromJsonAsync<JsonElement>("/api/log-entries?date=2026-04-02");
        return list.GetProperty("entries").EnumerateArray().Single(row => row.GetProperty("id").GetGuid() == id);
    }
}
