using GymBro.Api.Configuration;
using GymBro.Api.Data;
using GymBro.Api.Nutrition;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using WebPush;

namespace GymBro.Api.Hosting;

public sealed class WebPushOptions
{
    public const string SectionName = "WebPush";

    public string PublicKey { get; set; } = "";

    public string PrivateKey { get; set; } = "";

    public string Subject { get; set; } = "mailto:gymbro@localhost";

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(PublicKey) && !string.IsNullOrWhiteSpace(PrivateKey);
}

/// <summary>
/// Sends one Web Push per subscribed person on Monday at or after 09:00 in
/// their time zone. A second run the same local Monday does not send again.
/// Missing VAPID keys skip the send and leave the app running.
/// </summary>
public sealed class MondayReminder(
    AppDbContext db,
    TimeProvider clock,
    IOptions<WebPushOptions> options,
    ILogger<MondayReminder> logger)
{
    public const string Kind = "recalculate";

    public const string Payload =
        """{"title":"Gym Bro","body":"Time to recalculate your target","url":"/today?recalculate=1"}""";

    public async Task<int> RunAsync(CancellationToken cancellationToken)
    {
        var push = options.Value;
        if (!push.IsConfigured)
        {
            return 0;
        }

        var profiles = await db.Profiles
            .Where(profile => profile.RemindersEnabled)
            .ToListAsync(cancellationToken);
        var client = new WebPushClient();
        var vapid = new VapidDetails(push.Subject, push.PublicKey, push.PrivateKey);
        var sent = 0;
        foreach (var profile in profiles)
        {
            if (!LocalDates.TryZone(profile.TimeZone, out var zone))
            {
                continue;
            }

            var local = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone);
            if (local.DayOfWeek != DayOfWeek.Monday || local.Hour < 9)
            {
                continue;
            }

            var today = DateOnly.FromDateTime(local.DateTime);
            var already = await db.ReminderSends.AnyAsync(
                row => row.UserId == profile.UserId && row.LocalDate == today && row.Kind == Kind,
                cancellationToken);
            if (already)
            {
                continue;
            }

            var subscriptions = await db.PushSubscriptions
                .Where(row => row.UserId == profile.UserId)
                .ToListAsync(cancellationToken);
            if (subscriptions.Count == 0)
            {
                continue;
            }

            var delivered = false;
            foreach (var subscription in subscriptions)
            {
                try
                {
                    await client.SendNotificationAsync(
                        new WebPush.PushSubscription(subscription.Endpoint, subscription.P256dh, subscription.Auth),
                        Payload,
                        vapid,
                        cancellationToken);
                    delivered = true;
                }
                catch (WebPushException ex) when (ex.StatusCode is System.Net.HttpStatusCode.Gone or System.Net.HttpStatusCode.NotFound)
                {
                    db.PushSubscriptions.Remove(subscription);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogWarning(ex, "Push to user {UserId} was not delivered.", profile.UserId);
                }
            }

            if (!delivered)
            {
                continue;
            }

            db.ReminderSends.Add(new ReminderSend
            {
                UserId = profile.UserId,
                LocalDate = today,
                Kind = Kind,
                SentAt = clock.GetUtcNow(),
            });
            await db.SaveChangesAsync(cancellationToken);
            sent++;
        }

        return sent;
    }
}

public sealed class MondayReminderHostedService(
    IServiceScopeFactory scopes,
    TimeProvider clock,
    ILogger<MondayReminderHostedService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var job = scope.ServiceProvider.GetRequiredService<MondayReminder>();
                var sent = await job.RunAsync(stoppingToken);
                if (sent > 0)
                {
                    logger.LogInformation("Sent {Count} recalculate reminders.", sent);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Monday recalculate reminder failed.");
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
