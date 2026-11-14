using System.Security.Claims;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using GymBro.Api.Logging;
using GymBro.Api.Users;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Endpoints;

public static class LogEntryEndpoints
{
    public const string MissingEntry = "No entry with that id.";

    public const string MissingFood = "No food with that id.";

    public const string MissingGroup = "No group with that id.";

    public const string NeedCopy = "Choose an entry to copy.";

    public const string DuplicateKey = "Use a different idempotency key for each copy.";

    public const string CopyLimit = "Copy up to 100 entries at a time.";

    public const int CopyMax = 100;

    public static RouteGroupBuilder MapLogEntries(this RouteGroupBuilder api)
    {
        api.MapPost("/log-entries", Add);
        api.MapPost("/log-entries/copy", Copy);
        api.MapGet("/log-entries", List);
        api.MapPatch("/log-entries/{id:guid}", Edit);
        api.MapDelete("/log-entries/{id:guid}", Delete);
        api.MapPost("/log-entries/{id:guid}/restore", Restore);
        return api;
    }

    private static async Task<IResult> Add(
        ClaimsPrincipal principal,
        HttpRequest http,
        AppDbContext db,
        UserDirectory users,
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
        await users.UpsertAsync(principal, cancellationToken);
        var userId = Caller.Id(principal);
        var existing = await db.LogEntries.AsNoTracking().FirstOrDefaultAsync(
            row => row.UserId == userId && row.IdempotencyKey == draft.IdempotencyKey,
            cancellationToken);
        if (existing is not null)
        {
            return Results.Ok(ToResponse(existing));
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

        var owned = await OwnFoodAndGroup(db, userId, draft.FoodId, draft.GroupId, cancellationToken);
        if (owned.Error is not null)
        {
            return ApiResults.Error(owned.Error, StatusCodes.Status404NotFound);
        }

        var time = draft.Time ?? LogEntryRules.NowIn(window.Zone, clock);
        var food = owned.Food;
        var source = food is null ? LogEntryRules.QuickSource : food.Source;
        var name = draft.Name;
        var kcal = draft.Kcal;
        var protein = draft.Protein;
        var fat = draft.Fat;
        var carbs = draft.Carbs;
        var amount = draft.Amount;
        var unit = draft.Unit;
        decimal? grams = null;
        decimal? saturated = null;
        decimal? sugars = null;
        decimal? fiber = null;
        decimal? salt = null;
        var snapshotUnit = draft.Unit;
        decimal? ownGrams = null;
        if (food is not null && LogEntryRules.NormalizeUnit(draft.Unit) is null && draft.Unit.Length > 0)
        {
            var key = draft.Unit.ToLowerInvariant();
            var serving = await db.UserServings.AsNoTracking().FirstOrDefaultAsync(
                row => row.UserId == userId && row.FoodId == food.Id && row.NameKey == key,
                cancellationToken);
            if (serving is null)
            {
                return ApiResults.Error(LogEntryRules.MissingServing(draft.Unit));
            }

            snapshotUnit = serving.Name;
            ownGrams = serving.Grams;
        }
        else if (food is null && LogEntryRules.NormalizeUnit(draft.Unit) is null && draft.Unit.Length > 0)
        {
            return ApiResults.Error(LogEntryRules.NeedUnit);
        }

        if (food is not null)
        {
            var snapshot = LogEntryRules.Snapshot(food, draft.Amount, snapshotUnit, ownGrams);
            if (snapshot.Error is not null)
            {
                return ApiResults.Error(snapshot.Error);
            }

            name = food.Name.Length <= 300 ? food.Name : food.Name[..300];
            kcal = snapshot.Kcal;
            protein = snapshot.Protein;
            fat = snapshot.Fat;
            carbs = snapshot.Carbs;
            unit = snapshot.Unit;
            grams = snapshot.Grams;
            saturated = snapshot.SaturatedFat;
            sugars = snapshot.Sugars;
            fiber = snapshot.Fiber;
            salt = snapshot.Salt;
        }

        var entry = new LogEntry
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            LocalDate = draft.LocalDate,
            LoggedAt = LogEntryRules.LocalTimestamp(draft.LocalDate, time),
            TimeZone = draft.TimeZone.Trim(),
            GroupId = owned.GroupId,
            FoodId = food?.Id,
            FoodOwnerKey = food?.UserId ?? Food.CatalogueOwnerKey,
            Source = source,
            SourceId = food?.SourceId,
            Grams = grams,
            Name = name,
            Amount = amount,
            Unit = unit,
            Kcal = kcal,
            Protein = protein,
            Fat = fat,
            Carbs = carbs,
            SaturatedFat = saturated,
            Sugars = sugars,
            Fiber = fiber,
            Salt = salt,
            IdempotencyKey = draft.IdempotencyKey,
        };
        db.LogEntries.Add(entry);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            var raced = await db.LogEntries.AsNoTracking().FirstOrDefaultAsync(
                row => row.UserId == userId && row.IdempotencyKey == draft.IdempotencyKey,
                cancellationToken);
            if (raced is null)
            {
                throw;
            }

            return Results.Ok(ToResponse(raced));
        }

