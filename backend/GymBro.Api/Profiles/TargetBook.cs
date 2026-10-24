using GymBro.Api.Data;
using GymBro.Api.Nutrition;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Profiles;

public static class TargetBook
{
    public static async Task<TargetHistory?> InEffectAsync(
        AppDbContext db,
        string userId,
        DateOnly date,
        CancellationToken cancellationToken)
    {
        return await db.TargetHistories.AsNoTracking()
            .Where(row => row.UserId == userId && row.EffectiveDate <= date)
            .OrderByDescending(row => row.EffectiveDate)
            .ThenByDescending(row => row.CreatedAt)
            .ThenByDescending(row => row.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public static TargetHistory NewRow(
        string userId,
        DateOnly effectiveDate,
        NutritionResult result,
        decimal weightKg,
        string reason,
        DateTimeOffset createdAt)
    {
        return new TargetHistory
        {
            UserId = userId,
            EffectiveDate = effectiveDate,
            Bmr = result.Bmr,
            Tdee = result.Tdee,
            Kcal = result.Kcal,
            ProteinGrams = result.Protein,
            FatGrams = result.Fat,
            CarbGrams = result.Carbs,
            FloorApplied = result.FloorApplied,
            Reason = reason,
            WeightKg = decimal.Round(weightKg, 2, MidpointRounding.AwayFromZero),
            CreatedAt = createdAt,
        };
    }

    /// <summary>
    /// Writes today's targets with reason <see cref="TargetReasons.FreshStart"/>.
    /// If a row already exists for today, that latest row is updated in place
    /// (decision 31). Earlier days are left as they were.
    /// </summary>
    public static async Task<TargetHistory> UpsertTodayAsync(
        AppDbContext db,
        string userId,
        DateOnly today,
        NutritionResult result,
        decimal weightKg,
        string reason,
        DateTimeOffset createdAt,
        CancellationToken cancellationToken)
    {
        var latest = await db.TargetHistories
            .Where(row => row.UserId == userId && row.EffectiveDate == today)
            .OrderByDescending(row => row.CreatedAt)
            .ThenByDescending(row => row.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (latest is null)
        {
            latest = NewRow(userId, today, result, weightKg, reason, createdAt);
            db.TargetHistories.Add(latest);
            return latest;
        }

        latest.Bmr = result.Bmr;
        latest.Tdee = result.Tdee;
        latest.Kcal = result.Kcal;
        latest.ProteinGrams = result.Protein;
        latest.FatGrams = result.Fat;
        latest.CarbGrams = result.Carbs;
        latest.FloorApplied = result.FloorApplied;
        latest.Reason = reason;
        latest.WeightKg = decimal.Round(weightKg, 2, MidpointRounding.AwayFromZero);
        return latest;
    }
}
