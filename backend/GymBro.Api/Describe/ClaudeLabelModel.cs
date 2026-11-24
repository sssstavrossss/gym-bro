using System.Text.Json;
using Anthropic.Models.Messages;

namespace GymBro.Api.Describe;

/// <summary><see cref="ILabelModel"/> on the Claude API: one call with the photo and a schema for the table.</summary>
public sealed class ClaudeLabelModel(ClaudeAsk claude) : ILabelModel
{
    public string Name => claude.Model;

    private const string System = """
        You read the nutrition table on a photo of a food's packaging and copy what it says, so someone
        can save the food in a calorie tracker. Labels may be in Norwegian, Swedish, Danish, Finnish,
        German, English or another language ("Næringsinnhold", "Näringsvärde", "Ravintosisältö",
        "Nährwerte", "Nutrition facts").

        - table: true only when a nutrition table (or a nutrition panel) can be read in the photo.
          False for a photo of a meal, a barcode alone, or a table too blurred to read.
        - name: the product's name as printed on the pack, in its own language ("Grovt knekkebrød").
          Leave it empty when the photo doesn't show it. Don't make one up from the ingredients.
        - brand: the brand or maker, when it shows. Otherwise empty.
        - perServing: false when you copy the per 100 g or per 100 ml column. Copy that column whenever the
          label has it. True only when the label gives values for a serving and nothing per 100 g or 100 ml.
        - servingName and servingGrams: a serving the label names, with its weight in grams (millilitres
          for a drink): "slice" and 13 for "1 skive (13 g)", "portion" and 40 for "pr. porsjon (40 g)". Name
          it in short English ("slice", "portion", "bar", "glass", "piece"). Empty and null when the label
          names no serving or gives it no weight.
        - kcal and kj: the energy in the column you copied, each as printed. "1550 kJ / 370 kcal" is kj 1550
          and kcal 370. Null for one the label doesn't print.
        - protein, fat, carbs (carbohydrate, "karbohydrat", "kolhydrat", "hiilihydraatit"), saturatedFat
          ("hvorav mettede fettsyrer", "varav mättat fett"), sugars ("hvorav sukkerarter", "varav sockerarter"),
          fiber ("kostfiber") and salt: grams in the column you copied, as printed. A US label's
          "Total Carbohydrate" includes fibre: copy it as printed. When a label gives sodium and no salt,
          give salt as sodium × 2.5. Null for one the label doesn't show.
        A decimal comma is a decimal point: "6,5 g" is 6.5. "<0,5 g" or "spor" (trace) is 0.
        Copy the numbers; don't correct or estimate them.
        """;

    public async Task<LabelReading> ReadAsync(MealPhoto photo, MealUsage usage, CancellationToken cancellationToken)
    {
        List<ContentBlockParam> content = [ClaudeAsk.Image(photo), new TextBlockParam { Text = "Read this label." }];
        var json = await claude.AskAsync(System, content, Schema, 1024, usage, cancellationToken);
        return Read(json);
    }

    public static LabelReading Read(JsonElement json) => new(
        json.GetProperty("table").GetBoolean(),
        json.GetProperty("name").GetString() ?? "",
        json.GetProperty("brand").GetString() ?? "",
        json.GetProperty("perServing").GetBoolean(),
        json.GetProperty("servingName").GetString() ?? "",
        Number(json, "servingGrams"),
        Number(json, "kcal"),
        Number(json, "kj"),
        Number(json, "protein"),
        Number(json, "fat"),
        Number(json, "carbs"),
        Number(json, "saturatedFat"),
        Number(json, "sugars"),
        Number(json, "fiber"),
        Number(json, "salt"));

    private static decimal? Number(JsonElement json, string name) =>
        json.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number ? value.GetDecimal() : null;

    private static readonly Dictionary<string, JsonElement> Schema = ClaudeAsk.Schema("""
        {
          "type": "object",
          "properties": {
            "table": { "type": "boolean" },
            "name": { "type": "string" },
            "brand": { "type": "string" },
            "perServing": { "type": "boolean" },
            "servingName": { "type": "string" },
            "servingGrams": { "type": ["number", "null"] },
            "kcal": { "type": ["number", "null"] },
            "kj": { "type": ["number", "null"] },
            "protein": { "type": ["number", "null"] },
            "fat": { "type": ["number", "null"] },
            "carbs": { "type": ["number", "null"] },
            "saturatedFat": { "type": ["number", "null"] },
            "sugars": { "type": ["number", "null"] },
            "fiber": { "type": ["number", "null"] },
            "salt": { "type": ["number", "null"] }
          },
          "required": ["table", "name", "brand", "perServing", "servingName", "servingGrams", "kcal", "kj", "protein", "fat", "carbs", "saturatedFat", "sugars", "fiber", "salt"],
          "additionalProperties": false
        }
        """);
}
