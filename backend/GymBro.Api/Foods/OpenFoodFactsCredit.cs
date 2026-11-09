namespace GymBro.Api.Foods;

/// <summary>
/// Credit shown in About. The contact address, when one is set, stays in the
/// local User-Agent and is not part of this sentence.
/// </summary>
public static class OpenFoodFactsCredit
{
    public const string Citation = "Data from Open Food Facts. https://world.openfoodfacts.org";

    public static readonly TimeSpan RefreshAge = TimeSpan.FromDays(30);

    /// <summary>
    /// A cached product is refreshed only once it is older than 30 days.
    /// Updated 29 days ago, or exactly 30 days ago, is left as stored.
    /// </summary>
    public static bool NeedsRefresh(DateTimeOffset updatedAt, DateTimeOffset now) =>
        now - updatedAt > RefreshAge;
}
