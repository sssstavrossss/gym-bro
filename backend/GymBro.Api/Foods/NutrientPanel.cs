using System.Text.Json;
using GymBro.Api.Data;

namespace GymBro.Api.Foods;

public static class NutrientPanel
{
    public static void ApplyMatvare(Food food, IEnumerable<MatvareConstituent> rows, Action<string>? warn = null)
    {
        var list = rows.ToList();
        food.MonoFatPer100 = Take(list, "Enumet", "g");
        food.PolyFatPer100 = Take(list, "Flerum", "g");
        food.Omega3Per100 = Take(list, "Omega-3", "g");
        food.Omega6Per100 = Take(list, "Omega-6", "g");
        food.TransFatPer100 = Take(list, "Trans", "g");
        food.CholesterolPer100 = Take(list, "Kolest", "mg");
        food.AddedSugarsPer100 = Take(list, "Sukker", "g");
        food.SodiumPer100 = Take(list, "Na", "mg");
        // foods.json / nutrients.json: "Vit A" is "RAE", "Vit A RE" is "RE", "Vit E" is "mg-ATE".
        // Stored as published. RAE wins when both vitamin A figures are present.
        food.VitaminAPer100 = TakeVitaminA(list, warn);
        food.VitaminDPer100 = Take(list, "Vit D", "ug");
        food.VitaminEPer100 = TakeExact(list, "Vit E", "mg-ATE", "vitamin E", warn);
        food.ThiaminPer100 = Take(list, "Vit B1", "mg");
        food.RiboflavinPer100 = Take(list, "Vit B2", "mg");
        food.NiacinPer100 = Take(list, "NIAEQ", "mg") ?? Take(list, "Niacin", "mg");
        food.VitaminB6Per100 = Take(list, "Vit B6", "mg");
        food.FolatePer100 = Take(list, "Folat", "ug");
        food.VitaminB12Per100 = Take(list, "Vit B12", "ug");
        food.VitaminCPer100 = Take(list, "Vit C", "mg");
        food.CalciumPer100 = Take(list, "Ca", "mg");
        food.IronPer100 = Take(list, "Fe", "mg");
        food.ZincPer100 = Take(list, "Zn", "mg");
        food.MagnesiumPer100 = Take(list, "Mg", "mg");
        food.PotassiumPer100 = Take(list, "K", "mg");
        food.PhosphorusPer100 = Take(list, "P", "mg");
        food.SeleniumPer100 = Take(list, "Se", "ug");
        food.IodinePer100 = Take(list, "I", "ug");
    }

    public static void ApplyKassalapp(Food food, IEnumerable<KassalNutrient> rows)
    {
        foreach (var row in rows)
        {
            var code = (row.Code ?? "").Trim().ToLowerInvariant();
        if (code == "enumettet" || code == "enumettet_fett" || code == "enumettede_fettsyrer") food.MonoFatPer100 = Value(row.Unit, row.Amount, "g");
        if (code == "flerumettet" || code == "flerumettet_fett" || code == "flerumettede_fettsyrer") food.PolyFatPer100 = Value(row.Unit, row.Amount, "g");
        if (code == "transfett" || code == "trans_fat") food.TransFatPer100 = Value(row.Unit, row.Amount, "g");
        if (code == "kolesterol") food.CholesterolPer100 = Value(row.Unit, row.Amount, "mg");
        }
    }

    public static Dictionary<string, decimal?> ReadOff(JsonElement nutriments)
    {
        decimal? Read(string key) =>
            nutriments.TryGetProperty(key, out var raw) && raw.ValueKind == JsonValueKind.Number && raw.TryGetDecimal(out var value)
                ? NonNegative(value)
                : null;
        decimal? Raw(string key) =>
            nutriments.TryGetProperty(key, out var raw) && raw.ValueKind == JsonValueKind.Number && raw.TryGetDecimal(out var value) && value >= 0
                ? value
                : null;
        var food = new Food();
        ApplyOff(food, Read);
        if (Raw("sodium_100g") is decimal sodiumGrams)
        {
            food.SodiumPer100 = decimal.Round(sodiumGrams * 1000m, 2, MidpointRounding.AwayFromZero);
        }

        if (Raw("cholesterol_100g") is decimal cholesterolGrams)
        {
            food.CholesterolPer100 = decimal.Round(cholesterolGrams * 1000m, 2, MidpointRounding.AwayFromZero);
        }

        return Per100(food);
    }

