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
}
