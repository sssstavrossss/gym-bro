namespace GymBro.Api.Data;

/// <summary>
/// One declined recalculation. It stores the suggestion and does not change
/// the target in effect. Several declines on the same day each keep a row.
/// </summary>
public sealed class RecalculationDecline
{
    public long Id { get; set; }

    public string UserId { get; set; } = "";

    public DateOnly PeriodFrom { get; set; }

    public DateOnly PeriodTo { get; set; }

    public int SuggestedBmr { get; set; }

    public int SuggestedTdee { get; set; }

    public int SuggestedKcal { get; set; }

    public int SuggestedProtein { get; set; }

    public int SuggestedFat { get; set; }

    public int SuggestedCarbs { get; set; }

    public int KeptKcal { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}
