#:project ../../backend/GymBro.Api/GymBro.Api.csproj
#:property PublishAot=false
// The API project's packages pull these older builds, which NuGet audit flags. Pin the patched ones.
#:package Newtonsoft.Json@13.0.4
#:package System.Security.Cryptography.Xml@10.0.13

// Describe a meal accuracy check. Runs every case in cases.json through the real pipeline (Claude plus the
// catalogue search) and scores the foods and amounts against what the case expects.
//
// It calls the real Claude API and is never part of CI. Each case is a split and a pick call, about a tenth
// of a cent on Haiku. Usage is in README.md under "Describe a meal" → "Measuring accuracy".
//
//   dotnet run tools/describe-eval/eval.cs -- [--runs 3] [--only id,id] [--home SE] [--out results.json] [--verbose]
//
// --home is the food country for cases that do not name one (Norway when left out).
//
// ANTHROPIC_API_KEY  the key (required).
// EVAL_DB            a Postgres connection string for a database with the catalogue imported.
// DESCRIBE_MODEL     the model, when not the app's default.
// EVAL_USER          an oid whose own foods and servings count as "yours" (optional).

using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using GymBro.Api.Data;
using GymBro.Api.Describe;
using GymBro.Api.Foods;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

var arguments = EvalArguments.Parse(args);
var key = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY") ?? "";
if (key.Length == 0)
{
    Console.Error.WriteLine("ANTHROPIC_API_KEY is not set. This check calls the real Claude API.");
    return 2;
}

var connection = Environment.GetEnvironmentVariable("EVAL_DB") ?? "Host=localhost;Database=gymbro;Username=gymbro;Password=gymbro";
var userId = Environment.GetEnvironmentVariable("EVAL_USER") ?? "describe-eval";
var describeOptions = new DescribeOptions { ApiKey = key };
var modelName = Environment.GetEnvironmentVariable("DESCRIBE_MODEL");
if (!string.IsNullOrWhiteSpace(modelName))
{
    describeOptions.Model = modelName;
}

var casesPath = Path.GetFullPath(arguments.Cases);
var cases = JsonSerializer.Deserialize<List<EvalCase>>(File.ReadAllText(casesPath), Json.Options) ?? [];
if (arguments.Only.Count > 0)
{
    cases = cases.Where(item => arguments.Only.Contains(item.Id)).ToList();
}

await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connection).Options);
var references = await References.LoadAsync(db, cases);
var trace = new TraceModel(new ClaudeMealModel(Options.Create(describeOptions), NullLogger<ClaudeMealModel>.Instance), arguments.Verbose);
var describer = new MealDescriber(db, trace);

Console.WriteLine($"{cases.Count} cases × {arguments.Runs} run(s), model {describeOptions.Model}");
var outcomes = new List<CaseOutcome>();
foreach (var evalCase in cases)
{
    MealPhoto? photo = null;
    if (evalCase.Photo is { } photoPath)
    {
        var file = Path.Combine(Path.GetDirectoryName(casesPath)!, photoPath);
        if (!File.Exists(file))
        {
            Console.WriteLine($"- {evalCase.Id}: skipped, no photo at {photoPath}");
            continue;
        }

        var type = file.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ? "image/png" : "image/jpeg";
        (photo, var error) = MealPhoto.Read(type, Convert.ToBase64String(File.ReadAllBytes(file)));
        if (photo is null)
        {
            Console.WriteLine($"- {evalCase.Id}: skipped, {error}");
            continue;
        }
    }

    for (var run = 1; run <= arguments.Runs; run++)
    {
        var usage = new MealUsage();
        var watch = Stopwatch.StartNew();
        if (arguments.Verbose)
        {
            Console.WriteLine($"\n######## {evalCase.Id} (run {run}): {evalCase.Text}");
        }

        IReadOnlyList<DescribedItem> items;
        string? failure = null;
        try
        {
            items = await describer.DescribeAsync(userId, new MealNote(evalCase.Text.Trim(), photo, null, evalCase.Home ?? arguments.Home ?? FoodSources.DefaultHome), usage, CancellationToken.None);
        }
        catch (MealModelException ex)
        {
            items = [];
            failure = ex.Message;
        }

        var outcome = Scoring.Score(evalCase, run, items, references, usage, watch.ElapsedMilliseconds, failure);
        outcomes.Add(outcome);
        Console.WriteLine(Report.Line(outcome));
    }
}

