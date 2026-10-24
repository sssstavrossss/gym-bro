using GymBro.Api.Data;
using GymBro.Api.Nutrition;
using GymBro.Api.Profiles;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Hosting;

/// <summary>
/// Writes one weekly target row per person per local week. On Monday the row
/// is dated Monday. If Monday was missed, the first later run dates the row
/// the day it actually runs and does not backdate it. A second run that week
/// does nothing. Each person is saved in their own transaction. One failure
/// is logged and the job continues with the next person.
/// </summary>
public sealed class WeeklyTargetRecalculator(AppDbContext db, TimeProvider clock, ILogger<WeeklyTargetRecalculator> logger)
{
    public async Task<int> RunAsync(CancellationToken cancellationToken)
    {
        var profiles = await db.Profiles.ToListAsync(cancellationToken);
        var wrote = 0;
        foreach (var profile in profiles)
        {
            if (!LocalDates.TryToday(profile.TimeZone, clock, out var today))
            {
                continue;
            }

            var weekStart = today.AddDays(-(((int)today.DayOfWeek - (int)DayOfWeek.Monday + 7) % 7));
            var exists = await db.TargetHistories.AnyAsync(
                row => row.UserId == profile.UserId
                    && row.Reason == TargetReasons.WeeklyRecalculation
                    && row.EffectiveDate >= weekStart
                    && row.EffectiveDate <= today,
                cancellationToken);
            if (exists)
            {
                continue;
            }

            var weight = await WeightReader.ReadAsync(db, profile.UserId, today, cancellationToken);
            if (weight.UsedKg is not decimal weightKg)
            {
                continue;
            }

            var result = NutritionMath.Calculate(ProfileRules.ToInput(profile, weightKg, today.Year));
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            try
            {
                db.TargetHistories.Add(TargetBook.NewRow(
                    profile.UserId,
                    today,
                    result,
                    weightKg,
                    TargetReasons.WeeklyRecalculation,
                    clock.GetUtcNow()));
                await db.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                wrote++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Weekly target for user {UserId} was not saved.", profile.UserId);
                db.ChangeTracker.Clear();
            }
        }

        return wrote;
    }
}

public sealed class WeeklyTargetHostedService(
    IServiceScopeFactory scopes,
    TimeProvider clock,
    ILogger<WeeklyTargetHostedService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var job = scope.ServiceProvider.GetRequiredService<WeeklyTargetRecalculator>();
                var wrote = await job.RunAsync(stoppingToken);
                if (wrote > 0)
                {
                    logger.LogInformation("Wrote {Count} weekly target rows.", wrote);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Weekly target recalculation failed.");
            }

            try
            {
                await Task.Delay(TimeSpan.FromMinutes(15), clock, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}