    public static void ApplyDictionary(Food food, IReadOnlyDictionary<string, decimal?> panel)
    {
        food.MonoFatPer100 = Get(panel, "monoFat");
        food.PolyFatPer100 = Get(panel, "polyFat");
        food.Omega3Per100 = Get(panel, "omega3");
        food.Omega6Per100 = Get(panel, "omega6");
        food.TransFatPer100 = Get(panel, "transFat");
        food.CholesterolPer100 = Get(panel, "cholesterol");
        food.AddedSugarsPer100 = Get(panel, "addedSugars");
        food.SodiumPer100 = Get(panel, "sodium");
        food.VitaminAPer100 = Get(panel, "vitaminA");
        food.VitaminDPer100 = Get(panel, "vitaminD");
        food.VitaminEPer100 = Get(panel, "vitaminE");
        food.ThiaminPer100 = Get(panel, "thiamin");
        food.RiboflavinPer100 = Get(panel, "riboflavin");
        food.NiacinPer100 = Get(panel, "niacin");
        food.VitaminB6Per100 = Get(panel, "vitaminB6");
        food.FolatePer100 = Get(panel, "folate");
        food.VitaminB12Per100 = Get(panel, "vitaminB12");
        food.VitaminCPer100 = Get(panel, "vitaminC");
        food.CalciumPer100 = Get(panel, "calcium");
        food.IronPer100 = Get(panel, "iron");
        food.ZincPer100 = Get(panel, "zinc");
        food.MagnesiumPer100 = Get(panel, "magnesium");
        food.PotassiumPer100 = Get(panel, "potassium");
        food.PhosphorusPer100 = Get(panel, "phosphorus");
        food.SeleniumPer100 = Get(panel, "selenium");
        food.IodinePer100 = Get(panel, "iodine");
    }

    private static decimal? Get(IReadOnlyDictionary<string, decimal?> panel, string key) =>
        panel.TryGetValue(key, out var value) ? value : null;

    public static void ApplyOff(Food food, Func<string, decimal?> read)
    {
        food.MonoFatPer100 = NonNegative(read("monounsaturated-fat_100g"));
        food.PolyFatPer100 = NonNegative(read("polyunsaturated-fat_100g"));
        food.Omega3Per100 = NonNegative(read("omega-3-fat_100g"));
        food.Omega6Per100 = NonNegative(read("omega-6-fat_100g"));
        food.TransFatPer100 = NonNegative(read("trans-fat_100g"));
        food.CholesterolPer100 = NonNegative(read("cholesterol_100g"));
        food.AddedSugarsPer100 = NonNegative(read("added-sugars_100g"));
        food.SodiumPer100 = NonNegative(read("sodium_100g"));
        food.VitaminAPer100 = NonNegative(read("vitamin-a_100g"));
        food.VitaminDPer100 = NonNegative(read("vitamin-d_100g"));
        food.VitaminEPer100 = NonNegative(read("vitamin-e_100g"));
        food.ThiaminPer100 = NonNegative(read("vitamin-b1_100g"));
        food.RiboflavinPer100 = NonNegative(read("vitamin-b2_100g"));
        food.NiacinPer100 = NonNegative(read("vitamin-pp_100g"));
        food.VitaminB6Per100 = NonNegative(read("vitamin-b6_100g"));
        food.FolatePer100 = NonNegative(read("vitamin-b9_100g"));
        food.VitaminB12Per100 = NonNegative(read("vitamin-b12_100g"));
        food.VitaminCPer100 = NonNegative(read("vitamin-c_100g"));
        food.CalciumPer100 = NonNegative(read("calcium_100g"));
        food.IronPer100 = NonNegative(read("iron_100g"));
        food.ZincPer100 = NonNegative(read("zinc_100g"));
        food.MagnesiumPer100 = NonNegative(read("magnesium_100g"));
        food.PotassiumPer100 = NonNegative(read("potassium_100g"));
        food.PhosphorusPer100 = NonNegative(read("phosphorus_100g"));
        food.SeleniumPer100 = NonNegative(read("selenium_100g"));
        food.IodinePer100 = NonNegative(read("iodine_100g"));
    }

