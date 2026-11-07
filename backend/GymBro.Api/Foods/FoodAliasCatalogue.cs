using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Foods;

public sealed record FoodAliasSeed(string SourceId, string ExpectedNameEn, IReadOnlyList<string> Phrases);

public sealed record FoodAliasApplyResult(int Inserted, int AlreadyPresent, int Skipped);

/// <summary>
/// Curated search phrases for Matvaretabellen foods. The English names and ids
/// were taken from the public foods.json files (Norwegian and English) and only
/// where the official name supports the cut. This is not a complete synonym list.
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
        var sourceIds = Seeds.Select(seed => seed.SourceId).Distinct().ToArray();
        var foods = await db.Foods.AsNoTracking()
            .Where(food => food.Source == Source && food.UserId == null && sourceIds.Contains(food.SourceId))
            .Select(food => new { food.SourceId, food.NameEn })
            .ToListAsync(cancellationToken);
        var names = foods.ToDictionary(food => food.SourceId, food => food.NameEn, StringComparer.Ordinal);

        var wanted = new List<(string SourceId, string Phrase, string Normalized, string ExpectedNameEn)>();
        var skipped = 0;
        foreach (var seed in Seeds)
        {
            if (!names.TryGetValue(seed.SourceId, out var nameEn) || nameEn != seed.ExpectedNameEn)
            {
                skipped++;
                continue;
            }

            foreach (var phrase in seed.Phrases)
            {
                var normalized = Normalize(phrase);
                if (normalized.Length < 2)
                {
                    continue;
                }

                wanted.Add((seed.SourceId, phrase.Trim(), normalized, seed.ExpectedNameEn));
            }
        }

        var existing = await db.FoodAliases
            .Where(alias => alias.Source == Source && sourceIds.Contains(alias.SourceId))
            .Select(alias => new { alias.SourceId, alias.Normalized })
            .ToListAsync(cancellationToken);
        var present = existing.Select(alias => (alias.SourceId, alias.Normalized)).ToHashSet();
        var inserted = 0;
        var already = 0;
        foreach (var row in wanted.DistinctBy(item => (item.SourceId, item.Normalized)))
        {
            if (!present.Add((row.SourceId, row.Normalized)))
            {
                already++;
                continue;
            }

            db.FoodAliases.Add(new FoodAlias
            {
                Id = Guid.NewGuid(),
                Source = Source,
                SourceId = row.SourceId,
                Phrase = row.Phrase,
                Normalized = row.Normalized,
                ExpectedNameEn = row.ExpectedNameEn,
            });
            inserted++;
        }

        if (inserted > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
        }

        return new FoodAliasApplyResult(inserted, already, skipped);
    }
}
