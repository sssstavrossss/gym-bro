using System.Globalization;
using System.Text;
using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;
using Microsoft.Extensions.Options;

namespace GymBro.Api.Describe;

/// <summary>
/// <see cref="IMealModel"/> on the Claude API. Both questions use structured output, so the reply is JSON that
/// matches a schema. Effort is low: these are short lookups, not reasoning tasks.
/// </summary>
public sealed class ClaudeMealModel(IOptions<DescribeOptions> options, ILogger<ClaudeMealModel> logger) : IMealModel
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);

    // Made on first use, so a server without a key never builds a client.
    private readonly Lazy<AnthropicClient> client = new(() => new AnthropicClient { ApiKey = options.Value.ApiKey });

    private const string SplitSystem = """
        You read a short note of what someone ate or drank and list each food in it.
        The foods are looked up in Matvaretabellen, the Norwegian food composition table, which has Norwegian
        names ("Egg, kokt", "Brød, grovt", "Smør", "Lettmelk") and English names, and in the person's own foods.

        For each food give:
        - phrase: the words from the note that name it, with its amount, copied as written.
        - name: a short plain English name, as it was eaten ("boiled egg", "wholemeal bread").
        - searches: one to three short catalogue searches, one or two words each, best first. Give the
          Norwegian word as well as the English one when you know it ("egg", "brød", "melk").
        - grams: your best estimate of the grams (millilitres for drinks) in the amount described.
          When the note gives no amount, use a usual single portion.
        - guessed: true when the note gives no amount for it.

        Split a food into the parts someone would log separately: "toast with butter" is bread and butter,
        "coffee with milk" is coffee and milk. Keep a dish whole when it is one dish (lasagne, pizza, a burrito).
        Keep the note's order. If the note is not about food or drink, return an empty list.
        """;

    private const string PickSystem = """
        You match foods from a note of what someone ate to foods found in their food catalogue.
        Each food from the note comes with numbered candidates and the units each candidate can be logged in.

        For each food from the note:
        - candidate: the number of the candidate that is the same food, prepared the same way (cooked or raw,
          whole or skimmed). Prefer one marked "yours" when it fits. Use 0 when no candidate is that food;
          a near miss is worse than none.
        - unit: one of the units listed for that candidate, written exactly as listed.
        - amount: how many of that unit the note describes. Use a counted unit for counted things
          ("2 eggs" is 2 of a piece unit when there is one), otherwise grams or millilitres.
          When the note gives no amount, use a usual single portion.
        Return one entry per food from the note, in the same order.
        """;

    public async Task<IReadOnlyList<MealPart>> SplitAsync(string text, CancellationToken cancellationToken)
    {
        var json = await AskAsync(SplitSystem, text, SplitSchema, 2048, cancellationToken);
        var parts = new List<MealPart>();
        foreach (var food in json.GetProperty("foods").EnumerateArray())
        {
            var searches = food.GetProperty("searches").EnumerateArray()
                .Select(search => search.GetString() ?? "")
                .ToList();
            parts.Add(new MealPart(
                food.GetProperty("phrase").GetString() ?? "",
                food.GetProperty("name").GetString() ?? "",
                searches,
                food.GetProperty("grams").GetDecimal(),
                food.GetProperty("guessed").GetBoolean()));
        }

        return parts;
    }

    public async Task<IReadOnlyList<MealPick>> PickAsync(
        string text,
        IReadOnlyList<MealChoice> choices,
        CancellationToken cancellationToken)
    {
        var json = await AskAsync(PickSystem, PickPrompt(text, choices), PickSchema, 2048, cancellationToken);
        var picks = new List<MealPick>();
        foreach (var (pick, index) in json.GetProperty("picks").EnumerateArray().Select((pick, index) => (pick, index)))
        {
            var number = pick.GetProperty("candidate").GetInt32();
            picks.Add(new MealPick(
                index,
                number >= 1 ? number - 1 : null,
                pick.GetProperty("amount").GetDecimal(),
                pick.GetProperty("unit").GetString() ?? ""));
        }

        return picks;
    }

    /// <summary>The note, then each food with its numbered candidates and their units.</summary>
    public static string PickPrompt(string text, IReadOnlyList<MealChoice> choices)
    {
        var prompt = new StringBuilder();
        prompt.Append("Note: ").AppendLine(text).AppendLine();
        foreach (var (choice, index) in choices.Select((choice, index) => (choice, index)))
        {
            var part = choice.Part;
            prompt.Append(CultureInfo.InvariantCulture, $"Food {index + 1}: \"{part.Phrase}\" ({part.Name}, about {part.Grams:0.#} g");
            prompt.AppendLine(part.Guessed ? ", no amount given)" : ")");
            if (choice.Candidates.Count == 0)
            {
                prompt.AppendLine("  No candidates.");
            }

            foreach (var (candidate, number) in choice.Candidates.Select((candidate, number) => (candidate, number + 1)))
            {
                var units = string.Join("; ", candidate.Units.Select(UnitText));
                var mine = candidate.Mine ? " (yours)" : "";
                prompt.Append(CultureInfo.InvariantCulture, $"  {number}. {CandidateName(candidate)}{mine}. Units: {units}");
                prompt.AppendLine();
            }

            prompt.AppendLine();
        }

        return prompt.ToString();
    }

    private static string CandidateName(MealCandidate candidate)
    {
        var food = candidate.Food;
        var name = string.IsNullOrWhiteSpace(food.Brand) ? food.Name : $"{food.Name}, {food.Brand}";
        return string.IsNullOrWhiteSpace(food.NameEn) || food.NameEn == food.Name ? name : $"{name} / {food.NameEn}";
    }

    private static string UnitText(MealUnit unit) => unit.Grams is { } grams
        ? string.Create(CultureInfo.InvariantCulture, $"{unit.Unit} (1 {unit.Label} = {grams:0.#} g)")
        : unit.Unit;

    private async Task<JsonElement> AskAsync(
        string system,
        string user,
        Dictionary<string, JsonElement> schema,
        int maxTokens,
        CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Timeout);
        Message response;
        try
        {
            response = await client.Value.Messages.Create(
                new MessageCreateParams
                {
                    Model = options.Value.Model,
                    MaxTokens = maxTokens,
                    System = system,
                    Messages = [new UserMessageParam { Content = user }],
                    OutputConfig = new OutputConfig
                    {
                        Effort = Effort.Low,
                        Format = new JsonOutputFormat { Schema = schema },
                    },
                },
                timeout.Token);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Claude call for Describe failed");
            throw new MealModelException("Claude didn't answer.", inner: ex);
        }

        if (response.StopReason == "refusal")
        {
            throw new MealModelException("Claude declined.", refused: true);
        }

        var text = string.Concat(response.Content.Select(block => block.Value).OfType<TextBlock>().Select(block => block.Text));
        try
        {
            using var document = JsonDocument.Parse(text);
            return document.RootElement.Clone();
        }
        catch (JsonException ex)
        {
            // A reply cut off at max tokens is not valid JSON.
            logger.LogWarning("Describe reply was not JSON (stop reason {StopReason})", response.StopReason);
            throw new MealModelException("Claude's answer was cut off.", inner: ex);
        }
    }

    private static readonly Dictionary<string, JsonElement> SplitSchema = Schema("""
        {
          "type": "object",
          "properties": {
            "foods": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "phrase": { "type": "string" },
                  "name": { "type": "string" },
                  "searches": { "type": "array", "items": { "type": "string" } },
                  "grams": { "type": "number" },
                  "guessed": { "type": "boolean" }
                },
                "required": ["phrase", "name", "searches", "grams", "guessed"],
                "additionalProperties": false
              }
            }
          },
          "required": ["foods"],
          "additionalProperties": false
        }
        """);

    private static readonly Dictionary<string, JsonElement> PickSchema = Schema("""
        {
          "type": "object",
          "properties": {
            "picks": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "candidate": { "type": "integer" },
                  "unit": { "type": "string" },
                  "amount": { "type": "number" }
                },
                "required": ["candidate", "unit", "amount"],
                "additionalProperties": false
              }
            }
          },
          "required": ["picks"],
          "additionalProperties": false
        }
        """);

    private static Dictionary<string, JsonElement> Schema(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.EnumerateObject().ToDictionary(property => property.Name, property => property.Value.Clone());
    }
}
