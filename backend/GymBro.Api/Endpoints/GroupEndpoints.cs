using System.Security.Claims;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Logging;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Endpoints;

public static class GroupEndpoints
{
    public static RouteGroupBuilder MapGroups(this RouteGroupBuilder api)
    {
        api.MapGet("/groups", List);
        api.MapGet("/groups/{id:guid}", One);
        api.MapPost("/groups", Create);
        api.MapDelete("/groups/{id:guid}", Delete);
        api.MapPost("/groups/{id:guid}/log", Log);
        return api;
    }

    private static async Task<IResult> List(
        ClaimsPrincipal principal,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var groups = await LoadGroups(db, userId, null, cancellationToken);
        return Results.Ok(new GroupListResponse(groups));
    }

    private static async Task<IResult> One(
        ClaimsPrincipal principal,
        Guid id,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var groups = await LoadGroups(db, Caller.Id(principal), id, cancellationToken);
        if (groups.Count == 0)
        {
            return ApiResults.Error(LogEntryEndpoints.MissingGroup, StatusCodes.Status404NotFound);
        }

        return Results.Ok(groups[0]);
    }

    private static async Task<IResult> Create(
        ClaimsPrincipal principal,
        HttpRequest http,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var body = await ReadCreate(http, cancellationToken);
        if (body.Error is not null)
        {
            return ApiResults.Error(body.Error);
        }

        var draft = body.Draft!;
        var userId = Caller.Id(principal);
        var rows = await db.LogEntries
            .Where(row => row.UserId == userId && draft.EntryIds.Contains(row.Id))
            .ToListAsync(cancellationToken);
        if (rows.Count != draft.EntryIds.Count)
        {
            return ApiResults.Error(LogEntryEndpoints.MissingEntry, StatusCodes.Status404NotFound);
        }

        var byId = rows.ToDictionary(row => row.Id);
        var live = draft.EntryIds
            .Select(id => byId[id])
            .Where(row => row.DeletedAt is null)
            .ToList();
        if (live.Count < 2)
        {
            return ApiResults.Error(GroupRules.NeedTwo);
        }

        var group = new EntryGroup
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Name = draft.Name,
            CreatedAt = clock.GetUtcNow(),
        };
        db.EntryGroups.Add(group);
        for (var i = 0; i < live.Count; i++)
        {
            var entry = live[i];
            db.EntryGroupItems.Add(new EntryGroupItem
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                GroupId = group.Id,
                Position = i,
                FoodId = entry.FoodId,
                FoodOwnerKey = entry.FoodId is null ? Food.CatalogueOwnerKey : entry.FoodOwnerKey,
                Name = entry.Name,
                Amount = entry.Amount,
                Unit = entry.Unit,
                Grams = entry.Grams,
                Kcal = entry.Kcal,
                Protein = entry.Protein,
                Fat = entry.Fat,
                Carbs = entry.Carbs,
                SaturatedFat = entry.SaturatedFat,
                Sugars = entry.Sugars,
                Fiber = entry.Fiber,
                Salt = entry.Salt,
            });
        }

        await db.SaveChangesAsync(cancellationToken);
        var saved = await LoadGroups(db, userId, group.Id, cancellationToken);
        return Results.Json(saved[0], statusCode: StatusCodes.Status201Created);
    }

    private static async Task<IResult> Delete(
        ClaimsPrincipal principal,
        Guid id,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var group = await db.EntryGroups.FirstOrDefaultAsync(
            row => row.Id == id && row.UserId == userId,
            cancellationToken);
        if (group is null)
        {
            return ApiResults.Error(LogEntryEndpoints.MissingGroup, StatusCodes.Status404NotFound);
        }

        var linked = await db.LogEntries
            .Where(row => row.UserId == userId && row.GroupId == id)
            .ToListAsync(cancellationToken);
        foreach (var entry in linked)
        {
            entry.GroupId = null;
        }

        db.EntryGroups.Remove(group);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> Log(
        ClaimsPrincipal principal,
        Guid id,
        HttpRequest http,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var body = await ReadLog(http, cancellationToken);
        if (body.Error is not null)
        {
            return ApiResults.Error(body.Error);
        }

        var draft = body.Draft!;
        var userId = Caller.Id(principal);
        var group = await db.EntryGroups.AsNoTracking().FirstOrDefaultAsync(
            row => row.Id == id && row.UserId == userId,
            cancellationToken);
        if (group is null)
        {
            return ApiResults.Error(LogEntryEndpoints.MissingGroup, StatusCodes.Status404NotFound);
        }

        var window = await LogWindow.OpenAsync(userId, draft.TimeZone, db, clock, cancellationToken);
        if (window.Error is not null)
        {
            return ApiResults.Error(window.Error);
        }

        var dateError = LogEntryRules.RejectDate(draft.LocalDate, window.SetupDate, window.ClientToday, window.ServerToday);
        if (dateError is not null)
        {
            return ApiResults.Error(dateError);
        }

        if (draft.Time is null && draft.LocalDate != window.ClientToday)
        {
            return ApiResults.Error(GroupRules.PickTime);
        }

        var time = draft.Time ?? LogEntryRules.NowIn(window.Zone, clock);
        var items = await db.EntryGroupItems.AsNoTracking()
            .Where(row => row.UserId == userId && row.GroupId == id)
            .OrderBy(row => row.Position)
            .ToListAsync(cancellationToken);
        var context = await LoadPlans(db, userId, items, cancellationToken);
        var keys = items.Select(item => GroupRules.ItemKey(draft.IdempotencyKey, item.Position)).ToList();
        var existing = await db.LogEntries
            .Where(row => row.UserId == userId && keys.Contains(row.IdempotencyKey))
            .ToListAsync(cancellationToken);
        var byKey = existing.ToDictionary(row => row.IdempotencyKey);
        var created = new List<LogEntry>();
        if (existing.Count == 0)
        {
            foreach (var item in items)
            {
                var plan = context.Plan(item);
                if (!plan.Add)
                {
                    continue;
                }

                var entry = new LogEntry
                {
                    Id = Guid.NewGuid(),
                    UserId = userId,
                    LocalDate = draft.LocalDate,
                    LoggedAt = LogEntryRules.LocalTimestamp(draft.LocalDate, time),
                    TimeZone = draft.TimeZone.Trim(),
                    GroupId = group.Id,
                    FoodId = plan.FoodId,
                    FoodOwnerKey = plan.FoodOwnerKey,
                    Source = plan.Source,
                    SourceId = plan.SourceId,
                    Grams = plan.Grams,
                    Name = plan.Name,
                    Amount = plan.Amount,
                    Unit = plan.Unit,
                    Kcal = plan.Kcal,
                    Protein = plan.Protein,
                    Fat = plan.Fat,
                    Carbs = plan.Carbs,
                    SaturatedFat = plan.SaturatedFat,
                    Sugars = plan.Sugars,
                    Fiber = plan.Fiber,
                    Salt = plan.Salt,
                    IdempotencyKey = GroupRules.ItemKey(draft.IdempotencyKey, item.Position),
                };
                db.LogEntries.Add(entry);
                created.Add(entry);
                byKey[entry.IdempotencyKey] = entry;
            }

            if (created.Count > 0)
            {
                try
                {
                    await db.SaveChangesAsync(cancellationToken);
                }
                catch (DbUpdateException)
                {
                    db.ChangeTracker.Clear();
                    var raced = await db.LogEntries.AsNoTracking()
                        .Where(row => row.UserId == userId && keys.Contains(row.IdempotencyKey))
                        .ToListAsync(cancellationToken);
                    if (raced.Count == 0)
                    {
                        throw;
                    }

                    byKey = raced.ToDictionary(row => row.IdempotencyKey);
                    created.Clear();
                }
            }
        }

        var ordered = new List<LogEntry>();
        var skipped = new List<SkippedItemResponse>();
        foreach (var item in items)
        {
            var key = GroupRules.ItemKey(draft.IdempotencyKey, item.Position);
            if (byKey.TryGetValue(key, out var entry))
            {
                ordered.Add(entry);
                continue;
            }

            var plan = context.Plan(item);
            if (!plan.Add)
            {
                skipped.Add(new SkippedItemResponse(plan.Name, plan.Notice));
            }
        }

        var payload = new GroupLogResponse(
            draft.LocalDate,
            time.ToString("HH:mm"),
            ordered.Select(ToResponse).ToList(),
            skipped,
            GroupRules.JoinNotices(skipped.Select(row => row.Notice)));
        return created.Count > 0
            ? Results.Json(payload, statusCode: StatusCodes.Status201Created)
            : Results.Ok(payload);
    }

    private static async Task<List<GroupResponse>> LoadGroups(
        AppDbContext db,
        string userId,
        Guid? id,
        CancellationToken cancellationToken)
    {
        var groups = await db.EntryGroups.AsNoTracking()
            .Where(row => row.UserId == userId && (id == null || row.Id == id))
            .OrderByDescending(row => row.CreatedAt)
            .ThenByDescending(row => row.Id)
            .ToListAsync(cancellationToken);
        if (groups.Count == 0)
        {
            return [];
        }

        var groupIds = groups.Select(row => row.Id).ToList();
        var items = await db.EntryGroupItems.AsNoTracking()
            .Where(row => row.UserId == userId && groupIds.Contains(row.GroupId))
            .OrderBy(row => row.Position)
            .ToListAsync(cancellationToken);
        var context = await LoadPlans(db, userId, items, cancellationToken);
        var byGroup = items.GroupBy(row => row.GroupId).ToDictionary(group => group.Key, group => group.ToList());
        return groups.Select(group => Project(group, byGroup.GetValueOrDefault(group.Id) ?? [], context)).ToList();
    }

    private static async Task<PlanContext> LoadPlans(
        AppDbContext db,
        string userId,
        IReadOnlyList<EntryGroupItem> items,
        CancellationToken cancellationToken)
    {
        var foodIds = items.Where(row => row.FoodId is not null).Select(row => row.FoodId!.Value).Distinct().ToList();
        var foods = foodIds.Count == 0
            ? []
            : await db.Foods.AsNoTracking()
                .Where(food => foodIds.Contains(food.Id) && (food.UserId == null || food.UserId == userId))
                .ToListAsync(cancellationToken);
        var servings = foodIds.Count == 0
            ? []
            : await db.UserServings.AsNoTracking()
                .Where(row => row.UserId == userId && foodIds.Contains(row.FoodId))
                .ToListAsync(cancellationToken);
        return new PlanContext(foods.ToDictionary(food => food.Id), servings);
    }

    private static GroupResponse Project(EntryGroup group, IReadOnlyList<EntryGroupItem> items, PlanContext context)
    {
        var rows = items.Select(item =>
        {
            var plan = context.Plan(item);
            var show = plan.Add;
            return new GroupItemResponse(
                item.Id,
                item.FoodId,
                plan.Name.Length > 0 ? plan.Name : item.Name,
                show ? plan.Amount : item.Amount,
                show ? plan.Unit : item.Unit,
                show ? plan.Grams : item.Grams,
                show ? plan.Kcal : item.Kcal,
                show ? plan.Protein : item.Protein,
                show ? plan.Fat : item.Fat,
                show ? plan.Carbs : item.Carbs,
                item.FoodId is null,
                show,
                show ? plan.SaturatedFat : item.SaturatedFat,
                show ? plan.Sugars : item.Sugars,
                show ? plan.Fiber : item.Fiber,
                show ? plan.Salt : item.Salt);
        }).ToList();
        return new GroupResponse(group.Id, group.Name, group.CreatedAt, rows.Sum(row => row.Kcal), rows);
    }

    private static LoggedRow ToResponse(LogEntry entry) => new(
        entry.Id,
        entry.LocalDate,
        entry.LoggedAt,
        TimeOnly.FromDateTime(entry.LoggedAt).ToString("HH:mm"),
        entry.TimeZone,
        entry.FoodId,
        entry.GroupId,
        entry.Source,
        entry.SourceId,
        entry.Grams,
        entry.Name,
        entry.Amount,
        entry.Unit,
        entry.Kcal,
        entry.Protein,
        entry.Fat,
        entry.Carbs,
        entry.IdempotencyKey,
        entry.DeletedAt,
        entry.SaturatedFat,
        entry.Sugars,
        entry.Fiber,
        entry.Salt);

    private sealed record GroupListResponse(IReadOnlyList<GroupResponse> Groups);

    private sealed record GroupResponse(
        Guid Id,
        string Name,
        DateTimeOffset CreatedAt,
        decimal Kcal,
        IReadOnlyList<GroupItemResponse> Items);

    private sealed record GroupItemResponse(
        Guid Id,
        Guid? FoodId,
        string Name,
        decimal Amount,
        string Unit,
        decimal? Grams,
        decimal Kcal,
        decimal Protein,
        decimal Fat,
        decimal Carbs,
        bool Quick,
        bool Available,
        decimal? SaturatedFat = null,
        decimal? Sugars = null,
        decimal? Fiber = null,
        decimal? Salt = null);

    private sealed record SkippedItemResponse(string Name, string Notice);

    private sealed record GroupLogResponse(
        DateOnly LocalDate,
        string Time,
        IReadOnlyList<LoggedRow> Entries,
        IReadOnlyList<SkippedItemResponse> Skipped,
        string Notice);

    private sealed record LoggedRow(
        Guid Id,
        DateOnly LocalDate,
        DateTime LoggedAt,
        string Time,
        string TimeZone,
        Guid? FoodId,
        Guid? GroupId,
        string? Source,
        string? SourceId,
        decimal? Grams,
        string Name,
        decimal Amount,
        string Unit,
        decimal Kcal,
        decimal Protein,
        decimal Fat,
        decimal Carbs,
        string IdempotencyKey,
        DateTimeOffset? DeletedAt,
        decimal? SaturatedFat = null,
        decimal? Sugars = null,
        decimal? Fiber = null,
        decimal? Salt = null);

    private sealed class PlanContext(Dictionary<Guid, Food> foods, List<UserServing> servings)
    {
        public PlannedItem Plan(EntryGroupItem item)
        {
            Food? food = null;
            if (item.FoodId is Guid id)
            {
                foods.TryGetValue(id, out food);
            }

            decimal? ownGrams = null;
            if (item.FoodId is Guid foodId && item.Unit.Length > 0 && LogEntryRules.NormalizeUnit(item.Unit) is null)
            {
                var key = item.Unit.ToLowerInvariant();
                ownGrams = servings.FirstOrDefault(row => row.FoodId == foodId && row.NameKey == key)?.Grams;
            }

            return GroupRules.Plan(item, food, ownGrams);
        }
    }

    private sealed class CreateDraft
    {
        public string Name { get; init; } = "";

        public List<Guid> EntryIds { get; init; } = [];
    }

    private sealed class LogDraft
    {
        public DateOnly LocalDate { get; init; }

        public string TimeZone { get; init; } = "";

        public TimeOnly? Time { get; init; }

        public string IdempotencyKey { get; init; } = "";
    }

    private static async Task<(CreateDraft? Draft, string? Error)> ReadCreate(HttpRequest http, CancellationToken cancellationToken)
    {
        var root = await ReadRoot(http, cancellationToken);
        if (root.Error is not null)
        {
            return (null, root.Error);
        }

        using var json = root.Json;
        var body = json!.RootElement;
        var nameError = GroupRules.RejectName(Text(body, "name"), out var name);
        if (nameError is not null)
        {
            return (null, nameError);
        }

        if (!body.TryGetProperty("entryIds", out var ids) || ids.ValueKind != JsonValueKind.Array || ids.GetArrayLength() == 0)
        {
            return (null, GroupRules.NeedEntries);
        }

        if (ids.GetArrayLength() > GroupRules.MaxItems)
        {
            return (null, GroupRules.TooMany);
        }

        var list = new List<Guid>();
        var seen = new HashSet<Guid>();
        foreach (var element in ids.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.String || !Guid.TryParse(element.GetString(), out var id))
            {
                return (null, LogEntryEndpoints.MissingEntry);
            }

            if (seen.Add(id))
            {
                list.Add(id);
            }
        }

        if (list.Count > GroupRules.MaxItems)
        {
            return (null, GroupRules.TooMany);
        }

        return (new CreateDraft { Name = name, EntryIds = list }, null);
    }

    private static async Task<(LogDraft? Draft, string? Error)> ReadLog(HttpRequest http, CancellationToken cancellationToken)
    {
        var root = await ReadRoot(http, cancellationToken);
        if (root.Error is not null)
        {
            return (null, root.Error);
        }

        using var json = root.Json;
        var body = json!.RootElement;
        if (!LogEntryRules.TryDate(Text(body, "localDate"), out var localDate))
        {
            return (null, LogEntryRules.BadDate);
        }

        var zone = Text(body, "timeZone");
        if (string.IsNullOrWhiteSpace(zone))
        {
            return (null, LogEntryRules.UnknownZone);
        }

        TimeOnly? time = null;
        if (body.TryGetProperty("time", out var timeElement) && timeElement.ValueKind != JsonValueKind.Null)
        {
            if (timeElement.ValueKind != JsonValueKind.String || !LogEntryRules.TryTime(timeElement.GetString(), out var parsed))
            {
                return (null, LogEntryRules.BadTime);
            }

            time = parsed;
        }

        var key = Text(body, "idempotencyKey");
        if (string.IsNullOrWhiteSpace(key))
        {
            return (null, LogEntryRules.NeedKey);
        }

        key = key.Trim();
        if (key.Length > GroupRules.KeyMax)
        {
            return (null, GroupRules.KeyLength);
        }

        return (new LogDraft
        {
            LocalDate = localDate,
            TimeZone = zone.Trim(),
            Time = time,
            IdempotencyKey = key,
        }, null);
    }

    private static async Task<(JsonDocument? Json, string? Error)> ReadRoot(HttpRequest http, CancellationToken cancellationToken)
    {
        try
        {
            var document = await JsonDocument.ParseAsync(http.Body, cancellationToken: cancellationToken);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                document.Dispose();
                return (null, LogEntryRules.BadNumber);
            }

            return (document, null);
        }
        catch (JsonException)
        {
            return (null, LogEntryRules.BadNumber);
        }
    }

    private static string? Text(JsonElement json, string name)
    {
        if (!json.TryGetProperty(name, out var element) || element.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return element.GetString();
    }
}