    public static void ScaleExisting(LogEntry entry, decimal factor)
    {
        entry.MonoFat = Micronutrients.Scale(entry.MonoFat, factor);
        entry.PolyFat = Micronutrients.Scale(entry.PolyFat, factor);
        entry.Omega3 = Micronutrients.Scale(entry.Omega3, factor);
        entry.Omega6 = Micronutrients.Scale(entry.Omega6, factor);
        entry.TransFat = Micronutrients.Scale(entry.TransFat, factor);
        entry.Cholesterol = Micronutrients.Scale(entry.Cholesterol, factor);
        entry.AddedSugars = Micronutrients.Scale(entry.AddedSugars, factor);
        entry.Sodium = Micronutrients.Scale(entry.Sodium, factor);
        entry.VitaminA = Micronutrients.Scale(entry.VitaminA, factor);
        entry.VitaminD = Micronutrients.Scale(entry.VitaminD, factor);
        entry.VitaminE = Micronutrients.Scale(entry.VitaminE, factor);
        entry.Thiamin = Micronutrients.Scale(entry.Thiamin, factor);
        entry.Riboflavin = Micronutrients.Scale(entry.Riboflavin, factor);
        entry.Niacin = Micronutrients.Scale(entry.Niacin, factor);
        entry.VitaminB6 = Micronutrients.Scale(entry.VitaminB6, factor);
        entry.Folate = Micronutrients.Scale(entry.Folate, factor);
        entry.VitaminB12 = Micronutrients.Scale(entry.VitaminB12, factor);
        entry.VitaminC = Micronutrients.Scale(entry.VitaminC, factor);
        entry.Calcium = Micronutrients.Scale(entry.Calcium, factor);
        entry.Iron = Micronutrients.Scale(entry.Iron, factor);
        entry.Zinc = Micronutrients.Scale(entry.Zinc, factor);
        entry.Magnesium = Micronutrients.Scale(entry.Magnesium, factor);
        entry.Potassium = Micronutrients.Scale(entry.Potassium, factor);
        entry.Phosphorus = Micronutrients.Scale(entry.Phosphorus, factor);
        entry.Selenium = Micronutrients.Scale(entry.Selenium, factor);
        entry.Iodine = Micronutrients.Scale(entry.Iodine, factor);
    }