Console.WriteLine();
Console.WriteLine(Report.Summary(outcomes));
if (arguments.Out is { } outPath)
{
    File.WriteAllText(outPath, JsonSerializer.Serialize(outcomes, Json.Options));
    Console.WriteLine($"Wrote {outPath}");
}

return 0;

/// <summary>
/// One meal note and what a good answer holds. <see cref="Alternatives"/> lists other good answers (a taco as
/// one dish, or as shells, meat and cheese); the best-scoring one counts. <see cref="Home"/> is the person's food
/// country (Norway when left out).
/// </summary>
sealed record EvalCase(string Id, string Text, string? Photo, IReadOnlyList<ExpectedFood>? Expect, IReadOnlyList<IReadOnlyList<ExpectedFood>>? Alternatives, string? Note, string? Home)
{
    public IReadOnlyList<IReadOnlyList<ExpectedFood>> Answers => [.. Expect is null ? [] : new[] { Expect }, .. Alternatives ?? []];
}

/// <summary>
/// A food the answer should hold. <see cref="Match"/> is a case-insensitive pattern on the catalogue name; the
/// shortest name it matches is the reference for the expected kcal. <see cref="Grams"/> is left out when the note
/// gives no amount. An optional food (oil for frying) may be there or not.
/// </summary>
sealed record ExpectedFood(string Match, decimal? Grams, decimal? Tolerance, bool Optional);

sealed record ItemOutcome(string Phrase, string? Food, decimal Amount, string Unit, decimal? Grams, decimal? Kcal, string Verdict);

sealed record CaseOutcome(
    string Id,
    int Run,
    int Required,
    int Found,
    int AmountsChecked,
    int AmountsRight,
    int Extra,
    int NoMatch,
    decimal? ExpectedKcal,
    decimal? Kcal,
    int Calls,
    int InputTokens,
    int OutputTokens,
    long Milliseconds,
    string? Failure,
    IReadOnlyList<string> Missing,
    IReadOnlyList<ItemOutcome> Items)
{
    /// <summary>Kcal off by this share of the expected total, when every required food has an amount.</summary>
    public decimal? KcalError => ExpectedKcal is > 0 && Kcal is { } kcal ? Math.Abs(kcal - ExpectedKcal.Value) / ExpectedKcal.Value : null;

    public bool EmptyExpected => Required == 0;
}

static class Scoring
{
    public const decimal DefaultTolerance = 0.35m;

    /// <summary>The outcome against whichever good answer it is closest to.</summary>
    public static CaseOutcome Score(
        EvalCase evalCase,
        int run,
        IReadOnlyList<DescribedItem> items,
        References references,
        MealUsage usage,
        long milliseconds,
        string? failure) =>
        evalCase.Answers
            .Select(answer => Score(evalCase.Id, answer, run, items, references, usage, milliseconds, failure))
            .OrderByDescending(outcome => outcome.Required == 0 ? 0 : (decimal)outcome.Found / outcome.Required)
            .ThenBy(outcome => outcome.Extra)
            .ThenByDescending(outcome => outcome.AmountsRight)
            .First();

    private static CaseOutcome Score(
        string id,
        IReadOnlyList<ExpectedFood> answer,
        int run,
        IReadOnlyList<DescribedItem> items,
        References references,
        MealUsage usage,
        long milliseconds,
        string? failure)
    {
        var used = new bool[items.Count];
        var verdicts = new string?[items.Count];
        var missing = new List<string>();
        int required = 0, found = 0, checkedAmounts = 0, rightAmounts = 0;
        decimal? expectedKcal = 0, kcal = 0;
        foreach (var expected in answer)
        {
            if (!expected.Optional)
            {
                required++;
            }

            var index = Enumerable.Range(0, items.Count)
                .FirstOrDefault(i => !used[i] && items[i].Food is { } food && Regex.IsMatch(food.Name, expected.Match, RegexOptions.IgnoreCase), -1);
            if (index < 0)
            {
                if (!expected.Optional)
                {
                    missing.Add(expected.Match);
                    expectedKcal = Add(expectedKcal, references.Kcal(expected));
                }

                continue;
            }

            used[index] = true;
            var item = items[index];
            var grams = Grams(item);
            if (!expected.Optional)
            {
                found++;
                expectedKcal = Add(expectedKcal, references.Kcal(expected));
                kcal = Add(kcal, Kcal(item));
            }

            if (expected.Grams is { } want && grams is { } got)
            {
                checkedAmounts++;
                var ratio = Math.Max(got / want, want / Math.Max(got, 0.1m));
                var right = ratio <= 1 + (expected.Tolerance ?? DefaultTolerance);
                rightAmounts += right ? 1 : 0;
                verdicts[index] = right ? "ok" : $"amount (want {want:0} g)";
            }
            else
            {
                verdicts[index] = expected.Optional ? "optional" : "ok";
            }
        }

        var extra = 0;
        var noMatch = 0;
        for (var i = 0; i < items.Count; i++)
        {
            if (used[i])
            {
                continue;
            }

            if (items[i].Food is null)
            {
                noMatch++;
                verdicts[i] = "no match";
            }
            else
            {
                extra++;
                verdicts[i] = "extra";
                kcal = Add(kcal, Kcal(items[i]));
            }
        }

        var itemOutcomes = items
            .Select((item, i) => new ItemOutcome(item.Phrase, item.Food?.Name, item.Amount, item.Unit, Grams(item), Kcal(item), verdicts[i] ?? ""))
            .ToList();
        return new CaseOutcome(
            id,
            run,
            required,
            found,
            checkedAmounts,
            rightAmounts,
            extra,
            noMatch,
            expectedKcal,
            kcal,
            usage.Calls,
            usage.InputTokens,
            usage.OutputTokens,
            milliseconds,
            failure,
            missing,
            itemOutcomes);
    }

