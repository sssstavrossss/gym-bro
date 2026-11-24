namespace GymBro.Api.Data;

/// <summary>Where a <see cref="FoodAlias"/> came from.</summary>
public static class FoodAliasKinds
{
    /// <summary>Our own curated phrase (<c>food-alias-lexicon</c>). Kept across imports.</summary>
    public const string Lexicon = "lexicon";

    /// <summary>The food table's own search word for this food (<c>sylteagurk</c>, <c>kaffi</c>). Replaced on each import.</summary>
    public const string Keyword = "keyword";

    /// <summary>
    /// A table keyword shared by many foods (<c>fisk</c>, <c>frukt</c>). It finds those foods but never ranks them
    /// above a food whose own name matches. Replaced on each import.
    /// </summary>
    public const string Category = "category";

    /// <summary>
    /// The food's own name in everyday word order, written by the table's importer (USDA's "Fish, salmon, raw" as
    /// "salmon, Fish, raw"). It ranks half a level below the name. Replaced on each import.
    /// </summary>
    public const string Name = "name";
}

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

    /// <summary>One of <see cref="FoodAliasKinds"/>.</summary>
    public string Kind { get; set; } = FoodAliasKinds.Lexicon;
}
