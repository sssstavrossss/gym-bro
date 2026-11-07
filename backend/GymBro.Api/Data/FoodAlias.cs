namespace GymBro.Api.Data;

/// <summary>
/// A hidden search phrase for one catalogue food, keyed by source and source id
/// rather than the food row id. Import may update the food row; these phrases stay.
/// <see cref="ExpectedNameEn"/> must still equal the food's English name, so a reused
/// source id does not keep a phrase that belonged to a different food.
/// </summary>
public sealed class FoodAlias
{
    public Guid Id { get; set; }

    public string Source { get; set; } = "";

    public string SourceId { get; set; } = "";

    public string Phrase { get; set; } = "";

    public string Normalized { get; set; } = "";

    public string ExpectedNameEn { get; set; } = "";
}
