using GymBro.Api.Data;
using GymBro.Api.Nutrition;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Profiles;

public static class TargetBook
{
    public static async Task<DateOnly?> FirstDateAsync(
        AppDbContext db,
        string userId,
        CancellationToken cancellationToken)
    {
        return await db.TargetHistories.AsNoTracking()
            .Where(row => row.UserId == userId)
            .OrderBy(row => row.EffectiveDate)
            .Select(row => (DateOnly?)row.EffectiveDate)
            .FirstOrDefaultAsync(cancellationToken);
    }

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

    /// <summary>
    /// The burn the next target starts from: the row in effect carried to today's
    /// formula, with that row's spread. No row means the formula itself.
    /// </summary>
    public static (int Burn, int SdKcal) CarriedBurn(TargetHistory? row, NutritionResult formulaNow) => row is null
        ? (formulaNow.Tdee, NutritionMath.Round(BurnEstimate.FormulaSdKcal))
        : (BurnEstimate.Carry(formulaNow.Tdee, row.Tdee, row.FormulaTdee), row.BurnSdKcal);

    /// <summary>
    /// Inserts today's row, or updates it. The numbers and burn are replaced.
    /// Reasons already on the row stay, and <paramref name="reasons"/> are appended
    /// in order, skipping any that are already there. Details merge the same way.
    /// </summary>
    public static async Task<TargetHistory> StageAsync(
        AppDbContext db,
        string userId,
        DateOnly effectiveDate,
        NutritionResult result,
        TargetBurn burn,
        decimal weightKg,
        IReadOnlyList<string> reasons,
        DateTimeOffset createdAt,
        CancellationToken cancellationToken)
    {
        var row = await db.TargetHistories.FirstOrDefaultAsync(
            existing => existing.UserId == userId && existing.EffectiveDate == effectiveDate,
            cancellationToken);
        if (row is null)
        {
            var created = NewRow(userId, effectiveDate, result, burn, weightKg, reasons, createdAt);
            db.TargetHistories.Add(created);
            return created;
        }

        row.Bmr = result.Bmr;
        row.Tdee = result.Tdee;
        row.Kcal = result.Kcal;
        row.ProteinGrams = result.Protein;
        row.FatGrams = result.Fat;
        row.CarbGrams = result.Carbs;
        row.FloorApplied = result.FloorApplied;
        row.FormulaTdee = burn.FormulaTdee;
        row.BurnSdKcal = burn.BurnSdKcal;
        row.Details = TargetDetails.Serialize(TargetDetails.Merge(TargetDetails.Parse(row.Details), burn.Details));
        row.WeightKg = decimal.Round(weightKg, 2, MidpointRounding.AwayFromZero);
        row.Reasons = MergeReasons(row.Reasons, reasons);
        row.CreatedAt = createdAt;
        return row;
    }

    public static string[] MergeReasons(IReadOnlyList<string> existing, IReadOnlyList<string> added)
    {
        var merged = new List<string>(existing.Count + added.Count);
        foreach (var reason in existing)
        {
            if (reason.Length > 0 && !merged.Contains(reason))
            {
                merged.Add(reason);
            }
        }

        foreach (var reason in added)
        {
            if (reason.Length > 0 && !merged.Contains(reason))
            {
                merged.Add(reason);
            }
        }

        return merged.ToArray();
    }

    public static TargetHistory NewRow(
        string userId,
        DateOnly effectiveDate,
        NutritionResult result,
        TargetBurn burn,
        decimal weightKg,
        IReadOnlyList<string> reasons,
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
            FormulaTdee = burn.FormulaTdee,
            BurnSdKcal = burn.BurnSdKcal,
            Details = TargetDetails.Serialize(burn.Details),
            Reasons = MergeReasons([], reasons),
            WeightKg = decimal.Round(weightKg, 2, MidpointRounding.AwayFromZero),
            CreatedAt = createdAt,
        };
    }

}
