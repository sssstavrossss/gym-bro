using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Foods;

/// <summary>
/// One food from a national food table, ready to store: names, per-100 g values (micronutrients in
/// <see cref="ParsedFood.Panel"/>), household measures, the table's own search keywords, and the name written
/// other ways (<see cref="FoodAliasKinds.Name"/>).
/// </summary>
public sealed record FoodTableRow(
    ParsedFood Food,
    string? NameEn,
    IReadOnlyList<FoodPortion> Portions,
    IReadOnlyList<string> Keywords,
    IReadOnlyList<string>? OtherNames = null);

public sealed record FoodTableImportResult(int Upserted, int Retired, int Skipped, int Keywords, int Categories, string Coverage, int OtherNames = 0);

/// <summary>
/// Stores a whole food table for one <see cref="FoodSource"/>: upserts every row by source id, retires rows the
/// table no longer has, replaces the table's keywords, and records the citation. Each table's importer only reads
/// its own format and maps it to <see cref="FoodTableRow"/>s.
/// </summary>
public sealed class FoodTableImporter(AppDbContext db, TimeProvider clock, ILogger<FoodTableImporter> logger)
{
    /// <summary>A keyword on more foods than this names a group (<c>fisk</c>, <c>frukt</c>), not one food.</summary>
    public const int CategoryThreshold = 3;

    /// <summary>Shorter keywords (<c>rik</c>, <c>mix</c>) match too much to help.</summary>
    public const int KeywordMinLength = 4;

    /// <param name="rows">The table's foods. A null row is one the table's mapper could not use, counted as skipped.</param>
    public async Task<FoodTableImportResult> ImportAsync(
        FoodSource source,
        IEnumerable<FoodTableRow?> rows,
        CancellationToken cancellationToken)
    {
        var started = clock.GetUtcNow();
        var existing = await db.Foods
            .Where(food => food.Source == source.Id && food.UserId == null)
            .ToDictionaryAsync(food => food.SourceId, cancellationToken);
        var seen = new Dictionary<string, FoodTableRow>(StringComparer.Ordinal);
        var upserted = 0;
        var skipped = 0;

        foreach (var row in rows)
        {
            if (row is null || !seen.TryAdd(row.Food.SourceId, row))
            {
                skipped++;
                continue;
            }

            if (!existing.TryGetValue(row.Food.SourceId, out var food))
            {
                food = new Food { Id = Guid.NewGuid(), Source = source.Id, SourceId = row.Food.SourceId };
                db.Foods.Add(food);
                existing[row.Food.SourceId] = food;
            }

            Copy(source, row, food);
            food.RetiredAt = null;
            food.UpdatedAt = started;
            upserted++;
        }

        var retired = 0;
        foreach (var food in existing.Values)
        {
            if (food.RetiredAt is null && !seen.ContainsKey(food.SourceId))
            {
                food.RetiredAt = started;
                retired++;
            }
        }

        var credit = await db.FoodSourceCredits.FirstOrDefaultAsync(row => row.Source == source.Id, cancellationToken);
        if (credit is null)
        {
            credit = new FoodSourceCredit { Source = source.Id };
            db.FoodSourceCredits.Add(credit);
        }

        credit.Citation = source.Citation;
        credit.ImportedAt = started;
        credit.FoodCount = seen.Count;
        await db.SaveChangesAsync(cancellationToken);

        // Measures the table does not publish, put back on the rows the copy above just cleared.
        var measures = await FoodMeasures.ApplyAsync(db, source.Id, cancellationToken);
        var (keywords, categories, otherNames) = await ReplacePhrasesAsync(source, seen.Values.ToList(), cancellationToken);
        // Our phrases after the keywords, so a word the table also lists ranks as ours.
        var aliases = await FoodAliasCatalogue.ApplyAsync(db, source.Id, cancellationToken);
        logger.LogInformation(
            "{Source} import upserted {Upserted}, retired {Retired}, skipped {Skipped}; reviewed measures on {Measured} rows, {Renamed} renamed; {Keywords} keywords, {Categories} category words, {OtherNames} names in another word order; lexicon phrases added {Inserted}, already present {AlreadyPresent}, seeds skipped {SeedsSkipped}.",
            source.Name,
            upserted,
            retired,
            skipped,
            measures.Updated + measures.AlreadyPresent,
            measures.Renamed,
            keywords,
            categories,
            otherNames,
            aliases.Inserted,
            aliases.AlreadyPresent,
            aliases.Skipped);

        var live = existing.Values.Where(food => food.RetiredAt is null).ToList();
        var coverage = Micronutrients.CoverageLine(
            source.Name,
            live.Count,
            live.Count(food => food.SaturatedFatPer100 is not null),
            live.Count(food => food.SugarsPer100 is not null),
            live.Count(food => food.FiberPer100 is not null),
            live.Count(food => food.SaltPer100 is not null))
            + " " + Micronutrients.PanelCoverage(live);
        return new FoodTableImportResult(upserted, retired, skipped, keywords, categories, coverage, otherNames);
    }

