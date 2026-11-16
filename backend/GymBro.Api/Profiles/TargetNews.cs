using GymBro.Api.Data;
using GymBro.Api.Nutrition;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Profiles;

/// <summary>
/// Target changes the app made on its own (the Monday update) that the person
/// has not looked at yet. Changes they make themselves are never new to them.
/// </summary>
public static class TargetNews
{
    /// <summary>
    /// A change the person makes on the same day merges into the Monday row and comes after it in
    /// <see cref="TargetHistory.Reasons"/>, so the row is only new while the Monday update is its latest reason.
    /// </summary>
    public static bool IsNew(TargetHistory row, DateTimeOffset? seenAt) =>
        seenAt is { } seen && row.CreatedAt > seen && row.LatestReason == TargetReasons.WeeklyRecalculation;

    public static async Task<bool> AnyAsync(AppDbContext db, string userId, DateTimeOffset? seenAt, CancellationToken cancellationToken)
    {
        if (seenAt is not { } seen)
        {
            return false;
        }

        var candidates = await db.TargetHistories.AsNoTracking()
            .Where(row => row.UserId == userId && row.CreatedAt > seen && row.Reasons.Contains(TargetReasons.WeeklyRecalculation))
            .ToListAsync(cancellationToken);
        return candidates.Any(row => IsNew(row, seenAt));
    }
}