    public static void ScaleOnto(LogEntry target, Food food, decimal factor)
    {
        target.MonoFat = Micronutrients.Scale(food.MonoFatPer100, factor);
        target.PolyFat = Micronutrients.Scale(food.PolyFatPer100, factor);
        target.Omega3 = Micronutrients.Scale(food.Omega3Per100, factor);
        target.Omega6 = Micronutrients.Scale(food.Omega6Per100, factor);
        target.TransFat = Micronutrients.Scale(food.TransFatPer100, factor);
        target.Cholesterol = Micronutrients.Scale(food.CholesterolPer100, factor);
        target.AddedSugars = Micronutrients.Scale(food.AddedSugarsPer100, factor);
        target.Sodium = Micronutrients.Scale(food.SodiumPer100, factor);
        target.VitaminA = Micronutrients.Scale(food.VitaminAPer100, factor);
        target.VitaminD = Micronutrients.Scale(food.VitaminDPer100, factor);
        target.VitaminE = Micronutrients.Scale(food.VitaminEPer100, factor);
        target.Thiamin = Micronutrients.Scale(food.ThiaminPer100, factor);
        target.Riboflavin = Micronutrients.Scale(food.RiboflavinPer100, factor);
        target.Niacin = Micronutrients.Scale(food.NiacinPer100, factor);
        target.VitaminB6 = Micronutrients.Scale(food.VitaminB6Per100, factor);
        target.Folate = Micronutrients.Scale(food.FolatePer100, factor);
        target.VitaminB12 = Micronutrients.Scale(food.VitaminB12Per100, factor);
        target.VitaminC = Micronutrients.Scale(food.VitaminCPer100, factor);
        target.Calcium = Micronutrients.Scale(food.CalciumPer100, factor);
        target.Iron = Micronutrients.Scale(food.IronPer100, factor);
        target.Zinc = Micronutrients.Scale(food.ZincPer100, factor);
        target.Magnesium = Micronutrients.Scale(food.MagnesiumPer100, factor);
        target.Potassium = Micronutrients.Scale(food.PotassiumPer100, factor);
        target.Phosphorus = Micronutrients.Scale(food.PhosphorusPer100, factor);
        target.Selenium = Micronutrients.Scale(food.SeleniumPer100, factor);
        target.Iodine = Micronutrients.Scale(food.IodinePer100, factor);
    }

    public static void ScaleOnto(RecipeIngredient target, Food food, decimal factor)
    {
        target.MonoFat = Micronutrients.Scale(food.MonoFatPer100, factor);
        target.PolyFat = Micronutrients.Scale(food.PolyFatPer100, factor);
        target.Omega3 = Micronutrients.Scale(food.Omega3Per100, factor);
        target.Omega6 = Micronutrients.Scale(food.Omega6Per100, factor);
        target.TransFat = Micronutrients.Scale(food.TransFatPer100, factor);
        target.Cholesterol = Micronutrients.Scale(food.CholesterolPer100, factor);
        target.AddedSugars = Micronutrients.Scale(food.AddedSugarsPer100, factor);
        target.Sodium = Micronutrients.Scale(food.SodiumPer100, factor);
        target.VitaminA = Micronutrients.Scale(food.VitaminAPer100, factor);
        target.VitaminD = Micronutrients.Scale(food.VitaminDPer100, factor);
        target.VitaminE = Micronutrients.Scale(food.VitaminEPer100, factor);
        target.Thiamin = Micronutrients.Scale(food.ThiaminPer100, factor);
        target.Riboflavin = Micronutrients.Scale(food.RiboflavinPer100, factor);
        target.Niacin = Micronutrients.Scale(food.NiacinPer100, factor);
        target.VitaminB6 = Micronutrients.Scale(food.VitaminB6Per100, factor);
        target.Folate = Micronutrients.Scale(food.FolatePer100, factor);
        target.VitaminB12 = Micronutrients.Scale(food.VitaminB12Per100, factor);
        target.VitaminC = Micronutrients.Scale(food.VitaminCPer100, factor);
        target.Calcium = Micronutrients.Scale(food.CalciumPer100, factor);
        target.Iron = Micronutrients.Scale(food.IronPer100, factor);
        target.Zinc = Micronutrients.Scale(food.ZincPer100, factor);
        target.Magnesium = Micronutrients.Scale(food.MagnesiumPer100, factor);
        target.Potassium = Micronutrients.Scale(food.PotassiumPer100, factor);
        target.Phosphorus = Micronutrients.Scale(food.PhosphorusPer100, factor);
        target.Selenium = Micronutrients.Scale(food.SeleniumPer100, factor);
        target.Iodine = Micronutrients.Scale(food.IodinePer100, factor);
    }

