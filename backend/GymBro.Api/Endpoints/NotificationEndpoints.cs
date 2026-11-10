using System.Security.Claims;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Hosting;
using GymBro.Api.Notifications;
using GymBro.Api.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace GymBro.Api.Endpoints;

public static class NotificationEndpoints
{
    public const string NeedEnabled = "Say whether reminders are on.";

    public const string NeedSubscription = "The push subscription is incomplete.";

    public const string NotConfigured = "Notifications are not set up.";

    public static RouteGroupBuilder MapNotifications(this RouteGroupBuilder api)
    {
        api.MapGet("/notifications", Get);
        api.MapPut("/notifications", Put);
        api.MapGet("/notifications/inbox/unread", Unread);
        api.MapGet("/notifications/inbox", Inbox);
        api.MapPost("/notifications/inbox/read", ReadAll);
        api.MapPost("/notifications/inbox/{id:long}/read", ReadOne);
        api.MapPost("/notifications/subscription", Subscribe);
        api.MapDelete("/notifications/subscription", Unsubscribe);
        return api;
    }

    private static async Task<IResult> Get(
        ClaimsPrincipal principal,
        AppDbContext db,
        IOptions<WebPushOptions> options,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var enabled = await db.Profiles.AsNoTracking()
            .Where(row => row.UserId == userId)
            .Select(row => (bool?)row.RemindersEnabled)
            .FirstOrDefaultAsync(cancellationToken);
        var push = options.Value;
        return Results.Ok(new
        {
            configured = push.IsConfigured,
            enabled = enabled ?? false,
            publicKey = push.IsConfigured ? push.PublicKey : "",
        });
    }

