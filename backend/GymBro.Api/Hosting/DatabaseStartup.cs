using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Hosting;

public static class DatabaseStartup
{
    public static async Task ApplyMigrationsAsync(this WebApplication app)
    {
        if (app.Environment.IsEnvironment("Testing"))
        {
            await using var scope = app.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.EnsureCreatedAsync();
            return;
        }

        const int attempts = 10;
        for (var attempt = 1; attempt <= attempts; attempt++)
        {
            try
            {
                await using var scope = app.Services.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await db.Database.MigrateAsync();
                return;
            }
            catch (Exception ex) when (ex is not OperationCanceledException && attempt < attempts)
            {
                app.Logger.LogWarning(
                    "Database is not ready (attempt {Attempt} of {Attempts}): {Message}",
                    attempt,
                    attempts,
                    ex.Message);
                await Task.Delay(TimeSpan.FromSeconds(2));
            }
        }
    }
}