    /// <summary>Null poisons the total: a case with any food that has no expected amount has no kcal score.</summary>
    private static decimal? Add(decimal? total, decimal? value) => total is { } a && value is { } b ? a + b : null;

    public static decimal? Grams(DescribedItem item) => item.Food is not { } food
        ? null
        : item.Unit switch
        {
            "g" or "ml" => item.Amount,
            "serving" => food.ServingQuantity * item.Amount,
            "piece" => food.PieceQuantity * item.Amount,
            _ => null,
        };

    public static decimal? Kcal(DescribedItem item) => item.Food is not { } food
        ? null
        : MealDescriber.Kcal(food, item.Amount, item.Unit, item.Unit is "g" or "ml" or "serving" or "piece" ? null : Grams(item));
}

/// <summary>The catalogue food each expected pattern stands for: the shortest name it matches.</summary>
sealed class References(Dictionary<string, Food?> foods)
{
    public static async Task<References> LoadAsync(AppDbContext db, IReadOnlyList<EvalCase> cases)
    {
        var foods = new Dictionary<string, Food?>();
        foreach (var match in cases.SelectMany(item => item.Answers).SelectMany(answer => answer).Select(item => item.Match).Distinct())
        {
            var food = await db.Foods.FromSqlRaw(
                    "SELECT * FROM foods WHERE retired_at IS NULL AND user_id IS NULL AND name ~* {0} ORDER BY length(name), name LIMIT 1",
                    match)
                .AsNoTracking()
                .FirstOrDefaultAsync();
            if (food is null)
            {
                Console.WriteLine($"  ! no catalogue food matches {match}");
            }

            foods[match] = food;
        }

        return new References(foods);
    }

    public decimal? Kcal(ExpectedFood expected) =>
        expected.Grams is { } grams && foods.GetValueOrDefault(expected.Match) is { } food && food.NutrientBasis == NutrientBases.Per100
            ? food.KcalPer100 * grams / 100
            : null;
}

