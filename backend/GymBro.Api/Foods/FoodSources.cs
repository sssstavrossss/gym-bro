using GymBro.Api.Data;

namespace GymBro.Api.Foods;

/// <summary>A national food table or product list, and the country its foods come from.</summary>
public sealed record FoodSource(string Id, string Name, string Country, string Citation);

/// <summary>
/// Catalogue sources by country. Search puts the home country's foods first, then its neighbours', then the rest
/// (<see cref="Tier"/>). A food whose source is not listed here (a custom food, a cached Open Food Facts product)
/// counts as home: someone here added or fetched it.
/// </summary>
public static class FoodSources
{
    /// <summary>
    /// The food country when none can be told: no profile yet, or a time zone that is no country's (<c>UTC</c>).
    /// Otherwise it comes from <see cref="GymBro.Api.Profiles.FoodCountries.Home(Profile)"/>.
    /// </summary>
    public const string DefaultHome = "NO";

    public static readonly FoodSource Matvaretabellen = new(
        Foods.Matvaretabellen.Source, "Matvaretabellen", "NO", Foods.Matvaretabellen.Citation);

    public static readonly FoodSource Kassalapp = new(
        Foods.Kassalapp.Source, "Kassalapp", "NO", Foods.Kassalapp.Citation);

    public static readonly FoodSource Livsmedelsverket = new(
        Foods.Livsmedelsverket.Source, "Livsmedelsverket", "SE", Foods.Livsmedelsverket.Citation);

    public static readonly FoodSource Fineli = new(
        Foods.Fineli.Source, "Fineli", "FI", Foods.Fineli.Citation);

    /// <summary>The United States' table: home there, and after the home table and its neighbours everywhere else.</summary>
    public static readonly FoodSource Usda = new(
        Foods.Usda.Source, "USDA FoodData Central", "US", Foods.Usda.Citation);

    public static readonly IReadOnlyList<FoodSource> All = [Matvaretabellen, Kassalapp, Livsmedelsverket, Fineli, Usda];

    /// <summary>Countries whose foods come second for one another. Nordic tables share most dishes and names.</summary>
    private static readonly IReadOnlySet<string> Nordic = new HashSet<string>(StringComparer.Ordinal) { "NO", "SE", "FI", "DK", "IS" };

    public static FoodSource? Find(string source) =>
        All.FirstOrDefault(entry => string.Equals(entry.Id, source, StringComparison.Ordinal));

    /// <summary>The country of a catalogue source, or null for a food that is not from a national table.</summary>
    public static string? Country(string source) => Find(source)?.Country;

    /// <summary>0 for home (and foods with no country), 1 for a neighbour, 2 for anywhere else.</summary>
    public static int Tier(string source, string home)
    {
        var country = Country(source);
        if (country is null || country == home)
        {
            return 0;
        }

        return Nordic.Contains(country) && Nordic.Contains(home) ? 1 : 2;
    }

    /// <summary>
    /// The name to show and to log: another country's food goes by its English name when it has one, since its
    /// own name may be in a language the person does not read. A home food keeps its own name.
    /// </summary>
    public static string DisplayName(Food food, string home) =>
        Tier(food.Source, home) > 0 && !string.IsNullOrWhiteSpace(food.NameEn) ? food.NameEn : food.Name;

    /// <summary>Source ids at one tier for <paramref name="home"/>; used to build the search order in SQL.</summary>
    public static IReadOnlyList<string> SourcesAtTier(int tier, string home) =>
        All.Where(entry => Tier(entry.Id, home) == tier).Select(entry => entry.Id).ToList();
}
