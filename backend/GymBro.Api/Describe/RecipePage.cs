using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using GymBro.Api.Logging;

namespace GymBro.Api.Describe;

/// <summary>
/// The recipe on a web page, from the schema.org data recipe sites publish for search engines
/// (<c>&lt;script type="application/ld+json"&gt;</c> with a <c>Recipe</c>): its name, how many it serves, and its
/// ingredient lines. Claude never reads the page; only these lines go on to be matched.
/// </summary>
public sealed record RecipePage(string Name, int? Portions, IReadOnlyList<string> Ingredients)
{
    /// <summary>A recipe has more lines than a meal has foods, but not more than this.</summary>
    public const int IngredientsMax = 40;

    public const int LineMax = 200;

    /// <summary>The first recipe on the page with at least one ingredient, or null.</summary>
    public static RecipePage? Read(string html)
    {
        foreach (Match block in Patterns.JsonLd().Matches(html))
        {
            JsonDocument document;
            try
            {
                document = JsonDocument.Parse(block.Groups["json"].Value, new JsonDocumentOptions
                {
                    AllowTrailingCommas = true,
                    CommentHandling = JsonCommentHandling.Skip,
                    MaxDepth = 64,
                });
            }
            catch (JsonException)
            {
                continue;
            }

            using (document)
            {
                if (Find(document.RootElement, 0) is { } recipe && FromJson(recipe) is { } page)
                {
                    return page;
                }
            }
        }

        return null;
    }

    private static JsonElement? Find(JsonElement element, int depth)
    {
        if (depth > 6)
        {
            return null;
        }

        if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                if (Find(item, depth + 1) is { } found)
                {
                    return found;
                }
            }

            return null;
        }

        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (IsRecipe(element))
        {
            return element;
        }

        foreach (var key in new[] { "@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item" })
        {
            if (element.TryGetProperty(key, out var inner) && Find(inner, depth + 1) is { } found)
            {
                return found;
            }
        }

        return null;
    }

    private static bool IsRecipe(JsonElement element) =>
        element.TryGetProperty("@type", out var type) && type.ValueKind switch
        {
            JsonValueKind.String => IsRecipeType(type.GetString()),
            JsonValueKind.Array => type.EnumerateArray().Any(item => item.ValueKind == JsonValueKind.String && IsRecipeType(item.GetString())),
            _ => false,
        };

    private static bool IsRecipeType(string? type) =>
        string.Equals(type, "Recipe", StringComparison.OrdinalIgnoreCase)
        || string.Equals(type, "schema:Recipe", StringComparison.OrdinalIgnoreCase)
        || string.Equals(type, "https://schema.org/Recipe", StringComparison.OrdinalIgnoreCase)
        || string.Equals(type, "http://schema.org/Recipe", StringComparison.OrdinalIgnoreCase);

    private static RecipePage? FromJson(JsonElement recipe)
    {
        var lines = new List<string>();
        foreach (var key in new[] { "recipeIngredient", "ingredients" })
        {
            if (!recipe.TryGetProperty(key, out var list))
            {
                continue;
            }

            var items = list.ValueKind == JsonValueKind.Array ? list.EnumerateArray().ToList() : [list];
            foreach (var item in items)
            {
                if (item.ValueKind == JsonValueKind.String && Clean(item.GetString(), LineMax) is { Length: > 0 } line)
                {
                    lines.Add(line);
                }
            }

            if (lines.Count > 0)
            {
                break;
            }
        }

        if (lines.Count == 0)
        {
            return null;
        }

        var name = recipe.TryGetProperty("name", out var named) && named.ValueKind == JsonValueKind.String
            ? Clean(named.GetString(), RecipeRules.NameMax)
            : "";
        var portions = recipe.TryGetProperty("recipeYield", out var yield) ? YieldPortions(yield) : null;
        return new RecipePage(name, portions, lines.Take(IngredientsMax).ToList());
    }

    /// <summary>"4", 4, "4 porsjoner", "4-6 servings", ["4", "4 portions"]: the first whole number from 1 to 100.</summary>
    public static int? YieldPortions(JsonElement yield)
    {
        switch (yield.ValueKind)
        {
            case JsonValueKind.Number:
                return yield.TryGetDecimal(out var number) ? InRange(number) : null;
            case JsonValueKind.String:
                var match = Patterns.FirstNumber().Match(yield.GetString() ?? "");
                return match.Success && decimal.TryParse(match.Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed) ? InRange(parsed) : null;
            case JsonValueKind.Array:
                foreach (var item in yield.EnumerateArray())
                {
                    if (YieldPortions(item) is { } found)
                    {
                        return found;
                    }
                }

                return null;
            default:
                return null;
        }
    }

    private static int? InRange(decimal value) => value is >= 1 and <= 100 && value == decimal.Truncate(value) ? (int)value : null;

    /// <summary>Entities decoded, tags dropped, spaces collapsed, cut to <paramref name="max"/>.</summary>
    public static string Clean(string? text, int max)
    {
        var plain = WebUtility.HtmlDecode(Patterns.Tag().Replace(WebUtility.HtmlDecode(text ?? ""), " "));
        var collapsed = LogEntryRules.Collapse(plain);
        return collapsed.Length <= max ? collapsed : collapsed[..max].TrimEnd();
    }
}

internal static partial class Patterns
{
    [GeneratedRegex(@"<script[^>]*type\s*=\s*[""']?application/ld\+json[""']?[^>]*>(?<json>.*?)</script>", RegexOptions.IgnoreCase | RegexOptions.Singleline, 2000)]
    public static partial Regex JsonLd();

    [GeneratedRegex(@"\d+(?:\.\d+)?", RegexOptions.None, 200)]
    public static partial Regex FirstNumber();

    [GeneratedRegex(@"<[^>]+>", RegexOptions.None, 200)]
    public static partial Regex Tag();
}
