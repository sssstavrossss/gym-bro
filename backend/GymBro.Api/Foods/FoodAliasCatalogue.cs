using System.Text;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Foods;

public sealed record FoodAliasSeed(string SourceId, string ExpectedNameEn, IReadOnlyList<string> Phrases);

public sealed record FoodAliasApplyResult(int Inserted, int AlreadyPresent, int Skipped, int Considered);

/// <summary>
/// Curated search phrases for the national food tables. The preserved seeds below (Matvaretabellen) stay in
/// place. The lexicon adds everyday synonyms and punctuation phrases, and since v2 the same food's words in the
/// other Nordic languages (<see cref="FoodWord"/>), for every table it lists. This is not every possible synonym.
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

        // NFC first, so a typed "e" plus a combining accent is the same letter as "é".
        // char.ToLowerInvariant matches the stored search text. Postgres lower() does not:
        // it splits some letters and it drops combining marks.
        var text = value.Trim().Normalize(NormalizationForm.FormC);
        var buffer = new char[text.Length];
        var length = 0;
        var space = false;
        foreach (var ch in text)
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

    /// <summary>Adds the lexicon's phrases to every table it covers, or to one (<paramref name="source"/>) after its import.</summary>
    public static async Task<FoodAliasApplyResult> ApplyAsync(AppDbContext db, CancellationToken cancellationToken) =>
        await ApplyAsync(db, null, cancellationToken);

    public static async Task<FoodAliasApplyResult> ApplyAsync(AppDbContext db, string? source, CancellationToken cancellationToken)
    {
        var sources = FoodAliasLexicon.Current.Languages.Keys.Where(id => source is null || id == source).ToList();
        if (sources.Count == 0)
        {
            return new FoodAliasApplyResult(0, 0, 0, 0);
        }

        var foods = await db.Foods.AsNoTracking()
            .Where(food => sources.Contains(food.Source) && food.UserId == null)
            .Select(food => new { food.Source, food.SourceId, food.Name, food.NameEn })
            .ToListAsync(cancellationToken);
        var existing = await db.FoodAliases
            .Where(alias => sources.Contains(alias.Source))
            .ToListAsync(cancellationToken);
        // Keywords from the table and our phrases share one key, so a table keyword can already hold a phrase.
        var byKey = existing.ToDictionary(alias => (alias.Source, alias.SourceId, alias.Normalized));
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

            if (food.Source == Source)
            {
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
            }

            foreach (var phrase in FoodAliasPlanner.PhrasesFor(food.Source, food.SourceId, food.Name, food.NameEn))
            {
                var normalized = Normalize(phrase.Phrase);
                if (normalized.Length < 2)
                {
                    continue;
                }

                var key = (food.Source, food.SourceId, normalized);
                if (byKey.TryGetValue(key, out var row))
                {
                    if (row.ExpectedNameEn != food.NameEn)
                    {
                        row.ExpectedNameEn = food.NameEn;
                    }

                    // The table had the same word as a keyword. Ours is curated, so it ranks like a name.
                    row.Kind = FoodAliasKinds.Lexicon;

                    already++;
                    continue;
                }

                var created = new FoodAlias
                {
                    Id = Guid.NewGuid(),
                    Source = food.Source,
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

        // Seeds are Matvaretabellen's: count a missing one only when that table was applied.
        foreach (var seed in sources.Contains(Source) ? Seeds : [])
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