    public static void Copy(LogEntry target, LogEntry source)
    {
        target.MonoFat = source.MonoFat;
        target.PolyFat = source.PolyFat;
        target.Omega3 = source.Omega3;
        target.Omega6 = source.Omega6;
        target.TransFat = source.TransFat;
        target.Cholesterol = source.Cholesterol;
        target.AddedSugars = source.AddedSugars;
        target.Sodium = source.Sodium;
        target.VitaminA = source.VitaminA;
        target.VitaminD = source.VitaminD;
        target.VitaminE = source.VitaminE;
        target.Thiamin = source.Thiamin;
        target.Riboflavin = source.Riboflavin;
        target.Niacin = source.Niacin;
        target.VitaminB6 = source.VitaminB6;
        target.Folate = source.Folate;
        target.VitaminB12 = source.VitaminB12;
        target.VitaminC = source.VitaminC;
        target.Calcium = source.Calcium;
        target.Iron = source.Iron;
        target.Zinc = source.Zinc;
        target.Magnesium = source.Magnesium;
        target.Potassium = source.Potassium;
        target.Phosphorus = source.Phosphorus;
        target.Selenium = source.Selenium;
        target.Iodine = source.Iodine;
    }

    public static void Copy(EntryGroupItem target, LogEntry source)
    {
        target.MonoFat = source.MonoFat;
        target.PolyFat = source.PolyFat;
        target.Omega3 = source.Omega3;
        target.Omega6 = source.Omega6;
        target.TransFat = source.TransFat;
        target.Cholesterol = source.Cholesterol;
        target.AddedSugars = source.AddedSugars;
        target.Sodium = source.Sodium;
        target.VitaminA = source.VitaminA;
        target.VitaminD = source.VitaminD;
        target.VitaminE = source.VitaminE;
        target.Thiamin = source.Thiamin;
        target.Riboflavin = source.Riboflavin;
        target.Niacin = source.Niacin;
        target.VitaminB6 = source.VitaminB6;
        target.Folate = source.Folate;
        target.VitaminB12 = source.VitaminB12;
        target.VitaminC = source.VitaminC;
        target.Calcium = source.Calcium;
        target.Iron = source.Iron;
        target.Zinc = source.Zinc;
        target.Magnesium = source.Magnesium;
        target.Potassium = source.Potassium;
        target.Phosphorus = source.Phosphorus;
        target.Selenium = source.Selenium;
        target.Iodine = source.Iodine;
    }

    public static void Copy(LogEntry target, EntryGroupItem source)
    {
        target.MonoFat = source.MonoFat;
        target.PolyFat = source.PolyFat;
        target.Omega3 = source.Omega3;
        target.Omega6 = source.Omega6;
        target.TransFat = source.TransFat;
        target.Cholesterol = source.Cholesterol;
        target.AddedSugars = source.AddedSugars;
        target.Sodium = source.Sodium;
        target.VitaminA = source.VitaminA;
        target.VitaminD = source.VitaminD;
        target.VitaminE = source.VitaminE;
        target.Thiamin = source.Thiamin;
        target.Riboflavin = source.Riboflavin;
        target.Niacin = source.Niacin;
        target.VitaminB6 = source.VitaminB6;
        target.Folate = source.Folate;
        target.VitaminB12 = source.VitaminB12;
        target.VitaminC = source.VitaminC;
        target.Calcium = source.Calcium;
        target.Iron = source.Iron;
        target.Zinc = source.Zinc;
        target.Magnesium = source.Magnesium;
        target.Potassium = source.Potassium;
        target.Phosphorus = source.Phosphorus;
        target.Selenium = source.Selenium;
        target.Iodine = source.Iodine;
    }

