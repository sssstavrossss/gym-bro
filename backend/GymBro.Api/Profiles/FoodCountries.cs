using System.Reflection;
using GymBro.Api.Data;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Profiles;

/// <summary>
/// The person's food country: its foods come first in search and Describe, and keep their own names
/// (<see cref="FoodSources.Tier"/>). It is the time zone's country until a country is picked by hand.
/// </summary>
public static class FoodCountries
{
    public const string Invalid = "That country is not known.";

    /// <summary>IANA zone to ISO country, from the tz database (<c>zone-countries.tsv</c>).</summary>
    private static readonly IReadOnlyDictionary<string, string> Zones = Load();

    /// <summary>Every country a zone belongs to: the countries that can be picked.</summary>
    public static readonly IReadOnlySet<string> Codes = Zones.Values.ToHashSet(StringComparer.Ordinal);

    /// <summary>The country of a time zone, or null for one that is not a country's (<c>UTC</c>, <c>Etc/GMT+1</c>).</summary>
    public static string? OfZone(string? zone) =>
        zone is not null && Zones.TryGetValue(zone, out var country) ? country : null;

    public static bool IsKnown(string? code) => code is not null && Codes.Contains(code);

    /// <summary>
    /// The country search favours. Following the zone, a zone with no country falls back to
    /// <see cref="FoodSources.DefaultHome"/>, as does a person with no profile yet.
    /// </summary>
    public static string Home(string? timeZone, bool followsZone, string? picked) =>
        followsZone || !IsKnown(picked)
            ? OfZone(timeZone) ?? FoodSources.DefaultHome
            : picked!;

    public static string Home(Profile? profile) =>
        profile is null ? FoodSources.DefaultHome : Home(profile.TimeZone, profile.FoodCountryFollowsZone, profile.FoodCountry);

    /// <summary>The caller's food country, read without loading the whole profile.</summary>
    public static async Task<string> HomeAsync(AppDbContext db, string userId, CancellationToken cancellationToken)
    {
        var row = await db.Profiles
            .Where(profile => profile.UserId == userId)
            .Select(profile => new { profile.TimeZone, profile.FoodCountryFollowsZone, profile.FoodCountry })
            .FirstOrDefaultAsync(cancellationToken);
        return row is null ? FoodSources.DefaultHome : Home(row.TimeZone, row.FoodCountryFollowsZone, row.FoodCountry);
    }

    private static Dictionary<string, string> Load()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var name = assembly.GetManifestResourceNames().Single(resource => resource.EndsWith("zone-countries.tsv", StringComparison.Ordinal));
        using var reader = new StreamReader(assembly.GetManifestResourceStream(name)!);
        var zones = new Dictionary<string, string>(StringComparer.Ordinal);
        while (reader.ReadLine() is { } line)
        {
            if (line.Length == 0 || line[0] == '#')
            {
                continue;
            }

            var parts = line.Split('\t');
            zones[parts[0]] = parts[1];
        }

        return zones;
    }
}
