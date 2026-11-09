using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class KassalappImportTests(ApiFactory factory)
{
    [Fact]
    public async Task Import_keeps_the_newest_complete_listing_and_a_repeat_is_stable()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var importer = scope.ServiceProvider.GetRequiredService<KassalappImporter>();
        var file = string.Join('\n',
            Line("007394376620799", "Havredrikk", "Oatly", "2026-11-01T08:00:00Z", 40, 1m, 1, 6, "SPAR"),
            Line("007394376620799", "Havredrikk", "Oatly", "2026-11-07T08:00:00Z", 48, 1.1m, 1.5m, 7, "Joker"),
            Line("007394376620799", "Havredrikk", "Oatly", "2026-11-07T08:00:00Z", 48, 1.1m, 1.5m, 7, "Meny"),
            """{"ean":"0002","name":"Incomplete","brand":"X","updated_at":"2026-11-07T08:00:00Z","weight_unit":"g","nutrition":[{"code":"energi_kj","unit":"kJ","amount":400},{"code":"fett_totalt","unit":"g","amount":1},{"code":"karbohydrater","unit":"g","amount":1}]}""");
        var preview = await importer.ImportFileAsync(Stream(file), dryRun: true, CancellationToken.None);
        Assert.True(preview.DryRun);
        Assert.Equal(1, preview.Accepted);
        Assert.Equal(0, preview.Upserted);
        Assert.False(string.IsNullOrWhiteSpace(preview.Sha256));
        Assert.Equal(0, await db.Foods.CountAsync(row => row.Source == "kassalapp" && row.SourceId == "007394376620799"));

        var first = await importer.ImportFileAsync(Stream(file), CancellationToken.None);
        Assert.True(first.Complete);
        Assert.Equal(1, first.Accepted);
        Assert.Equal(1, first.Upserted);
        Assert.Equal(1, first.SkipReasons.GetValueOrDefault("nutrition-incomplete"));
        var food = await db.Foods.SingleAsync(row => row.Source == "kassalapp" && row.SourceId == "007394376620799");
        Assert.Equal("007394376620799", food.Barcode);
        Assert.Equal("Oatly Havredrikk", food.Name);
        Assert.Equal(48, food.KcalPer100);
        Assert.Null(food.Basis);
        Assert.Equal(NutrientBases.Unconfirmed, food.NutrientBasis);
        Assert.Contains("oatly", food.SearchName);

        var again = await importer.ImportFileAsync(Stream(file), CancellationToken.None);
        Assert.Equal(1, again.Unchanged);
        Assert.Equal(0, again.Upserted);

        var changed = Line("007394376620799", "Havredrikk", "Oatly", "2026-11-08T08:00:00Z", 50, 1.1m, 1.5m, 7, "Joker");
        var third = await importer.ImportFileAsync(Stream(changed), CancellationToken.None);
        Assert.Equal(1, third.Reconfirm);
        Assert.Equal(50, (await db.Foods.SingleAsync(row => row.Id == food.Id)).KcalPer100);

        db.Foods.Remove(await db.Foods.SingleAsync(row => row.Id == food.Id));
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Tied_store_listings_with_different_nutrition_are_not_merged()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var importer = scope.ServiceProvider.GetRequiredService<KassalappImporter>();
        var file = string.Join('\n',
            Line("123", "Same", "Brand", "2026-11-07T08:00:00Z", 40, 1, 1, 1, "A"),
            Line("123", "Same", "Brand", "2026-11-07T08:00:00Z", 90, 9, 9, 9, "B"));
        var report = await importer.ImportFileAsync(Stream(file), CancellationToken.None);
        Assert.Equal(0, report.Accepted);
        Assert.Equal(1, report.SkipReasons.GetValueOrDefault("conflicting-nutrition"));
        Assert.Equal(0, await db.Foods.CountAsync(food => food.SourceId == "123"));
    }

    [Fact]
    public async Task An_unconfirmed_food_logs_in_grams_or_millilitres_without_a_basis_confirmation()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("kassalapp-a");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-24", """{"kg":80,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile(timeZone: "UTC"));

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var importer = scope.ServiceProvider.GetRequiredService<KassalappImporter>();
        await importer.ImportFileAsync(Stream(Line("7394376620805", "Oat drink", "Oatly", "2026-11-07T08:00:00Z", 37, 1, 0.5m, 6.7m, "Meny")), CancellationToken.None);
        var food = await db.Foods.SingleAsync(row => row.SourceId == "7394376620805");

        var logged = await client.PostAsync("/api/log-entries", Json($$"""{"idempotencyKey":"k-ok","localDate":"2026-10-24","timeZone":"UTC","foodId":"{{food.Id}}","amount":250,"unit":"ml"}"""));
        Assert.Equal(HttpStatusCode.Created, logged.StatusCode);
        var entry = await logged.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(92.5m, entry.GetProperty("kcal").GetDecimal());
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("grams").ValueKind);
        Assert.Equal("ml", entry.GetProperty("unit").GetString());
        var entryId = entry.GetProperty("id").GetGuid();

        var edited = await client.PatchAsync($"/api/log-entries/{entryId}", Json("""{"amount":500,"unit":"ml"}"""));
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
        var editedBody = await edited.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(185m, editedBody.GetProperty("kcal").GetDecimal());
        Assert.Equal(JsonValueKind.Null, editedBody.GetProperty("grams").ValueKind);

        var grams = await client.PostAsync("/api/log-entries", Json($$"""{"idempotencyKey":"k-grams","localDate":"2026-10-24","timeZone":"UTC","foodId":"{{food.Id}}","amount":100,"unit":"g"}"""));
        Assert.Equal(HttpStatusCode.Created, grams.StatusCode);
        var gramBody = await grams.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(37m, gramBody.GetProperty("kcal").GetDecimal());
        Assert.Equal(100m, gramBody.GetProperty("grams").GetDecimal());
        Assert.Equal("g", gramBody.GetProperty("unit").GetString());
        var gramId = gramBody.GetProperty("id").GetGuid();

        Assert.Equal(0, await db.FoodBasisConfirmations.CountAsync(row => row.FoodId == food.Id));
        Assert.Null((await db.Foods.AsNoTracking().SingleAsync(row => row.Id == food.Id)).Basis);

        var mvt = new Food
        {
            Id = Guid.NewGuid(),
            Source = "mvt",
            SourceId = "kassalapp-mvt",
            Name = "Fictional oats",
            Basis = "g",
            NutrientBasis = NutrientBases.Per100,
            KcalPer100 = 100,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Foods.Add(mvt);
        await db.SaveChangesAsync();
        var still = await client.PostAsync("/api/log-entries", Json($$"""{"idempotencyKey":"k-mvt","localDate":"2026-10-24","timeZone":"UTC","foodId":"{{mvt.Id}}","amount":100,"unit":"g"}"""));
        Assert.Equal(HttpStatusCode.Created, still.StatusCode);
        Assert.Equal(100, (await still.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("kcal").GetDecimal());
        var mvtMl = await client.PostAsync("/api/log-entries", Json($$"""{"idempotencyKey":"k-mvt-ml","localDate":"2026-10-24","timeZone":"UTC","foodId":"{{mvt.Id}}","amount":100,"unit":"ml"}"""));
        Assert.Equal(HttpStatusCode.BadRequest, mvtMl.StatusCode);

        var kept = await db.LogEntries.SingleAsync(row => row.Id == entryId);
        food.RetiredAt = DateTimeOffset.UnixEpoch;
        await db.SaveChangesAsync();
        Assert.Equal(food.Id, (await db.LogEntries.AsNoTracking().SingleAsync(row => row.Id == kept.Id)).FoodId);
        var foodId = food.Id;
        db.ChangeTracker.Clear();
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM foods WHERE id = {foodId}");
        var detached = await db.LogEntries.AsNoTracking().SingleAsync(row => row.Id == kept.Id);
        Assert.Null(detached.FoodId);
        Assert.Equal(185m, detached.Kcal);

        db.LogEntries.Remove(await db.LogEntries.SingleAsync(row => row.Id == kept.Id));
        db.LogEntries.Remove(await db.LogEntries.SingleAsync(row => row.Id == gramId));
        db.LogEntries.Remove(await db.LogEntries.SingleAsync(row => row.FoodId == mvt.Id));
        db.Foods.Remove(await db.Foods.SingleAsync(row => row.Id == mvt.Id));
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Out_of_bounds_nutrition_is_skipped_and_an_older_listing_is_not_revived()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var importer = scope.ServiceProvider.GetRequiredService<KassalappImporter>();
        var file = string.Join('\n',
            Line("9001", "Oil", "Brand", "2026-11-07T08:00:00Z", 900, 0, 100, 0, "A"),
            Line("9002", "Too much energy", "Brand", "2026-11-07T08:00:00Z", 900.01m, 1, 1, 1, "A"),
            Line("9003", "Too much protein", "Brand", "2026-11-07T08:00:00Z", 100, 100.01m, 1, 1, "A"),
            Line("9004", "Too much fat", "Brand", "2026-11-07T08:00:00Z", 100, 1, 101, 1, "A"),
            Line("9005", "Too much carb", "Brand", "2026-11-07T08:00:00Z", 100, 1, 1, 101, "A"),
            Line("9006", "Older flour", "Holli", "2026-03-23T14:46:39Z", 321, 8, 1.3m, 67.8m, "A"),
            Line("9006", "Newer flour", "Holli", "2026-06-07T01:27:04Z", 1262, 7, 2.5m, 60, "B"),
            Line("9007", "Older wild", "Brand", "2026-01-01T00:00:00Z", 5000, 1, 1, 1, "A"),
            Line("9007", "Newer plain", "Brand", "2026-06-01T00:00:00Z", 40, 1, 1, 1, "B"),
            Line("1234", "Short code", "Brand", "2026-11-07T08:00:00Z", 10, 1, 1, 1, "A"),
            Line("9008", "Tie low", "Brand", "2026-11-07T08:00:00Z", 40, 1, 1, 1, "A"),
            Line("9008", "Tie high", "Brand", "2026-11-07T08:00:00Z", 4000, 1, 1, 1, "B"));
        var report = await importer.ImportFileAsync(Stream(file), CancellationToken.None);
        Assert.Equal(3, report.Accepted);
        Assert.Equal(2, report.SkipReasons.GetValueOrDefault("kcal-out-of-range"));
        Assert.Equal(3, report.SkipReasons.GetValueOrDefault("macro-out-of-range"));
        Assert.Equal(1, report.SkipReasons.GetValueOrDefault("conflicting-nutrition"));
        Assert.Equal(900, (await db.Foods.SingleAsync(food => food.SourceId == "9001")).KcalPer100);
        Assert.Equal(0, await db.Foods.CountAsync(food => food.SourceId == "9002" || food.SourceId == "9006"));
        Assert.Equal(40, (await db.Foods.SingleAsync(food => food.SourceId == "9007")).KcalPer100);
        Assert.Equal("1234", (await db.Foods.SingleAsync(food => food.SourceId == "1234")).Barcode);
        var ids = new[] { "9001", "9003", "9004", "9005", "9007", "1234" };
        db.Foods.RemoveRange(await db.Foods.Where(food => ids.Contains(food.SourceId)).ToListAsync());
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task A_truncated_file_does_not_retire_a_previous_row()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var importer = scope.ServiceProvider.GetRequiredService<KassalappImporter>();
        await importer.ImportFileAsync(Stream(Line("555", "Kept", "Brand", "2026-11-07T08:00:00Z", 10, 1, 1, 1, "A")), CancellationToken.None);
        var broken = await importer.ImportFileAsync(Stream("{\"ean\":\"555\",\"name\":"), CancellationToken.None);
        Assert.False(broken.Complete);
        Assert.Null((await db.Foods.SingleAsync(food => food.SourceId == "555")).RetiredAt);
        db.Foods.Remove(await db.Foods.SingleAsync(food => food.SourceId == "555"));
        await db.SaveChangesAsync();
    }

    private static Stream Stream(string text) => new MemoryStream(Encoding.UTF8.GetBytes(text));

    private static StringContent Json(string text) => new(text, Encoding.UTF8, "application/json");

    private static string Line(string ean, string name, string brand, string updated, decimal kcal, decimal protein, decimal fat, decimal carbs, string store) =>
        $$"""{"id":{{store.Length}},"ean":"{{ean}}","name":"{{name}}","brand":"{{brand}}","updated_at":"{{updated}}","weight":250,"weight_unit":"ml","store":{"code":"{{store}}"},"nutrition":[{"code":"energi_kcal","unit":"kcal","amount":{{kcal.ToString(System.Globalization.CultureInfo.InvariantCulture)}}},{"code":"energi_kj","unit":"kJ","amount":999},{"code":"protein","unit":"g","amount":{{protein.ToString(System.Globalization.CultureInfo.InvariantCulture)}}},{"code":"fett_totalt","unit":"g","amount":{{fat.ToString(System.Globalization.CultureInfo.InvariantCulture)}}},{"code":"karbohydrater","unit":"g","amount":{{carbs.ToString(System.Globalization.CultureInfo.InvariantCulture)}}}]}""";
}
