using System.Globalization;
using System.Text;
using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;
using Microsoft.Extensions.Options;

namespace GymBro.Api.Describe;

/// <summary>
/// <see cref="IMealModel"/> on the Claude API. Both questions use structured output, so the reply is JSON that
/// matches a schema. Effort is low: these are short lookups, not reasoning tasks. A photo goes only to the
/// split, as an image block before the words.
/// </summary>
public sealed class ClaudeMealModel(IOptions<DescribeOptions> options, ILogger<ClaudeMealModel> logger) : IMealModel
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);

    // Made on first use, so a server without a key never builds a client.
    private readonly Lazy<AnthropicClient> client = new(() => new AnthropicClient { ApiKey = options.Value.ApiKey });

    public string Name => options.Value.Model;

    private const string SplitSystem = """
        You read a note of what someone ate or drank and list each food in it. The note is their words,
        a photo of the meal, or both. It may say the local time it was written, a hint for what the meal
        was and how big (a bowl at breakfast is smaller than a plate at dinner); it may have been eaten earlier.
        The foods are looked up in Matvaretabellen, the Norwegian food composition table, which has Norwegian
        names ("Egg, kokt", "Brød, grovt", "Smør", "Lettmelk") and English names, and in the person's own foods.

        For each food give:
        - phrase: the words from the note that name it, with its amount, copied as written. For a food
          from a photo, a few words for what you see, with the amount ("2 fried eggs", "rice, about a cup").
        - name: a short plain English name, as it was eaten ("boiled egg", "wholemeal bread"). Translate
          Norwegian with care: gulost is yellow cheese and brunost brown cheese.
        - searches: one to three short catalogue searches, one or two words each, best first, Norwegian
          before English. When the note names the food in Norwegian, its own word comes first ("bolle",
          "skolebolle", "brunost"). Every word of a search must appear in the food's name, so name the everyday form
          the way the table does, with how it is usually eaten: "ris kokt" for rice, "brød grovt" or "loff"
          for bread or toast, "egg kokt", "lettmelk", "kaffe traktet", "havregryn". For a particular kind
          of a food, search the kind first ("sausage cocktail" or "sosisser" for cocktail sausages), then
          the plain food. For a dish, make the first search its usual name or the dish with its main
          filling ("pasta bolognese", "taco kjøttdeig", "pizza pepperoni"), then the dish alone. For a
          bread or bun, search its kind ("pølsebrød", "hamburgerbrød", "lompe", "rundstykke",
          "knekkebrød"; "bolle" is a sweet bun).
          When a package, label or brand shows in the photo or is named, make the first search the brand
          and product ("Grandiosa", "Tine lettmelk").
        - grams: your best estimate of the grams (millilitres for drinks) in the amount described.
          When the note gives no amount, use a usual single portion.
        - guessed: true when the note gives no amount for it. An amount judged from a photo is a guess.
        - added: true only for a food the note doesn't name that you add yourself (the cooking fat below).

        Split a food into the parts someone would log separately: "toast with butter" is bread and butter,
        "coffee with milk" is coffee and milk, "a ham and cheese sandwich" is two slices of bread, ham and
        cheese, "a tuna sandwich" is bread and tuna, "a hot dog" is a sausage and its bun. Keep a dish whole
        when it is one dish (lasagne, pizza, a burrito, a curry), and keep whole a drink made with milk
        (a latte, a cappuccino, hot chocolate) and a dish cooked with it (porridge made with milk).
        When the words or the photo say a food was fried, sautéed or stir-fried and the fat isn't named,
        add the cooking fat as its own food: phrase "oil for frying", about a tablespoon a portion, guessed
        and added.
        Keep the note's order. If the note is not about food or drink, return an empty list.

        A photo shows the meal itself. List each food and drink in it that someone would log, and judge
        each amount from the plate, bowl, glass, cutlery or packaging around it. Words sent with a photo
        come first: they can name foods, amounts or cooking the photo can't show ("fried in butter",
        "I ate half"), and they say which part is theirs when the photo shows more. Don't list the plate,
        cutlery, garnish, or anything you can't tell is food. If a photo shows no food or drink and the
        words name none, return an empty list.
        """;

    private const string PickSystem = """
        You match foods from a note of what someone ate to foods found in their food catalogue.
        Each food from the note comes with numbered candidates and the units each candidate can be logged in.

        For each food from the note:
        - food: its number, as in "Food 2".
        - candidate: the number of the candidate closest to what the note describes. The person checks the
          list and can change it, so pick the best fit even when the note is vaguer than the catalogue:
          for plain "rice" pick plain cooked rice over a variety, for "bread" or "toast" an everyday
          bought bread, for "milk" the unspecified or most common milk. When the note doesn't say, prefer
          the food as usually eaten (cooked rice and pasta, not dry), unspecified over a brand, and bought
          over home-made, and for a plain word like "salad" or "cheese" the plainest food of that kind.
          Prefer one marked "yours" when it fits. The note's own words count over the plain name when they
          differ. Use 0 when no candidate is that kind of food (a rice drink is not rice, a cream for coffee
          is not coffee), or when there is only the raw or dry form of a food eaten cooked (oats for
          porridge). Use 0 for a cooking fat when the food cooked in it was matched to one already fried
          in fat ("stekt i fett"). When the note lists a dish's parts as separate foods (shells, mince and
          cheese for tacos), pick each plain part, not a whole dish that already holds the others.
        - unit: one of the units listed for that candidate, written exactly as listed.
        - amount: how many of that unit the note describes. Use a counted unit for counted things
          ("2 eggs" is 2 of a piece unit when there is one), otherwise grams or millilitres. A measure the
          note names is the unit of that name: "3 slices" of cheese is 3 of slice, not of the amount for a
          slice of bread; "2 tbsp" is 2 of tablespoon; "a large glass" is 1 of glass (large). When that
          many of the unit would weigh far from the food's grams (small sausages and a grill sausage's
          piece), use grams instead.
          When the note gives no amount, use a usual single portion.
        - retry: when the candidate is 0 because nothing fits, one to three other short catalogue searches
          to try, in the table's own words, Norwegian first ("havregrøt" for oatmeal, "wokblanding" for
          stir-fry vegetables, "cola kunstig søtet" for a diet cola). Otherwise an empty list.
        Return one entry for every food from the note, in the same order.
        """;

    public async Task<IReadOnlyList<MealPart>> SplitAsync(MealNote note, MealUsage usage, CancellationToken cancellationToken)
    {
        var json = await AskAsync(SplitSystem, SplitContent(note), SplitSchema, 2048, usage, cancellationToken);
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
                food.GetProperty("guessed").GetBoolean(),
                food.TryGetProperty("added", out var added) && added.ValueKind == JsonValueKind.True));
        }

        return parts;
    }

    public async Task<IReadOnlyList<MealPick>> PickAsync(
        string text,
        IReadOnlyList<MealChoice> choices,
        MealUsage usage,
        CancellationToken cancellationToken)
    {
        var json = await AskAsync(PickSystem, PickPrompt(text, choices), PickSchema, 2048, usage, cancellationToken);
        return ReadPicks(json);
    }

    /// <summary>
    /// The picks from the reply. Each entry names its food, so a skipped or repeated one can't shift the
    /// rest onto the wrong food. Candidate numbers start at 1, and 0 means none fits.
    /// </summary>
    public static IReadOnlyList<MealPick> ReadPicks(JsonElement json) =>
        json.GetProperty("picks").EnumerateArray().Select(ReadPick).ToList();

    private static MealPick ReadPick(JsonElement pick)
    {
        var candidate = pick.GetProperty("candidate").GetInt32();
        var retry = pick.TryGetProperty("retry", out var searches) && searches.ValueKind == JsonValueKind.Array
            ? searches.EnumerateArray().Select(search => search.GetString() ?? "").Where(search => search.Trim().Length > 0).ToList()
            : [];
        return new MealPick(
            pick.GetProperty("food").GetInt32() - 1,
            candidate >= 1 ? candidate - 1 : null,
            pick.GetProperty("amount").GetDecimal(),
            pick.GetProperty("unit").GetString() ?? "",
            retry);
    }

    /// <summary>
    /// The words alone, or the photo first and then the words (or a line saying there are none). The time it
    /// was written, when sent, comes before the words.
    /// </summary>
    public static MessageContentParam SplitContent(MealNote note)
    {
        var written = note.Time is { } time ? $"Written at {time.ToString("HH:mm", CultureInfo.InvariantCulture)}. " : "";
        if (note.Photo is not { } photo)
        {
            return written.Length == 0 ? note.Text : $"{written}Note: {note.Text}";
        }

        List<ContentBlockParam> blocks =
        [
            new ImageBlockParam
            {
                Source = new Base64ImageSource { Data = Convert.ToBase64String(photo.Data), MediaType = photo.MediaType },
            },
            new TextBlockParam { Text = written + (note.Text.Length > 0 ? $"Words with the photo: {note.Text}" : "No words, only the photo.") },
        ];
        return blocks;
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
        MessageContentParam user,
        Dictionary<string, JsonElement> schema,
        int maxTokens,
        MealUsage usage,
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

        usage.Add(response.Usage.InputTokens, response.Usage.OutputTokens);
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
                  "guessed": { "type": "boolean" },
                  "added": { "type": "boolean" }
                },
                "required": ["phrase", "name", "searches", "grams", "guessed", "added"],
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
                  "food": { "type": "integer" },
                  "candidate": { "type": "integer" },
                  "unit": { "type": "string" },
                  "amount": { "type": "number" },
                  "retry": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["food", "candidate", "unit", "amount", "retry"],
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
