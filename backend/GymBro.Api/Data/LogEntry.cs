namespace GymBro.Api.Data;

/// <summary>
/// One logged food. There is no meal column: the day is <see cref="LocalDate"/>
/// (the date chosen when logging) and the clock time is <see cref="LoggedAt"/>,
/// stored as local time in <see cref="TimeZone"/>, never derived from UTC.
/// The name and kcal/P/F/C columns are a snapshot so later food edits do not
/// rewrite history. <see cref="IdempotencyKey"/> is unique per user.
/// </summary>
public sealed class LogEntry
{
    public Guid Id { get; set; }

    public string UserId { get; set; } = "";

    public DateOnly LocalDate { get; set; }

    public DateTime LoggedAt { get; set; }

    public string TimeZone { get; set; } = "";

    public Guid? GroupId { get; set; }

    public Guid? FoodId { get; set; }

    /// <summary><c>off</c>, <c>matvaretabellen</c>, <c>custom</c>, or <c>manual</c>.</summary>
    public string? Source { get; set; }

    public string? SourceId { get; set; }

    public decimal? Grams { get; set; }

    public string Name { get; set; } = "";

    public decimal Amount { get; set; }

    public string Unit { get; set; } = "";

    public decimal Kcal { get; set; }

    public decimal Protein { get; set; }

    public decimal Fat { get; set; }

    public decimal Carbs { get; set; }

    public string IdempotencyKey { get; set; } = "";
}
