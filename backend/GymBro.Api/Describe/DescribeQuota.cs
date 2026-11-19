using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Describe;

/// <summary>
/// How many descriptions a person has left. Every attempt in the last 24 hours counts, except one that
/// failed because Claude couldn't be reached. <see cref="NextAt"/> is when the oldest counted one ages out,
/// set only when none are left.
/// </summary>
public sealed record DescribeQuota(int Limit, int Used, DateTimeOffset? NextAt)
{
    public static readonly TimeSpan Window = TimeSpan.FromHours(24);

    public int Left => Math.Max(0, Limit - Used);

    public static async Task<DescribeQuota> ReadAsync(
        AppDbContext db,
        string userId,
        int limit,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var since = now - Window;
        var counted = db.MealDescriptions.AsNoTracking()
            .Where(row => row.UserId == userId && row.CreatedAt > since && row.Outcome != MealOutcomes.Failed);
        var used = await counted.CountAsync(cancellationToken);
        if (used < limit)
        {
            return new DescribeQuota(limit, used, null);
        }

        // The slot that frees first is the one that pushed the count to the limit, counted from the newest.
        var freeing = await counted
            .OrderByDescending(row => row.CreatedAt)
            .Skip(Math.Max(0, limit - 1))
            .Select(row => (DateTimeOffset?)row.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
        return new DescribeQuota(limit, used, freeing + Window);
    }
}