    public static void Copy(RecipeIngredient target, RecipeIngredient source)
    {
        target.MonoFat = source.MonoFat;
        target.PolyFat = source.PolyFat;
        target.Omega3 = source.Omega3;
        target.Omega6 = source.Omega6;
        target.TransFat = source.TransFat;
        target.Cholesterol = source.Cholesterol;
        target.AddedSugars = source.AddedSugars;
        target.Sodium = source.Sodium;
        target.VitaminA = source.VitaminA;
        target.VitaminD = source.VitaminD;
        target.VitaminE = source.VitaminE;
        target.Thiamin = source.Thiamin;
        target.Riboflavin = source.Riboflavin;
        target.Niacin = source.Niacin;
        target.VitaminB6 = source.VitaminB6;
        target.Folate = source.Folate;
        target.VitaminB12 = source.VitaminB12;
        target.VitaminC = source.VitaminC;
        target.Calcium = source.Calcium;
        target.Iron = source.Iron;
        target.Zinc = source.Zinc;
        target.Magnesium = source.Magnesium;
        target.Potassium = source.Potassium;
        target.Phosphorus = source.Phosphorus;
        target.Selenium = source.Selenium;
        target.Iodine = source.Iodine;
    }

    public static void SumOnto(Recipe target, IEnumerable<RecipeIngredient> rows)
    {
        var list = rows.ToList();
        target.MonoFat = Micronutrients.CompleteSum(rows.Select(row => row.MonoFat));
        target.PolyFat = Micronutrients.CompleteSum(rows.Select(row => row.PolyFat));
        target.Omega3 = Micronutrients.CompleteSum(rows.Select(row => row.Omega3));
        target.Omega6 = Micronutrients.CompleteSum(rows.Select(row => row.Omega6));
        target.TransFat = Micronutrients.CompleteSum(rows.Select(row => row.TransFat));
        target.Cholesterol = Micronutrients.CompleteSum(rows.Select(row => row.Cholesterol));
        target.AddedSugars = Micronutrients.CompleteSum(rows.Select(row => row.AddedSugars));
        target.Sodium = Micronutrients.CompleteSum(rows.Select(row => row.Sodium));
        target.VitaminA = Micronutrients.CompleteSum(rows.Select(row => row.VitaminA));
        target.VitaminD = Micronutrients.CompleteSum(rows.Select(row => row.VitaminD));
        target.VitaminE = Micronutrients.CompleteSum(rows.Select(row => row.VitaminE));
        target.Thiamin = Micronutrients.CompleteSum(rows.Select(row => row.Thiamin));
        target.Riboflavin = Micronutrients.CompleteSum(rows.Select(row => row.Riboflavin));
        target.Niacin = Micronutrients.CompleteSum(rows.Select(row => row.Niacin));
        target.VitaminB6 = Micronutrients.CompleteSum(rows.Select(row => row.VitaminB6));
        target.Folate = Micronutrients.CompleteSum(rows.Select(row => row.Folate));
        target.VitaminB12 = Micronutrients.CompleteSum(rows.Select(row => row.VitaminB12));
        target.VitaminC = Micronutrients.CompleteSum(rows.Select(row => row.VitaminC));
        target.Calcium = Micronutrients.CompleteSum(rows.Select(row => row.Calcium));
        target.Iron = Micronutrients.CompleteSum(rows.Select(row => row.Iron));
        target.Zinc = Micronutrients.CompleteSum(rows.Select(row => row.Zinc));
        target.Magnesium = Micronutrients.CompleteSum(rows.Select(row => row.Magnesium));
        target.Potassium = Micronutrients.CompleteSum(rows.Select(row => row.Potassium));
        target.Phosphorus = Micronutrients.CompleteSum(rows.Select(row => row.Phosphorus));
        target.Selenium = Micronutrients.CompleteSum(rows.Select(row => row.Selenium));
        target.Iodine = Micronutrients.CompleteSum(rows.Select(row => row.Iodine));
    }

