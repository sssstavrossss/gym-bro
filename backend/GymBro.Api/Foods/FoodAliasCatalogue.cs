using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Foods;

public sealed record FoodAliasSeed(string SourceId, string ExpectedNameEn, IReadOnlyList<string> Phrases);

public sealed record FoodAliasApplyResult(int Inserted, int AlreadyPresent, int Skipped, int Considered);

/// <summary>
/// Curated search phrases for Matvaretabellen foods. The preserved seeds below
/// stay in place. Lexicon v1 adds everyday synonyms and punctuation phrases for
/// the rest of the catalogue. This is not every possible synonym.
/// Chicken fillet in this catalogue is the breast: thigh, drumstick, and whole leg
/// are different rows and are not given a breast phrase. A cooked fillet is not
/// treated as the raw row; each official row keeps its own nutrients and only
/// gains the shared culinary phrase. Hen breast is included only for the row whose
/// Norwegian name says bryst. Turkey fillet is included only for the turkey breast
/// rows, not for smoked turkey ham.
/// </summary>
public static class FoodAliasCatalogue
{
    public const string Source = Matvaretabellen.Source;

    private static readonly string[] ChickenBreast =
    [
        "chicken breast",
        "chicken breast fillet",
        "chicken fillet",
        "kyllingbryst",
        "kylling bryst",
    ];

    public static readonly IReadOnlyList<FoodAliasSeed> Seeds =
    [
        new("03.205", "Chicken, fillet, without skin, raw", ChickenBreast),
        new("03.242", "Chicken fillet, fried in fat", ChickenBreast),
        new("03.418", "Chicken, fillet, simmered", ChickenBreast),
        new("03.481", "Chicken fillet, fried without fat", ChickenBreast),
        new("03.224", "Hen, fillet, raw", ["hen breast", "hen fillet", "hønebryst"]),
        new("03.204", "Turkey, breast, without skin, raw", ["turkey fillet"]),
        new("03.241", "Turkey breast, without skin, roasted", ["turkey fillet"]),
    ];

    public static string Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "";
        }

        var buffer = new char[value.Length];
        var length = 0;
        var space = false;
        foreach (var ch in value.Trim())
        {
            if (char.IsLetterOrDigit(ch))
            {
                buffer[length++] = char.ToLowerInvariant(ch);
                space = false;
            }
            else if (!space && length > 0)
            {
                buffer[length++] = ' ';
                space = true;
            }
        }

        if (length > 0 && buffer[length - 1] == ' ')
        {
            length--;
        }

        return new string(buffer, 0, length);
    }

    public static async Task<FoodAliasApplyResult> ApplyAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        var foods = await db.Foods.AsNoTracking()
            .Where(food => food.Source == Source && food.UserId == null)
            .Select(food => new { food.SourceId, food.Name, food.NameEn })
            .ToListAsync(cancellationToken);
        var existing = await db.FoodAliases
            .Where(alias => alias.Source == Source)
            .ToListAsync(cancellationToken);
        var byKey = existing.ToDictionary(alias => (alias.SourceId, alias.Normalized));
        var seenSeeds = new HashSet<string>(StringComparer.Ordinal);
        var inserted = 0;
        var already = 0;
        var skipped = 0;

        foreach (var food in foods)
        {
            if (string.IsNullOrWhiteSpace(food.NameEn))
            {
                continue;
            }

            foreach (var seed in Seeds)
            {
                if (!string.Equals(seed.SourceId, food.SourceId, StringComparison.Ordinal))
                {
                    continue;
                }

                seenSeeds.Add(seed.SourceId);
                if (food.NameEn != seed.ExpectedNameEn)
                {
                    skipped++;
                }
            }

            foreach (var phrase in FoodAliasPlanner.PhrasesFor(food.SourceId, food.Name, food.NameEn))
            {
                var normalized = Normalize(phrase.Phrase);
                if (normalized.Length < 2)
                {
                    continue;
                }

                var key = (food.SourceId, normalized);
                if (byKey.TryGetValue(key, out var row))
                {
                    if (row.ExpectedNameEn != food.NameEn)
                    {
                        row.ExpectedNameEn = food.NameEn;
                    }

                    already++;
                    continue;
                }

                var created = new FoodAlias
                {
                    Id = Guid.NewGuid(),
                    Source = Source,
                    SourceId = food.SourceId,
                    Phrase = phrase.Phrase,
                    Normalized = normalized,
                    ExpectedNameEn = food.NameEn,
                };
                db.FoodAliases.Add(created);
                byKey[key] = created;
                inserted++;
            }
        }

        foreach (var seed in Seeds)
        {
            if (seenSeeds.Add(seed.SourceId))
            {
                skipped++;
            }
        }

        if (db.ChangeTracker.HasChanges())
        {
            await db.SaveChangesAsync(cancellationToken);
        }

        return new FoodAliasApplyResult(inserted, already, skipped, foods.Count);
    }
}