    /// <summary>
    /// The table's keywords become search phrases of kind <see cref="FoodAliasKinds.Keyword"/>, or
    /// <see cref="FoodAliasKinds.Category"/> when more than <see cref="CategoryThreshold"/> foods share one, and
    /// its other names become phrases of kind <see cref="FoodAliasKinds.Name"/>. Last import's phrases are replaced.
    /// Our lexicon phrases are never touched, and a phrase that is already a lexicon phrase for that food is left to
    /// the lexicon.
    /// </summary>
    private async Task<(int Keywords, int Categories, int OtherNames)> ReplacePhrasesAsync(
        FoodSource source,
        IReadOnlyList<FoodTableRow> rows,
        CancellationToken cancellationToken)
    {
        // A word is a group word when many foods carry it, counting foods whose own name already says it.
        var parts = rows.Where(row => !string.IsNullOrWhiteSpace(row.NameEn))
            .Select(row => (Row: row, Phrases: KeywordPhrases(row).ToList()))
            .ToList();
        var shared = parts
            .SelectMany(part => part.Phrases.Select(phrase => phrase.Normalized).Distinct())
            .GroupBy(normalized => normalized)
            .Where(group => group.Count() > CategoryThreshold)
            .Select(group => group.Key)
            .ToHashSet(StringComparer.Ordinal);

        // A name written another way comes first, so a keyword with the same words does not make it a keyword.
        var wanted = new Dictionary<(string SourceId, string Normalized), (string Phrase, string NameEn, string Kind)>();
        foreach (var row in rows.Where(row => !string.IsNullOrWhiteSpace(row.NameEn)))
        {
            foreach (var other in row.OtherNames ?? [])
            {
                var text = other.Length <= 300 ? other : other[..300];
                var normalized = FoodAliasCatalogue.Normalize(text);
                if (normalized.Length > 0)
                {
                    wanted.TryAdd((row.Food.SourceId, normalized), (text, row.NameEn!, FoodAliasKinds.Name));
                }
            }
        }

        var otherNames = wanted.Count;
        foreach (var (row, phrases) in parts)
        {
            foreach (var phrase in phrases.Where(phrase => !phrase.InName))
            {
                var kind = shared.Contains(phrase.Normalized) ? FoodAliasKinds.Category : FoodAliasKinds.Keyword;
                wanted.TryAdd((row.Food.SourceId, phrase.Normalized), (phrase.Text, row.NameEn!, kind));
            }
        }

        var current = await db.FoodAliases
            .Where(alias => alias.Source == source.Id)
            .ToListAsync(cancellationToken);
        var byKey = current.ToDictionary(alias => (alias.SourceId, alias.Normalized));
        foreach (var alias in current)
        {
            if (alias.Kind != FoodAliasKinds.Lexicon && !wanted.ContainsKey((alias.SourceId, alias.Normalized)))
            {
                db.FoodAliases.Remove(alias);
            }
        }

        foreach (var ((sourceId, normalized), (phrase, nameEn, kind)) in wanted)
        {
            if (byKey.TryGetValue((sourceId, normalized), out var alias))
            {
                if (alias.Kind != FoodAliasKinds.Lexicon)
                {
                    alias.Kind = kind;
                    alias.Phrase = phrase;
                    alias.ExpectedNameEn = nameEn;
                }

                continue;
            }

            db.FoodAliases.Add(new FoodAlias
            {
                Id = Guid.NewGuid(),
                Source = source.Id,
                SourceId = sourceId,
                Phrase = phrase,
                Normalized = normalized,
                ExpectedNameEn = nameEn,
                Kind = kind,
            });
        }

        await db.SaveChangesAsync(cancellationToken);
        var categories = wanted.Values.Count(value => value.Kind == FoodAliasKinds.Category);
        return (wanted.Count - categories - otherNames, categories, otherNames);
    }

    /// <summary>
    /// A table's keyword list, one phrase per comma-separated part, folded the way search folds text.
    /// <see cref="KeywordPhrase.InName"/> marks a word the food's own names already contain, which adds nothing.
    /// </summary>
    internal static IEnumerable<KeywordPhrase> KeywordPhrases(FoodTableRow row)
    {
        var names = " " + FoodAliasCatalogue.Normalize(row.Food.Name) + " " + FoodAliasCatalogue.Normalize(row.NameEn) + " ";
        foreach (var keyword in row.Keywords)
        {
            foreach (var part in keyword.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
            {
                var text = part.Length <= 80 ? part : part[..80];
                var normalized = FoodAliasCatalogue.Normalize(text);
                if (normalized.Length >= KeywordMinLength)
                {
                    yield return new KeywordPhrase(text, normalized, names.Contains(" " + normalized + " ", StringComparison.Ordinal));
                }
            }
        }
    }

    internal sealed record KeywordPhrase(string Text, string Normalized, bool InName);

    private static void Copy(FoodSource source, FoodTableRow row, Food food)
    {
        var parsed = row.Food;
        food.UserId = null;
        food.Source = source.Id;
        food.SourceId = parsed.SourceId;
        food.Barcode = parsed.Barcode;
        food.Name = parsed.Name;
        food.NameEn = row.NameEn;
        food.Basis = parsed.Basis;
        food.NutrientBasis = NutrientBases.Per100;
        food.KcalPer100 = parsed.KcalPer100;
        food.ProteinPer100 = parsed.ProteinPer100;
        food.FatPer100 = parsed.FatPer100;
        food.CarbsPer100 = parsed.CarbsPer100;
        food.SaturatedFatPer100 = parsed.SaturatedFatPer100;
        food.SugarsPer100 = parsed.SugarsPer100;
        food.FiberPer100 = parsed.FiberPer100;
        food.SaltPer100 = parsed.SaltPer100;
        food.ServingQuantity = parsed.ServingQuantity;
        food.ServingLabel = parsed.ServingLabel;
        food.PieceQuantity = parsed.PieceQuantity;
        food.PieceLabel = parsed.PieceLabel;
        food.Portions = FoodPortions.Write(row.Portions);
        NutrientPanel.ApplyDictionary(food, parsed.Panel);
    }
}