    private static async Task<IResult> Inbox(
        ClaimsPrincipal principal,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var profile = await db.Profiles.FirstOrDefaultAsync(row => row.UserId == userId, cancellationToken);
        if (profile is not null)
        {
            await NotificationBook.EnsureCurrentWeekAsync(db, profile, clock, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
        }

        var items = await db.UserNotifications.AsNoTracking()
            .Where(row => row.UserId == userId)
            .OrderByDescending(row => row.CreatedAt)
            .ThenByDescending(row => row.Id)
            .ToListAsync(cancellationToken);
        return Results.Ok(new
        {
            unread = items.Count(row => row.ReadAt is null),
            items = items.Select(ToItem),
        });
    }

    private static async Task<IResult> Unread(
        ClaimsPrincipal principal,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var profile = await db.Profiles.FirstOrDefaultAsync(row => row.UserId == userId, cancellationToken);
        if (profile is not null)
        {
            await NotificationBook.EnsureCurrentWeekAsync(db, profile, clock, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
        }

        var count = await db.UserNotifications.CountAsync(
            row => row.UserId == userId && row.ReadAt == null,
            cancellationToken);
        return Results.Ok(new { count });
    }

    private static async Task<IResult> ReadOne(
        ClaimsPrincipal principal,
        long id,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var row = await db.UserNotifications.FirstOrDefaultAsync(item => item.Id == id && item.UserId == userId, cancellationToken);
        if (row is null)
        {
            return Results.NotFound();
        }

        if (row.ReadAt is null)
        {
            row.ReadAt = clock.GetUtcNow();
            await db.SaveChangesAsync(cancellationToken);
        }

        return Results.Ok(ToItem(row));
    }

    private static async Task<IResult> ReadAll(
        ClaimsPrincipal principal,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var unread = await db.UserNotifications
            .Where(row => row.UserId == userId && row.ReadAt == null)
            .ToListAsync(cancellationToken);
        var now = clock.GetUtcNow();
        foreach (var row in unread)
        {
            row.ReadAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static object ToItem(UserNotification row) => new
    {
        id = row.Id,
        type = row.Type,
        title = row.Title,
        body = row.Body,
        link = row.Link,
        createdAt = row.CreatedAt,
        readAt = row.ReadAt,
    };

    private static async Task<IResult> Put(
        ClaimsPrincipal principal,
        HttpRequest http,
        AppDbContext db,
        IOptions<WebPushOptions> options,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (!options.Value.IsConfigured)
        {
            return ApiResults.Error(NotConfigured);
        }

        var enabled = await ReadEnabled(http, cancellationToken);
        if (enabled.Error is not null)
        {
            return ApiResults.Error(enabled.Error);
        }

        var profile = await db.Profiles.FirstOrDefaultAsync(row => row.UserId == Caller.Id(principal), cancellationToken);
        if (profile is null)
        {
            return ApiResults.Error(RecalculateEndpoints.NeedProfile);
        }

        profile.RemindersEnabled = enabled.Value;
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { configured = true, enabled = profile.RemindersEnabled, publicKey = options.Value.PublicKey });
    }

    private static async Task<IResult> Subscribe(
        ClaimsPrincipal principal,
        HttpRequest http,
        AppDbContext db,
        UserDirectory users,
        IOptions<WebPushOptions> options,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (!options.Value.IsConfigured)
        {
            return ApiResults.Error(NotConfigured);
        }

        var body = await ReadSubscription(http, cancellationToken);
        if (body.Error is not null)
        {
            return ApiResults.Error(body.Error);
        }

        await users.UpsertAsync(principal, cancellationToken);
        var userId = Caller.Id(principal);
        var row = await db.PushSubscriptions.FirstOrDefaultAsync(item => item.Endpoint == body.Endpoint, cancellationToken);
        if (row is not null && row.UserId != userId)
        {
            return Results.NotFound();
        }

        if (row is null)
        {
            row = new PushSubscription { UserId = userId, Endpoint = body.Endpoint, CreatedAt = clock.GetUtcNow() };
            db.PushSubscriptions.Add(row);
        }

        row.P256dh = body.P256dh;
        row.Auth = body.Auth;
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { endpoint = row.Endpoint });
    }

    private static async Task<IResult> Unsubscribe(
        ClaimsPrincipal principal,
        HttpRequest http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var body = await ReadSubscription(http, cancellationToken);
        if (body.Error is not null)
        {
            return ApiResults.Error(body.Error);
        }

        var userId = Caller.Id(principal);
        var row = await db.PushSubscriptions.FirstOrDefaultAsync(
            item => item.UserId == userId && item.Endpoint == body.Endpoint,
            cancellationToken);
        if (row is null)
        {
            return Results.NotFound();
        }

        db.PushSubscriptions.Remove(row);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private readonly record struct Enabled(bool Value, string? Error);

    private static async Task<Enabled> ReadEnabled(HttpRequest http, CancellationToken cancellationToken)
    {
        try
        {
            using var json = await JsonDocument.ParseAsync(http.Body, cancellationToken: cancellationToken);
            var root = json.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("enabled", out var enabled)
                || enabled.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            {
                return new Enabled(false, NeedEnabled);
            }

            return new Enabled(enabled.GetBoolean(), null);
        }
        catch (JsonException)
        {
            return new Enabled(false, NeedEnabled);
        }
    }

    private readonly record struct Subscription(string Endpoint, string P256dh, string Auth, string? Error);

    private static async Task<Subscription> ReadSubscription(HttpRequest http, CancellationToken cancellationToken)
    {
        try
        {
            using var json = await JsonDocument.ParseAsync(http.Body, cancellationToken: cancellationToken);
            var root = json.RootElement;
            var endpoint = Text(root, "endpoint");
            var p256dh = Text(root, "p256dh");
            var auth = Text(root, "auth");
            if (root.TryGetProperty("keys", out var keys) && keys.ValueKind == JsonValueKind.Object)
            {
                p256dh = Text(keys, "p256dh");
                auth = Text(keys, "auth");
            }

            if (endpoint.Length == 0 || p256dh.Length == 0 || auth.Length == 0)
            {
                return new Subscription("", "", "", NeedSubscription);
            }

            return new Subscription(endpoint, p256dh, auth, null);
        }
        catch (JsonException)
        {
            return new Subscription("", "", "", NeedSubscription);
        }
    }

    private static string Text(JsonElement root, string name) =>
        root.ValueKind == JsonValueKind.Object
        && root.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";
}