        return Results.Json(ToResponse(entry), statusCode: StatusCodes.Status201Created);
    }

    private static async Task<IResult> List(
        ClaimsPrincipal principal,
        string? date,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        if (!LogEntryRules.TryDate(date, out var localDate))
        {
            return ApiResults.Error(LogEntryRules.BadDate);
        }

        var userId = Caller.Id(principal);
        var rows = await db.LogEntries.AsNoTracking()
            .Where(row => row.UserId == userId && row.LocalDate == localDate && row.DeletedAt == null)
            .OrderBy(row => row.LoggedAt)
            .ThenBy(row => row.Id)
            .ToListAsync(cancellationToken);
        return Results.Ok(new
        {
            localDate,
            totals = Totals(rows),
            entries = rows.Select(ToResponse).ToList(),
        });
    }

    private static async Task<IResult> Edit(
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

        var body = await ReadPatch(http, cancellationToken);
        if (body.Error is not null)
        {
            return ApiResults.Error(body.Error);
        }

        var patch = body.Patch!;
        var userId = Caller.Id(principal);
        var entry = await db.LogEntries.FirstOrDefaultAsync(
            row => row.Id == id && row.UserId == userId && row.DeletedAt == null,
            cancellationToken);
        if (entry is null)
        {
            return ApiResults.Error(MissingEntry, StatusCodes.Status404NotFound);
        }

        var zoneId = patch.TimeZone ?? entry.TimeZone;
        var window = await LogWindow.OpenAsync(userId, zoneId, db, clock, cancellationToken);
        if (window.Error is not null)
        {
            return ApiResults.Error(window.Error);
        }

        var localDate = patch.LocalDate ?? entry.LocalDate;
        var dateError = LogEntryRules.RejectDate(localDate, window.SetupDate, window.ClientToday, window.ServerToday);
        if (dateError is not null)
        {
            return ApiResults.Error(dateError);
        }

        var amount = patch.Amount ?? entry.Amount;
        var unit = patch.Unit ?? (LogEntryRules.CanonicalUnit(entry.Unit) ?? entry.Unit);
        if (patch.Amount is not null || patch.Unit is not null)
        {
            if (string.IsNullOrEmpty(unit))
            {
                return ApiResults.Error(LogEntryRules.NeedUnit);
            }

            var amountError = LogEntryRules.RejectAmount(amount, unit);
            if (amountError is not null)
            {
                return ApiResults.Error(amountError);
            }
        }

        var explicitNutrients = patch.Kcal is not null
            || patch.Protein is not null
            || patch.Fat is not null
            || patch.Carbs is not null;
        var oldUnit = LogEntryRules.CanonicalUnit(entry.Unit) ?? "";
        var newUnit = string.IsNullOrEmpty(unit) ? "" : LogEntryRules.CanonicalUnit(unit) ?? unit;
        var amountChanged = patch.Amount is not null && patch.Amount.Value != entry.Amount;
        var unitChanged = (patch.Amount is not null || patch.Unit is not null)
            && !string.Equals(newUnit, oldUnit, StringComparison.OrdinalIgnoreCase);
        decimal kcal = patch.Kcal ?? entry.Kcal;
        decimal protein = patch.Protein ?? entry.Protein;
        decimal fat = patch.Fat ?? entry.Fat;
        decimal carbs = patch.Carbs ?? entry.Carbs;
        decimal? grams = entry.Grams;
        var scaled = !explicitNutrients && (amountChanged || unitChanged);
        if (scaled)
        {
            var stored = LogEntryRules.ScaleStored(entry, amount, newUnit);
            if (stored.Error is not null)
            {
                return ApiResults.Error(stored.Error);
            }

            kcal = stored.Kcal;
            protein = stored.Protein;
            fat = stored.Fat;
            carbs = stored.Carbs;
            grams = stored.Grams;
            entry.SaturatedFat = stored.SaturatedFat;
            entry.Sugars = stored.Sugars;
            entry.Fiber = stored.Fiber;
            entry.Salt = stored.Salt;
        }
        else if (entry.Source == LogEntryRules.QuickSource)
        {
            grams = null;
        }

        if (entry.Source == LogEntryRules.QuickSource || explicitNutrients)
        {
            var nutrientError = LogEntryRules.RejectNutrients(kcal, protein, fat, carbs);
            if (nutrientError is not null)
            {
                return ApiResults.Error(nutrientError);
            }
        }

        var time = patch.Time ?? TimeOnly.FromDateTime(entry.LoggedAt);
        entry.LocalDate = localDate;
        entry.LoggedAt = LogEntryRules.LocalTimestamp(localDate, time);
        entry.TimeZone = zoneId.Trim();
        entry.Name = patch.Name ?? entry.Name;
        entry.Amount = LogEntryRules.Round2(amount);
        var storedUnit = string.IsNullOrEmpty(unit) ? "" : LogEntryRules.CanonicalUnit(unit) ?? unit;
        if (string.Equals(storedUnit, oldUnit, StringComparison.OrdinalIgnoreCase))
        {
            storedUnit = entry.Unit;
        }

        entry.Unit = storedUnit;
        entry.Kcal = LogEntryRules.Round2(kcal);
        entry.Protein = LogEntryRules.Round2(protein);
        entry.Fat = LogEntryRules.Round2(fat);
        entry.Carbs = LogEntryRules.Round2(carbs);
        if (entry.Source == LogEntryRules.QuickSource)
        {
            entry.Grams = null;
        }
        else if (scaled)
        {
            entry.Grams = grams;
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(ToResponse(entry));
    }

    private static async Task<IResult> Delete(
        ClaimsPrincipal principal,
        Guid id,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var userId = Caller.Id(principal);
        var entry = await db.LogEntries.FirstOrDefaultAsync(
            row => row.Id == id && row.UserId == userId && row.DeletedAt == null,
            cancellationToken);
        if (entry is null)
        {
            return ApiResults.Error(MissingEntry, StatusCodes.Status404NotFound);
        }

        entry.DeletedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> Restore(
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
        var entry = await db.LogEntries.FirstOrDefaultAsync(
            row => row.Id == id && row.UserId == userId,
            cancellationToken);
        if (entry is null)
        {
            return ApiResults.Error(MissingEntry, StatusCodes.Status404NotFound);
        }

        entry.DeletedAt = null;
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(ToResponse(entry));
    }

    /// <summary>
    /// Copies stored rows onto <c>localDate</c>. Each copy is a new id and key,
    /// with no group link. Times of day stay. Day complete is not touched.
    /// A missing, deleted, or someone else's row is 404 and nothing new is written.
    /// </summary>
    private static async Task<IResult> Copy(
        ClaimsPrincipal principal,
        HttpRequest http,
        AppDbContext db,
        UserDirectory users,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (Caller.MissingOid(principal) is { } denied)
        {
            return denied;
        }

        var body = await ReadCopy(http, cancellationToken);
        if (body.Missing)
        {
            return ApiResults.Error(body.Error ?? MissingEntry, StatusCodes.Status404NotFound);
        }

        if (body.Error is not null)
        {
            return ApiResults.Error(body.Error);
        }

        var draft = body.Draft!;
        await users.UpsertAsync(principal, cancellationToken);
        var userId = Caller.Id(principal);
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

        var keys = draft.Items.Select(item => item.IdempotencyKey).ToList();
        var existing = await db.LogEntries.AsNoTracking()
            .Where(row => row.UserId == userId && keys.Contains(row.IdempotencyKey))
            .ToListAsync(cancellationToken);
        var byKey = existing.ToDictionary(row => row.IdempotencyKey);
        var needed = draft.Items.Where(item => !byKey.ContainsKey(item.IdempotencyKey)).ToList();
        var sourceIds = needed.Select(item => item.Id).Distinct().ToList();
        var sources = sourceIds.Count == 0
            ? new List<LogEntry>()
            : await db.LogEntries.AsNoTracking()
                .Where(row => row.UserId == userId && sourceIds.Contains(row.Id) && row.DeletedAt == null)
                .ToListAsync(cancellationToken);
        if (sources.Count != sourceIds.Count)
        {
            return ApiResults.Error(MissingEntry, StatusCodes.Status404NotFound);
        }

        var byId = sources.ToDictionary(row => row.Id);
        var created = new List<LogEntry>();
        foreach (var item in needed)
        {
            var source = byId[item.Id];
            var copy = Clone(source, userId, draft.LocalDate, draft.TimeZone, item.IdempotencyKey);
            db.LogEntries.Add(copy);
            created.Add(copy);
            byKey[copy.IdempotencyKey] = copy;
        }

        var createdAny = created.Count > 0;
        if (createdAny)
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
                if (raced.Count != keys.Distinct().Count())
                {
                    throw;
                }

                byKey = raced.ToDictionary(row => row.IdempotencyKey);
                createdAny = false;
            }
        }

        var ordered = draft.Items.Select(item => byKey[item.IdempotencyKey]).ToList();
        var payload = new
        {
            localDate = draft.LocalDate,
            entries = ordered.Select(ToResponse).ToList(),
        };
        return createdAny
            ? Results.Json(payload, statusCode: StatusCodes.Status201Created)
            : Results.Ok(payload);
    }

    /// <summary>
    /// Exact stored values, a new id, and no group. The clock time is unchanged; the date is the one asked for.
    /// </summary>
    private static LogEntry Clone(LogEntry source, string userId, DateOnly localDate, string timeZone, string idempotencyKey)
    {
        var time = TimeOnly.FromDateTime(source.LoggedAt);
        return new LogEntry
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            LocalDate = localDate,
            LoggedAt = LogEntryRules.LocalTimestamp(localDate, time),
            TimeZone = timeZone.Trim(),
            GroupId = null,
            FoodId = source.FoodId,
            FoodOwnerKey = source.FoodOwnerKey,
            Source = source.Source,
            SourceId = source.SourceId,
            Grams = source.Grams,
            Name = source.Name,
            Amount = source.Amount,
            Unit = source.Unit,
            Kcal = source.Kcal,
            Protein = source.Protein,
            Fat = source.Fat,
            Carbs = source.Carbs,
            SaturatedFat = source.SaturatedFat,
            Sugars = source.Sugars,
            Fiber = source.Fiber,
            Salt = source.Salt,
            IdempotencyKey = idempotencyKey,
        };
    }

    private static async Task<(string? Error, Food? Food, Guid? GroupId)> OwnFoodAndGroup(
        AppDbContext db,
        string userId,
        Guid? foodId,
        Guid? groupId,
        CancellationToken cancellationToken)
    {
        Food? food = null;
        if (foodId is Guid id)
        {
            food = await db.Foods.FirstOrDefaultAsync(
                row => row.Id == id && row.RetiredAt == null && (row.UserId == null || row.UserId == userId),
                cancellationToken);
            if (food is null)
            {
                return (MissingFood, null, null);
            }
        }

        if (groupId is Guid group)
        {
            var ownsGroup = await db.EntryGroups.AnyAsync(
                row => row.Id == group && row.UserId == userId,
                cancellationToken);
            if (!ownsGroup)
            {
                return (MissingGroup, null, null);
            }
        }

        return (null, food, groupId);
    }

    private static object Totals(IReadOnlyList<LogEntry> rows) => new
    {
        kcal = rows.Sum(row => row.Kcal),
        protein = rows.Sum(row => row.Protein),
        fat = rows.Sum(row => row.Fat),
        carbs = rows.Sum(row => row.Carbs),
        saturatedFat = Micronutrients.CompleteSum(rows.Select(row => row.SaturatedFat)),
        sugars = Micronutrients.CompleteSum(rows.Select(row => row.Sugars)),
        fiber = Micronutrients.CompleteSum(rows.Select(row => row.Fiber)),
        salt = Micronutrients.CompleteSum(rows.Select(row => row.Salt)),
    };

    private static object ToResponse(LogEntry entry) => new
    {
        id = entry.Id,
        localDate = entry.LocalDate,
        loggedAt = entry.LoggedAt,
        time = TimeOnly.FromDateTime(entry.LoggedAt).ToString("HH:mm"),
        timeZone = entry.TimeZone,
        foodId = entry.FoodId,
        groupId = entry.GroupId,
        source = entry.Source,
        sourceId = entry.SourceId,
        grams = entry.Grams,
        name = entry.Name,
        amount = entry.Amount,
        unit = entry.Unit,
        kcal = entry.Kcal,
        protein = entry.Protein,
        fat = entry.Fat,
        carbs = entry.Carbs,
        saturatedFat = entry.SaturatedFat,
        sugars = entry.Sugars,
        fiber = entry.Fiber,
        salt = entry.Salt,
        idempotencyKey = entry.IdempotencyKey,
        deletedAt = entry.DeletedAt,
    };

    private sealed class CreateDraft
    {
        public string IdempotencyKey { get; init; } = "";

        public DateOnly LocalDate { get; init; }

        public TimeOnly? Time { get; init; }

        public string TimeZone { get; init; } = "";

        public string Name { get; init; } = "";

        public decimal Kcal { get; init; }

        public decimal Protein { get; init; }

        public decimal Fat { get; init; }

        public decimal Carbs { get; init; }

        public decimal Amount { get; init; }

        public string Unit { get; init; } = "";

        public Guid? FoodId { get; init; }

        public Guid? GroupId { get; init; }
    }

    private sealed class CopyItem
    {
        public Guid Id { get; init; }

        public string IdempotencyKey { get; init; } = "";
    }

    private sealed class CopyDraft
    {
        public DateOnly LocalDate { get; init; }

        public string TimeZone { get; init; } = "";

        public List<CopyItem> Items { get; init; } = [];
    }

    private sealed class PatchDraft
    {
        public string? Name { get; init; }

        public decimal? Kcal { get; init; }

        public decimal? Protein { get; init; }

        public decimal? Fat { get; init; }

        public decimal? Carbs { get; init; }

        public TimeOnly? Time { get; init; }

        public DateOnly? LocalDate { get; init; }

        public string? TimeZone { get; init; }

        public decimal? Amount { get; init; }

        public string? Unit { get; init; }
    }

    private static async Task<(CreateDraft? Draft, string? Error)> ReadCreate(HttpRequest http, CancellationToken cancellationToken)
    {
        var root = await ReadRoot(http, cancellationToken);
        if (root.Error is not null)
        {
            return (null, root.Error);
        }

        var json = root.Json!.RootElement;
        var key = Text(json, "idempotencyKey");
        if (string.IsNullOrWhiteSpace(key) || key.Trim().Length > 64)
        {
            return (null, LogEntryRules.NeedKey);
        }

        if (!LogEntryRules.TryDate(Text(json, "localDate"), out var localDate))
        {
            return (null, LogEntryRules.BadDate);
        }

        var zone = Text(json, "timeZone");
        if (string.IsNullOrWhiteSpace(zone))
        {
            return (null, LogEntryRules.UnknownZone);
        }

        TimeOnly? time = null;
        if (json.TryGetProperty("time", out var timeElement) && timeElement.ValueKind != JsonValueKind.Null)
        {
            if (timeElement.ValueKind != JsonValueKind.String || !LogEntryRules.TryTime(timeElement.GetString(), out var parsed))
            {
                return (null, LogEntryRules.BadTime);
            }

            time = parsed;
        }

        if (!TryOptionalDecimal(json, "kcal", out var kcal, out var kcalError) || kcalError is not null)
        {
            return (null, kcalError ?? LogEntryRules.BadNumber);
        }

        if (!TryOptionalDecimal(json, "protein", out var protein, out var proteinError) || proteinError is not null)
        {
            return (null, proteinError ?? LogEntryRules.BadNumber);
        }

        if (!TryOptionalDecimal(json, "fat", out var fat, out var fatError) || fatError is not null)
        {
            return (null, fatError ?? LogEntryRules.BadNumber);
        }

        if (!TryOptionalDecimal(json, "carbs", out var carbs, out var carbsError) || carbsError is not null)
        {
            return (null, carbsError ?? LogEntryRules.BadNumber);
        }

        var nutrientError = LogEntryRules.RejectNutrients(kcal ?? 0, protein ?? 0, fat ?? 0, carbs ?? 0);
        if (nutrientError is not null)
        {
            return (null, nutrientError);
        }

        var hasAmount = Has(json, "amount") || Has(json, "unit");
        decimal amount = 1;
        var unit = "";
        if (hasAmount)
        {
            if (!TryOptionalDecimal(json, "amount", out var parsedAmount, out var amountError) || amountError is not null || parsedAmount is null)
            {
                return (null, amountError ?? LogEntryRules.BadNumber);
            }

            var rawUnit = Text(json, "unit");
            var standard = LogEntryRules.NormalizeUnit(rawUnit);
            var named = standard is null ? LogEntryRules.NormalizeServingName(rawUnit) : null;
            if (standard is null && named is null)
            {
                return (null, LogEntryRules.NeedUnit);
            }

            unit = standard ?? named!;
            var limit = LogEntryRules.RejectAmount(parsedAmount.Value, unit);
            if (limit is not null)
            {
                return (null, limit);
            }

            amount = LogEntryRules.Round2(parsedAmount.Value);
        }

        if (!TryGuid(json, "foodId", out var foodId, out var foodError))
        {
            return (null, foodError);
        }

        if (!TryGuid(json, "groupId", out var groupId, out var groupError))
        {
            return (null, groupError);
        }

        var name = (Text(json, "name") ?? "").Trim();
        if (name.Length > 300)
        {
            return (null, "Use a shorter name.");
        }

        if (name.Length == 0)
        {
            name = "Quick add";
        }

        return (new CreateDraft
        {
            IdempotencyKey = key.Trim(),
            LocalDate = localDate,
            Time = time,
            TimeZone = zone.Trim(),
            Name = name,
            Kcal = LogEntryRules.Round2(kcal ?? 0),
            Protein = LogEntryRules.Round2(protein ?? 0),
            Fat = LogEntryRules.Round2(fat ?? 0),
            Carbs = LogEntryRules.Round2(carbs ?? 0),
            Amount = amount,
            Unit = unit,
            FoodId = foodId,
            GroupId = groupId,
        }, null);
    }

    private static async Task<(CopyDraft? Draft, string? Error, bool Missing)> ReadCopy(HttpRequest http, CancellationToken cancellationToken)
    {
        var root = await ReadRoot(http, cancellationToken);
        if (root.Error is not null)
        {
            return (null, root.Error, false);
        }

        var json = root.Json!.RootElement;
        if (!LogEntryRules.TryDate(Text(json, "localDate"), out var localDate))
        {
            return (null, LogEntryRules.BadDate, false);
        }

        var zone = Text(json, "timeZone");
        if (string.IsNullOrWhiteSpace(zone))
        {
            return (null, LogEntryRules.UnknownZone, false);
        }

        if (!json.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array || items.GetArrayLength() == 0)
        {
            return (null, NeedCopy, false);
        }

        if (items.GetArrayLength() > CopyMax)
        {
            return (null, CopyLimit, false);
        }

        var list = new List<CopyItem>();
        var seenKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in items.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                return (null, NeedCopy, false);
            }

            var key = Text(item, "idempotencyKey");
            if (string.IsNullOrWhiteSpace(key) || key.Trim().Length > 64)
            {
                return (null, LogEntryRules.NeedKey, false);
            }

            key = key.Trim();
            if (!seenKeys.Add(key))
            {
                return (null, DuplicateKey, false);
            }

            var idText = Text(item, "id");
            if (idText is null || !Guid.TryParse(idText, out var id))
            {
                return (null, MissingEntry, true);
            }

            list.Add(new CopyItem { Id = id, IdempotencyKey = key });
        }

        return (new CopyDraft { LocalDate = localDate, TimeZone = zone.Trim(), Items = list }, null, false);
    }

    private static async Task<(PatchDraft? Patch, string? Error)> ReadPatch(HttpRequest http, CancellationToken cancellationToken)
    {
        var root = await ReadRoot(http, cancellationToken);
        if (root.Error is not null)
        {
            return (null, root.Error);
        }

        var json = root.Json!.RootElement;
        string? name = null;
        if (Has(json, "name"))
        {
            name = (Text(json, "name") ?? "").Trim();
            if (name.Length is 0 or > 300)
            {
                return (null, name.Length == 0 ? "Give the entry a name." : "Use a shorter name.");
            }
        }

        if (!TryPatchDecimal(json, "kcal", out var kcal, out var kcalError))
        {
            return (null, kcalError);
        }

        if (!TryPatchDecimal(json, "protein", out var protein, out var proteinError))
        {
            return (null, proteinError);
        }

        if (!TryPatchDecimal(json, "fat", out var fat, out var fatError))
        {
            return (null, fatError);
        }

        if (!TryPatchDecimal(json, "carbs", out var carbs, out var carbsError))
        {
            return (null, carbsError);
        }

        TimeOnly? time = null;
        if (Has(json, "time"))
        {
            if (!LogEntryRules.TryTime(Text(json, "time"), out var parsed))
            {
                return (null, LogEntryRules.BadTime);
            }

            time = parsed;
        }

        DateOnly? localDate = null;
        if (Has(json, "localDate"))
        {
            if (!LogEntryRules.TryDate(Text(json, "localDate"), out var parsed))
            {
                return (null, LogEntryRules.BadDate);
            }

            localDate = parsed;
        }

        string? zone = null;
        if (Has(json, "timeZone"))
        {
            zone = Text(json, "timeZone")?.Trim();
            if (string.IsNullOrEmpty(zone))
            {
                return (null, LogEntryRules.UnknownZone);
            }
        }

        if (!TryPatchDecimal(json, "amount", out var amount, out var amountError))
        {
            return (null, amountError);
        }

        string? unit = null;
        if (Has(json, "unit"))
        {
            unit = LogEntryRules.CanonicalUnit(Text(json, "unit"));
            if (unit is null)
            {
                return (null, LogEntryRules.NeedUnit);
            }
        }

        return (new PatchDraft
        {
            Name = name,
            Kcal = kcal,
            Protein = protein,
            Fat = fat,
            Carbs = carbs,
            Time = time,
            LocalDate = localDate,
            TimeZone = zone,
            Amount = amount is null ? null : LogEntryRules.Round2(amount.Value),
            Unit = unit,
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

    private static bool Has(JsonElement json, string name) =>
        json.TryGetProperty(name, out var element) && element.ValueKind != JsonValueKind.Null;

    private static string? Text(JsonElement json, string name)
    {
        if (!json.TryGetProperty(name, out var element) || element.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return element.GetString();
    }

    private static bool TryOptionalDecimal(JsonElement json, string name, out decimal? value, out string? error)
    {
        value = null;
        error = null;
        if (!json.TryGetProperty(name, out var element) || element.ValueKind == JsonValueKind.Null)
        {
            return true;
        }

        if (!LogEntryRules.TryFlexible(element, out var parsed))
        {
            error = LogEntryRules.BadNumber;
            return false;
        }

        value = parsed;
        return true;
    }

    private static bool TryPatchDecimal(JsonElement json, string name, out decimal? value, out string? error)
    {
        value = null;
        error = null;
        if (!Has(json, name))
        {
            return true;
        }

        return TryOptionalDecimal(json, name, out value, out error) && value is not null;
    }

    private static bool TryGuid(JsonElement json, string name, out Guid? id, out string? error)
    {
        id = null;
        error = null;
        if (!Has(json, name))
        {
            return true;
        }

        if (!json.TryGetProperty(name, out var element) || element.ValueKind != JsonValueKind.String
            || !Guid.TryParse(element.GetString(), out var parsed))
        {
            error = name == "foodId" ? MissingFood : MissingGroup;
            return false;
        }

        id = parsed;
        return true;
    }
}
