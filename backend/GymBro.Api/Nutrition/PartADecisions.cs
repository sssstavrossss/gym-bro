namespace GymBro.Api.Nutrition;

/// <summary>
/// The four S8 Part A edges still open with the product owner.
/// Each one is the only switch for that behaviour. The current spec is the default.
/// </summary>
public static class PartADecisions
{
    /// <summary>
    /// (1) Typo guard after a gap longer than 28 days.
    /// Current spec: still compare the new weigh-in with the previous day's trend, so a large jump asks.
    /// </summary>
    public const bool TypoGuardAfterLongGap = true;

    /// <summary>
    /// (2) Deleting the only weigh-in.
    /// Current spec: allowed. The trend becomes empty, the same as never having entered it.
    /// </summary>
    public const bool AllowDeletingTheOnlyWeighIn = true;

    /// <summary>
    /// (4) A back-dated weigh-in later closes the gap that produced a fresh_start target row.
    /// Current spec: target_history is never rewritten, so that row stays.
    /// </summary>
    public const bool RewriteFreshStartRowWhenGapCloses = false;

    /// <summary>
    /// Whether the typo guard runs for this entry. A missing previous weigh-in is the first
    /// weigh-in and is not checked. A gap over 28 days is decision (1).
    /// </summary>
    public static bool TypoGuardApplies(int? daysSincePreviousRealWeighIn)
    {
        if (daysSincePreviousRealWeighIn is int days && days > TrendWeight.MaxInterpolatedGapDays)
        {
            return TypoGuardAfterLongGap;
        }

        return true;
    }

    /// <summary>Whether this account may delete one of its weigh-ins. Decision (2).</summary>
    public static bool MayDeleteWeighIn(int weighInsOnAccount) =>
        weighInsOnAccount > 1 || AllowDeletingTheOnlyWeighIn;

    /// <summary>
    /// Decision (4). False leaves every target_history row alone when a later edit closes a fresh-start gap.
    /// </summary>
    public static bool ShouldRewriteFreshStartRow() => RewriteFreshStartRowWhenGapCloses;
}