static class Report
{
    public static string Line(CaseOutcome outcome)
    {
        var status = outcome.Failure is { } failure
            ? $"FAILED {failure}"
            : outcome.EmptyExpected
                ? outcome.Items.Count == 0 ? "ok (nothing, as expected)" : $"{outcome.Items.Count} foods where none were expected"
                : $"{outcome.Found}/{outcome.Required} found, amounts {outcome.AmountsRight}/{outcome.AmountsChecked}"
                  + (outcome.Extra > 0 ? $", {outcome.Extra} extra" : "")
                  + (outcome.KcalError is { } error ? $", kcal {outcome.Kcal:0} vs {outcome.ExpectedKcal:0} ({error:P0} off)" : "");
        var lines = new List<string> { $"- {outcome.Id}{(outcome.Run > 1 ? $" #{outcome.Run}" : "")}: {status}" };
        lines.AddRange(outcome.Items
            .Where(item => item.Verdict != "ok")
            .Select(item => $"    {item.Verdict}: \"{item.Phrase}\" → {item.Food ?? "nothing"} {item.Amount:0.##} {item.Unit}"));
        lines.AddRange(outcome.Missing.Select(match => $"    missing: {match}"));
        return string.Join(Environment.NewLine, lines);
    }

    public static string Summary(IReadOnlyList<CaseOutcome> outcomes)
    {
        var scored = outcomes.Where(item => !item.EmptyExpected).ToList();
        var empty = outcomes.Where(item => item.EmptyExpected).ToList();
        var errors = scored.Select(item => item.KcalError).OfType<decimal>().Order().ToList();
        int required = scored.Sum(item => item.Required), found = scored.Sum(item => item.Found);
        int amounts = scored.Sum(item => item.AmountsChecked), right = scored.Sum(item => item.AmountsRight);
        var lines = new List<string>
        {
            $"Foods found      {found}/{required} ({Share(found, required)})",
            $"Amounts right    {right}/{amounts} ({Share(right, amounts)}) within ±{Scoring.DefaultTolerance:P0} unless a case says otherwise",
            $"Extra rows       {scored.Sum(item => item.Extra)}, rows with no match {scored.Sum(item => item.NoMatch)}",
            errors.Count == 0
                ? "Kcal error       no case with every amount"
                : $"Kcal error       median {errors[errors.Count / 2]:P0}, mean {errors.Average():P0} over {errors.Count} case runs",
            $"Not food         {empty.Count(item => item.Items.Count == 0)}/{empty.Count} answered with nothing",
            $"Failed           {outcomes.Count(item => item.Failure is not null)}",
            $"Usage            {outcomes.Sum(item => item.Calls)} calls, {outcomes.Sum(item => item.InputTokens):N0} in, {outcomes.Sum(item => item.OutputTokens):N0} out, median {Median(outcomes.Select(item => item.Milliseconds))} ms a case",
        };
        return string.Join(Environment.NewLine, lines);
    }

    private static string Share(int part, int whole) => whole == 0 ? "-" : ((decimal)part / whole).ToString("P0", CultureInfo.InvariantCulture);

    private static long Median(IEnumerable<long> values)
    {
        var sorted = values.Order().ToList();
        return sorted.Count == 0 ? 0 : sorted[sorted.Count / 2];
    }
}

/// <summary>Passes the calls through and, with --verbose, prints what was split, searched and picked.</summary>
sealed class TraceModel(IMealModel inner, bool verbose) : IMealModel
{
    public string Name => inner.Name;

    public async Task<IReadOnlyList<MealPart>> SplitAsync(MealNote note, MealUsage usage, CancellationToken cancellationToken)
    {
        var parts = await inner.SplitAsync(note, usage, cancellationToken);
        if (verbose)
        {
            foreach (var part in parts)
            {
                Console.WriteLine($"  split \"{part.Phrase}\" {part.Name}, {part.Grams:0} g{(part.Guessed ? " (guessed)" : "")}: {string.Join(" | ", part.Searches)}");
            }
        }

        return parts;
    }

    public async Task<IReadOnlyList<MealPick>> PickAsync(string text, IReadOnlyList<MealChoice> choices, MealUsage usage, CancellationToken cancellationToken)
    {
        if (verbose)
        {
            foreach (var choice in choices)
            {
                Console.WriteLine($"  candidates for {choice.Part.Name}: {string.Join("; ", choice.Candidates.Select(candidate => candidate.Food.Name))}");
            }
        }

        var picks = await inner.PickAsync(text, choices, usage, cancellationToken);
        if (verbose)
        {
            foreach (var pick in picks)
            {
                Console.WriteLine($"  pick food {pick.Part + 1}: candidate {(pick.Candidate is { } number ? number + 1 : 0)}, {pick.Amount:0.##} {pick.Unit}");
            }
        }

        return picks;
    }
}

sealed record EvalArguments(string Cases, int Runs, HashSet<string> Only, string? Out, bool Verbose, string? Home)
{
    public static EvalArguments Parse(string[] args)
    {
        var cases = Path.Combine(AppContext.GetData("EntryPointFileDirectoryPath") as string ?? "tools/describe-eval", "cases.json");
        var runs = 1;
        var only = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        string? output = null;
        var verbose = false;
        string? home = null;
        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--cases": cases = args[++i]; break;
                case "--runs": runs = int.Parse(args[++i], CultureInfo.InvariantCulture); break;
                case "--only": only.UnionWith(args[++i].Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)); break;
                case "--out": output = args[++i]; break;
                case "--verbose" or "-v": verbose = true; break;
                case "--home": home = args[++i].ToUpperInvariant(); break;
                default: throw new ArgumentException($"Unknown argument {args[i]}");
            }
        }

        return new EvalArguments(cases, runs, only, output, verbose, home);
    }
}

static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };
}
