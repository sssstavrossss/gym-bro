using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class MigrationUpgradeTests(ApiFactory factory)
{
    [Fact]
    public async Task Phase1_rows_merge_onto_one_history_row_and_foreign_keys_are_backfilled()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var live = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var adminCs = new NpgsqlConnectionStringBuilder(live.Database.GetConnectionString())
        {
            Database = "postgres",
        }.ConnectionString;
        var upgradeCs = new NpgsqlConnectionStringBuilder(live.Database.GetConnectionString())
        {
            Database = "gymbro_pr1_upgrade",
        }.ConnectionString;

        await using (var admin = new NpgsqlConnection(adminCs))
        {
            await admin.OpenAsync();
            await using var command = admin.CreateCommand();
            command.CommandText = """
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE datname = 'gymbro_pr1_upgrade' AND pid <> pg_backend_pid()
                """;
            await command.ExecuteNonQueryAsync();
            command.CommandText = "DROP DATABASE IF EXISTS gymbro_pr1_upgrade";
            await command.ExecuteNonQueryAsync();
            command.CommandText = "CREATE DATABASE gymbro_pr1_upgrade";
            await command.ExecuteNonQueryAsync();
        }

        var options = new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(upgradeCs).Options;
        await using var db = new AppDbContext(options);
        await db.Database.MigrateAsync("20261024104918_Phase1Tables");
        await db.Database.ExecuteSqlRawAsync(SeedSql);
        await db.Database.MigrateAsync();

        var sameDay = await db.TargetHistories.SingleAsync(
            row => row.UserId == "mig-a" && row.EffectiveDate == new DateOnly(2026, 10, 24));
        Assert.Equal(2100, sameDay.Kcal);
        Assert.Equal(81.50m, sameDay.WeightKg);
        Assert.Equal(["profile_change", "macro_balance_change"], sameDay.Reasons);

        var earlier = await db.TargetHistories.SingleAsync(
            row => row.UserId == "mig-a" && row.EffectiveDate == new DateOnly(2026, 10, 20));
        Assert.Equal(1900, earlier.Kcal);
        Assert.Equal(["profile_change"], earlier.Reasons);

        var other = await db.TargetHistories.SingleAsync(row => row.UserId == "mig-b");
        Assert.Equal(["weekly_recalculation"], other.Reasons);
        Assert.Equal(2, await db.TargetHistories.CountAsync(row => row.UserId == "mig-a"));

        var catalogue = await ReadLogAsync(db, "log-catalogue");
        Assert.Equal(CatalogueFood, catalogue.FoodId);
        Assert.Equal("", catalogue.FoodOwnerKey);
        Assert.Null(catalogue.Grams);

        var own = await ReadLogAsync(db, "log-own");
        Assert.Equal(CustomFood, own.FoodId);
        Assert.Equal("mig-a", own.FoodOwnerKey);
        Assert.Equal(40m, own.Grams);
        Assert.Equal(OwnGroup, own.GroupId);

        var crossFood = await ReadLogAsync(db, "log-cross-food");
        Assert.Null(crossFood.FoodId);
        Assert.Equal("", crossFood.FoodOwnerKey);

        var crossGroup = await ReadLogAsync(db, "log-cross-group");
        Assert.Null(crossGroup.GroupId);

        var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync();
        }
        await using var check = connection.CreateCommand();
        check.CommandText = """
            SELECT owner_key, nutrient_basis FROM foods WHERE id = '11111111-1111-1111-1111-111111111111'
            """;
        await using var reader = await check.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal("", reader.GetString(0));
        Assert.Equal("per_100", reader.GetString(1));
        await reader.DisposeAsync();

        await using var deleted = connection.CreateCommand();
        deleted.CommandText = """
            SELECT COUNT(*) FROM log_entries WHERE deleted_at IS NOT NULL
            """;
        Assert.Equal(0, Convert.ToInt32(await deleted.ExecuteScalarAsync()));
    }

    private static async Task<LogRow> ReadLogAsync(AppDbContext db, string key)
    {
        var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync();
        }

        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT food_id::text, food_owner_key, grams, group_id::text
            FROM log_entries
            WHERE idempotency_key = @key
            """;
        var parameter = command.CreateParameter();
        parameter.ParameterName = "key";
        parameter.Value = key;
        command.Parameters.Add(parameter);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        return new LogRow(
            reader.IsDBNull(0) ? null : Guid.Parse(reader.GetString(0)),
            reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetDecimal(2),
            reader.IsDBNull(3) ? null : Guid.Parse(reader.GetString(3)));
    }

    private static readonly Guid CatalogueFood = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid CustomFood = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid OwnGroup = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private static readonly string SeedSql = """
        INSERT INTO users (object_id, display_name, email, first_seen_at, last_seen_at) VALUES
          ('mig-a', NULL, NULL, TIMESTAMPTZ '2026-10-20 08:00:00+00', TIMESTAMPTZ '2026-10-24 08:00:00+00'),
          ('mig-b', NULL, NULL, TIMESTAMPTZ '2026-10-20 08:00:00+00', TIMESTAMPTZ '2026-10-24 08:00:00+00');

        INSERT INTO foods (
          id, user_id, source, source_id, name, basis,
          kcal_per_100, protein_per_100, fat_per_100, carbs_per_100, updated_at)
        VALUES
          ('11111111-1111-1111-1111-111111111111', NULL, 'mvt', 'mig.oats', 'Fictional oats', 'g', 100, 1, 1, 1, TIMESTAMPTZ '2026-10-20 08:00:00+00'),
          ('22222222-2222-2222-2222-222222222222', 'mig-a', 'custom', 'mig.bar', 'Fictional bar', 'g', 100, 1, 1, 1, TIMESTAMPTZ '2026-10-20 08:00:00+00');

        INSERT INTO entry_groups (id, user_id, name, created_at) VALUES
          ('33333333-3333-3333-3333-333333333333', 'mig-a', 'Own', TIMESTAMPTZ '2026-10-20 08:00:00+00'),
          ('44444444-4444-4444-4444-444444444444', 'mig-b', 'Theirs', TIMESTAMPTZ '2026-10-20 08:00:00+00');

        INSERT INTO target_history (
          user_id, effective_date, bmr, tdee, kcal, protein_grams, fat_grams, carb_grams,
          floor_applied, reason, weight_kg, created_at)
        VALUES
          ('mig-a', DATE '2026-10-24', 1700, 2600, 2000, 150, 50, 200, false, 'profile_change', 80.00, TIMESTAMPTZ '2026-10-24 08:00:00+00'),
          ('mig-a', DATE '2026-10-24', 1700, 2600, 2100, 160, 55, 190, false, 'macro_balance_change', 81.50, TIMESTAMPTZ '2026-10-24 18:00:00+00'),
          ('mig-a', DATE '2026-10-20', 1700, 2600, 1900, 140, 40, 180, false, 'profile_change', 79.00, TIMESTAMPTZ '2026-10-20 08:00:00+00'),
          ('mig-b', DATE '2026-10-24', 1500, 2000, 1800, 100, 40, 150, false, 'weekly_recalculation', 70.00, TIMESTAMPTZ '2026-10-24 09:00:00+00');

        INSERT INTO log_entries (
          id, user_id, local_date, logged_at, time_zone, group_id, food_id, source, grams,
          name, amount, unit, kcal, protein, fat, carbs, idempotency_key)
        VALUES
          ('55555555-5555-5555-5555-555555555555', 'mig-a', DATE '2026-10-24', TIMESTAMP '2026-10-24 08:00:00', 'UTC', NULL, '11111111-1111-1111-1111-111111111111', 'mvt', NULL, 'Fictional oats', 1, 'serving', 100, 1, 1, 1, 'log-catalogue'),
          ('66666666-6666-6666-6666-666666666666', 'mig-a', DATE '2026-10-24', TIMESTAMP '2026-10-24 08:05:00', 'UTC', '33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'custom', 40, 'Fictional bar', 40, 'g', 40, 1, 1, 1, 'log-own'),
          ('77777777-7777-7777-7777-777777777777', 'mig-b', DATE '2026-10-24', TIMESTAMP '2026-10-24 08:10:00', 'UTC', NULL, '22222222-2222-2222-2222-222222222222', 'custom', 40, 'Fictional bar', 40, 'g', 40, 1, 1, 1, 'log-cross-food'),
          ('88888888-8888-8888-8888-888888888888', 'mig-a', DATE '2026-10-24', TIMESTAMP '2026-10-24 08:15:00', 'UTC', '44444444-4444-4444-4444-444444444444', NULL, 'manual', NULL, 'Fictional note', 1, 'serving', 0, 0, 0, 0, 'log-cross-group');
        """;

    private sealed record LogRow(Guid? FoodId, string FoodOwnerKey, decimal? Grams, Guid? GroupId);
}
