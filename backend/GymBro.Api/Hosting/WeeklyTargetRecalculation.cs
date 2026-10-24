using GymBro.Api.Data;
using GymBro.Api.Nutrition;
using GymBro.Api.Profiles;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Hosting;

/// <summary>
/// Upserts one target row per person for their local today, adding
/// <see cref="TargetReasons.WeeklyRecalculation"/> to that row's reasons.
/// On Monday the row is dated Monday. If Monday was missed, the catch-up
/// merges into today's row and does not backdate it. A second run that week
/// does nothing. A profile created today on a day other than Monday does not
/// get a weekly reason the same day: that save already wrote today's targets.
/// Each person is saved in their own transaction. One failure is logged and
/// the job continues with the next person.
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

            if (!IncludeWeeklyReason(profile, today))
            {
                continue;
            }

            var weekStart = today.AddDays(-(((int)today.DayOfWeek - (int)DayOfWeek.Monday + 7) % 7));
            var weekReasons = await db.TargetHistories.AsNoTracking()
                .Where(row => row.UserId == profile.UserId
                    && row.EffectiveDate >= weekStart
                    && row.EffectiveDate <= today)
                .Select(row => row.Reasons)
                .ToListAsync(cancellationToken);
            if (weekReasons.Any(reasons => reasons.Contains(TargetReasons.WeeklyRecalculation)))
            {
                continue;
            }

            // Same trend series the API publishes. A missed Monday is still dated
            // the day this run actually happens.
            var weight = await WeightReader.ReadAsync(db, profile.UserId, today, cancellationToken);
            if (weight.UsedKg is not decimal weightKg)
            {
                continue;
            }

            var result = NutritionMath.Calculate(ProfileRules.ToInput(profile, weightKg, today.Year));
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            try
            {
                await TargetBook.StageAsync(
                    db,
                    profile.UserId,
                    today,
                    result,
                    weightKg,
                    [TargetReasons.WeeklyRecalculation],
                    clock.GetUtcNow(),
                    cancellationToken);
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

    /// <summary>
    /// The first profile save of a week that is not Monday already calculated
    /// today's targets. The job must not add <c>weekly_recalculation</c> that
    /// same local day. Monday, and any later day, still upsert today's row.
    /// </summary>
    public static bool IncludeWeeklyReason(Profile profile, DateOnly today)
    {
        if (!LocalDates.TryZone(profile.TimeZone, out var zone))
        {
            return true;
        }

        var created = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(profile.CreatedAt, zone).DateTime);
        return created != today || today.DayOfWeek == DayOfWeek.Monday;
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
