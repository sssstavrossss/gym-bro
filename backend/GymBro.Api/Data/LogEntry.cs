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

    /// <summary>
    /// Empty when <see cref="FoodId"/> is a shared catalogue food (<c>mvt</c> or <c>off</c>).
    /// The owner's id when the food is custom. Must be empty or equal to <see cref="UserId"/>,
    /// so a row cannot point at another person's food.
    /// </summary>
    public string FoodOwnerKey { get; set; } = Food.CatalogueOwnerKey;

    /// <summary>
    /// <c>off</c>, <c>mvt</c>, <c>custom</c>, or <c>quick</c>.
    /// Quick add is <c>quick</c> (not <c>manual</c>). Set on insert; never rewritten.
    /// </summary>
    public string? Source { get; set; }

    public string? SourceId { get; set; }

    /// <summary>
    /// Gram weight of what was logged. Null for a per-serving food that has no gram weight.
    /// A gram weight added to the food later does not rewrite this snapshot.
    /// </summary>
    public decimal? Grams { get; set; }

    public string Name { get; set; } = "";

    public decimal Amount { get; set; }

    public string Unit { get; set; } = "";

    public decimal Kcal { get; set; }

    public decimal Protein { get; set; }

    public decimal Fat { get; set; }

    public decimal Carbs { get; set; }

    public string IdempotencyKey { get; set; } = "";

    /// <summary>Set when the entry is soft-deleted. Null means it still counts.</summary>
    public DateTimeOffset? DeletedAt { get; set; }
}
