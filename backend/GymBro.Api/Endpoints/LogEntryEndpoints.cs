using System.Security.Claims;
using System.Text.Json;
using GymBro.Api.Data;
using GymBro.Api.Logging;
using GymBro.Api.Users;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Endpoints;

public static class LogEntryEndpoints
{
    public const string MissingEntry = "No entry with that id.";

    public const string MissingFood = "No food with that id.";

    public const string MissingGroup = "No group with that id.";

    public static RouteGroupBuilder MapLogEntries(this RouteGroupBuilder api)
    {
        api.MapPost("/log-entries", Add);
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

        var window = await WindowAsync(principal, draft.TimeZone, db, clock, cancellationToken);
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
        var source = owned.Food is null ? LogEntryRules.QuickSource : owned.Food.Source;
        var entry = new LogEntry
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            LocalDate = draft.LocalDate,
            LoggedAt = LogEntryRules.LocalTimestamp(draft.LocalDate, time),
            TimeZone = draft.TimeZone.Trim(),
            GroupId = owned.GroupId,
            FoodId = owned.Food?.Id,
            FoodOwnerKey = owned.Food?.UserId ?? Food.CatalogueOwnerKey,
            Source = source,
            SourceId = owned.Food?.SourceId,
            Grams = LogEntryRules.GramsFor(source, draft.Unit, draft.Amount, owned.Food),
            Name = draft.Name,
            Amount = draft.Amount,
            Unit = draft.Unit,
            Kcal = draft.Kcal,
            Protein = draft.Protein,
            Fat = draft.Fat,
            Carbs = draft.Carbs,
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
        var window = await WindowAsync(principal, zoneId, db, clock, cancellationToken);
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
        var unit = patch.Unit ?? entry.Unit;
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

        var scale = patch.Amount is not null
            && patch.Kcal is null
            && patch.Protein is null
            && patch.Fat is null
            && patch.Carbs is null
            && patch.Amount.Value != entry.Amount;
        decimal kcal = patch.Kcal ?? entry.Kcal;
        decimal protein = patch.Protein ?? entry.Protein;
        decimal fat = patch.Fat ?? entry.Fat;
        decimal carbs = patch.Carbs ?? entry.Carbs;
        decimal? grams = entry.Grams;
        if (scale)
        {
            if (entry.Amount == 0)
            {
                return ApiResults.Error("This entry has no amount to scale.");
            }

            var factor = patch.Amount!.Value / entry.Amount;
            kcal = LogEntryRules.Round2(entry.Kcal * factor);
            protein = LogEntryRules.Round2(entry.Protein * factor);
            fat = LogEntryRules.Round2(entry.Fat * factor);
            carbs = LogEntryRules.Round2(entry.Carbs * factor);
            if (entry.Grams is decimal storedGrams)
            {
                grams = LogEntryRules.Round2(storedGrams * factor);
            }
        }

        var nutrientError = LogEntryRules.RejectNutrients(kcal, protein, fat, carbs);
        if (nutrientError is not null)
        {
            return ApiResults.Error(nutrientError);
        }

        var time = patch.Time ?? TimeOnly.FromDateTime(entry.LoggedAt);
        entry.LocalDate = localDate;
        entry.LoggedAt = LogEntryRules.LocalTimestamp(localDate, time);
        entry.TimeZone = zoneId.Trim();
        entry.Name = patch.Name ?? entry.Name;
        entry.Amount = LogEntryRules.Round2(amount);
        entry.Unit = string.IsNullOrEmpty(unit) ? "" : LogEntryRules.NormalizeUnit(unit) ?? unit;
        entry.Kcal = LogEntryRules.Round2(kcal);
        entry.Protein = LogEntryRules.Round2(protein);
        entry.Fat = LogEntryRules.Round2(fat);
        entry.Carbs = LogEntryRules.Round2(carbs);
        if (entry.Source == LogEntryRules.QuickSource)
        {
            entry.Grams = null;
        }
        else if (scale)
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

    private static async Task<(string? Error, DateOnly SetupDate, DateOnly ClientToday, DateOnly ServerToday, TimeZoneInfo Zone)> WindowAsync(
        ClaimsPrincipal principal,
        string timeZoneId,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var zoneError = LogEntryRules.RejectZone(timeZoneId, clock, out var zone, out var clientToday, out var serverToday);
        if (zoneError is not null)
        {
            return (zoneError, default, default, default, TimeZoneInfo.Utc);
        }

        var userId = Caller.Id(principal);
        var created = await db.Profiles.AsNoTracking()
            .Where(row => row.UserId == userId)
            .Select(row => (DateTimeOffset?)row.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
        if (created is null)
        {
            return (LogEntryRules.NeedProfile, default, clientToday, serverToday, zone);
        }

        return (null, LogEntryRules.SetupDate(created.Value, zone), clientToday, serverToday, zone);
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
        grams = entry.Grams,
        name = entry.Name,
        amount = entry.Amount,
        unit = entry.Unit,
        kcal = entry.Kcal,
        protein = entry.Protein,
        fat = entry.Fat,
        carbs = entry.Carbs,
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

            unit = LogEntryRules.NormalizeUnit(Text(json, "unit")) ?? "";
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
            unit = LogEntryRules.NormalizeUnit(Text(json, "unit"));
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