    public static Dictionary<string, decimal?> Day(IReadOnlyList<LogEntry> rows) => new()
    {
        ["monoFat"] = Micronutrients.CompleteSum(rows.Select(row => row.MonoFat)),
        ["polyFat"] = Micronutrients.CompleteSum(rows.Select(row => row.PolyFat)),
        ["omega3"] = Micronutrients.CompleteSum(rows.Select(row => row.Omega3)),
        ["omega6"] = Micronutrients.CompleteSum(rows.Select(row => row.Omega6)),
        ["transFat"] = Micronutrients.CompleteSum(rows.Select(row => row.TransFat)),
        ["cholesterol"] = Micronutrients.CompleteSum(rows.Select(row => row.Cholesterol)),
        ["addedSugars"] = Micronutrients.CompleteSum(rows.Select(row => row.AddedSugars)),
        ["sodium"] = Micronutrients.CompleteSum(rows.Select(row => row.Sodium)),
        ["vitaminA"] = Micronutrients.CompleteSum(rows.Select(row => row.VitaminA)),
        ["vitaminD"] = Micronutrients.CompleteSum(rows.Select(row => row.VitaminD)),
        ["vitaminE"] = Micronutrients.CompleteSum(rows.Select(row => row.VitaminE)),
        ["thiamin"] = Micronutrients.CompleteSum(rows.Select(row => row.Thiamin)),
        ["riboflavin"] = Micronutrients.CompleteSum(rows.Select(row => row.Riboflavin)),
        ["niacin"] = Micronutrients.CompleteSum(rows.Select(row => row.Niacin)),
        ["vitaminB6"] = Micronutrients.CompleteSum(rows.Select(row => row.VitaminB6)),
        ["folate"] = Micronutrients.CompleteSum(rows.Select(row => row.Folate)),
        ["vitaminB12"] = Micronutrients.CompleteSum(rows.Select(row => row.VitaminB12)),
        ["vitaminC"] = Micronutrients.CompleteSum(rows.Select(row => row.VitaminC)),
        ["calcium"] = Micronutrients.CompleteSum(rows.Select(row => row.Calcium)),
        ["iron"] = Micronutrients.CompleteSum(rows.Select(row => row.Iron)),
        ["zinc"] = Micronutrients.CompleteSum(rows.Select(row => row.Zinc)),
        ["magnesium"] = Micronutrients.CompleteSum(rows.Select(row => row.Magnesium)),
        ["potassium"] = Micronutrients.CompleteSum(rows.Select(row => row.Potassium)),
        ["phosphorus"] = Micronutrients.CompleteSum(rows.Select(row => row.Phosphorus)),
        ["selenium"] = Micronutrients.CompleteSum(rows.Select(row => row.Selenium)),
        ["iodine"] = Micronutrients.CompleteSum(rows.Select(row => row.Iodine))
    };

    public static Dictionary<string, decimal?> Amount(LogEntry row) => new()
    {
        ["monoFat"] = row.MonoFat,
        ["polyFat"] = row.PolyFat,
        ["omega3"] = row.Omega3,
        ["omega6"] = row.Omega6,
        ["transFat"] = row.TransFat,
        ["cholesterol"] = row.Cholesterol,
        ["addedSugars"] = row.AddedSugars,
        ["sodium"] = row.Sodium,
        ["vitaminA"] = row.VitaminA,
        ["vitaminD"] = row.VitaminD,
        ["vitaminE"] = row.VitaminE,
        ["thiamin"] = row.Thiamin,
        ["riboflavin"] = row.Riboflavin,
        ["niacin"] = row.Niacin,
        ["vitaminB6"] = row.VitaminB6,
        ["folate"] = row.Folate,
        ["vitaminB12"] = row.VitaminB12,
        ["vitaminC"] = row.VitaminC,
        ["calcium"] = row.Calcium,
        ["iron"] = row.Iron,
        ["zinc"] = row.Zinc,
        ["magnesium"] = row.Magnesium,
        ["potassium"] = row.Potassium,
        ["phosphorus"] = row.Phosphorus,
        ["selenium"] = row.Selenium,
        ["iodine"] = row.Iodine
    };

