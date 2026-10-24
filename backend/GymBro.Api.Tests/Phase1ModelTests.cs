using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class Phase1ModelTests(ApiFactory factory)
{
    [Fact]
    public async Task Phase_1_tables_exist_and_log_entries_have_no_meal_column()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var connection = db.Database.GetDbConnection();
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name IN ('profiles', 'weigh_ins', 'target_history', 'foods', 'log_entries', 'entry_groups', 'day_status')
            """;
        var found = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var table = reader.GetString(0);
            if (!found.TryGetValue(table, out var columns))
            {
                columns = [];
                found[table] = columns;
            }

            columns.Add(reader.GetString(1));
        }

        Assert.Equal(
            new[] { "day_status", "entry_groups", "foods", "log_entries", "profiles", "target_history", "weigh_ins" },
            found.Keys.Order(StringComparer.Ordinal).ToArray());
        var log = found["log_entries"];
        Assert.Contains("logged_at", log);
        Assert.Contains("time_zone", log);
        Assert.Contains("local_date", log);
        Assert.Contains("group_id", log);
        Assert.Contains("idempotency_key", log);
        Assert.Contains("user_id", log);
        Assert.DoesNotContain(log, column => column.Contains("meal", StringComparison.OrdinalIgnoreCase));

        var model = db.Model.FindEntityType(typeof(LogEntry));
        Assert.NotNull(model);
        Assert.DoesNotContain(model.GetProperties(), property => property.Name.Contains("Meal", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Idempotency_key_is_unique_per_user()
    {
        var user = TestData.NewUser("idem");
        using var client = factory.AsUser(user);
        Assert.Equal(System.Net.HttpStatusCode.OK, (await client.GetAsync("/api/me")).StatusCode);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.LogEntries.Add(Entry(user, "same-key"));
        db.LogEntries.Add(Entry(user, "same-key"));
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    private static LogEntry Entry(string userId, string key) => new()
    {
        Id = Guid.NewGuid(),
        UserId = userId,
        LocalDate = new DateOnly(2026, 10, 24),
        LoggedAt = new DateTime(2026, 10, 24, 8, 30, 0),
        TimeZone = "UTC",
        Name = "Fictional oats",
        Amount = 40,
        Unit = "g",
        Kcal = 100,
        Protein = 4,
        Fat = 2,
        Carbs = 12,
        IdempotencyKey = key,
    };
}