    public static Dictionary<string, decimal?> Per100(Food row) => new()
    {
        ["monoFat"] = row.MonoFatPer100,
        ["polyFat"] = row.PolyFatPer100,
        ["omega3"] = row.Omega3Per100,
        ["omega6"] = row.Omega6Per100,
        ["transFat"] = row.TransFatPer100,
        ["cholesterol"] = row.CholesterolPer100,
        ["addedSugars"] = row.AddedSugarsPer100,
        ["sodium"] = row.SodiumPer100,
        ["vitaminA"] = row.VitaminAPer100,
        ["vitaminD"] = row.VitaminDPer100,
        ["vitaminE"] = row.VitaminEPer100,
        ["thiamin"] = row.ThiaminPer100,
        ["riboflavin"] = row.RiboflavinPer100,
        ["niacin"] = row.NiacinPer100,
        ["vitaminB6"] = row.VitaminB6Per100,
        ["folate"] = row.FolatePer100,
        ["vitaminB12"] = row.VitaminB12Per100,
        ["vitaminC"] = row.VitaminCPer100,
        ["calcium"] = row.CalciumPer100,
        ["iron"] = row.IronPer100,
        ["zinc"] = row.ZincPer100,
        ["magnesium"] = row.MagnesiumPer100,
        ["potassium"] = row.PotassiumPer100,
        ["phosphorus"] = row.PhosphorusPer100,
        ["selenium"] = row.SeleniumPer100,
        ["iodine"] = row.IodinePer100
    };

    private static decimal? Take(IReadOnlyList<MatvareConstituent> rows, string id, string unit)
    {
        foreach (var row in rows)
        {
            if (!string.Equals(row.NutrientId?.Trim(), id, StringComparison.Ordinal))
            {
                continue;
            }

            return Value(row.Unit, row.Quantity, unit);
        }

        return null;
    }

    private static decimal? TakeVitaminA(IReadOnlyList<MatvareConstituent> rows, Action<string>? warn)
    {
        decimal? rae = null;
        decimal? re = null;
        foreach (var row in rows)
        {
            var id = row.NutrientId?.Trim();
            if (id == "Vit A")
            {
                rae ??= Accepted(row, "RAE", "vitamin A", warn);
            }
            else if (id == "Vit A RE")
            {
                re ??= Accepted(row, "RE", "vitamin A", warn);
            }
        }

        return rae ?? re;
    }

    private static decimal? TakeExact(
        IReadOnlyList<MatvareConstituent> rows,
        string id,
        string unit,
        string nutrient,
        Action<string>? warn)
    {
        decimal? found = null;
        foreach (var row in rows)
        {
            if (!string.Equals(row.NutrientId?.Trim(), id, StringComparison.Ordinal))
            {
                continue;
            }

            found ??= Accepted(row, unit, nutrient, warn);
        }

        return found;
    }

    private static decimal? Accepted(MatvareConstituent row, string expected, string nutrient, Action<string>? warn)
    {
        var unit = (row.Unit ?? "").Trim();
        if (unit.Length > 0 && !string.Equals(unit, expected, StringComparison.Ordinal))
        {
            warn?.Invoke($"{nutrient} unit '{unit}' was not accepted.");
            return null;
        }

        if (unit.Length == 0 || row.Quantity is not decimal value || value < 0)
        {
            return null;
        }

        return decimal.Round(value, 2, MidpointRounding.AwayFromZero);
    }

    private static decimal? Value(string? unit, decimal? quantity, string expected)
    {
        if (quantity is not decimal value || value < 0)
        {
            return null;
        }

        if (!UnitMatches(unit, expected))
        {
            return null;
        }

        return decimal.Round(value, 2, MidpointRounding.AwayFromZero);
    }

    private static bool UnitMatches(string? unit, string expected)
    {
        var text = (unit ?? "").Trim().ToLowerInvariant();
        if (text.Length == 0)
        {
            return expected == "g";
        }

        if (expected == "g")
        {
            return text == "g";
        }

        if (expected == "mg")
        {
            return text == "mg";
        }

        return text is "µg" or "ug" or "mcg" or "μg";
    }

    private static decimal? NonNegative(decimal? value) =>
        value is decimal known && known >= 0 ? decimal.Round(known, 2, MidpointRounding.AwayFromZero) : null;
}
