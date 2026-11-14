using System.Globalization;
using GymBro.Api.Data;

namespace GymBro.Api.Foods;

/// <summary>
/// Saturated fat, total sugars, fibre, and salt, in grams.
/// A missing source value stays null. A published zero stays zero.
/// Sodium is never turned into salt, and salt is never turned into sodium.
/// </summary>
public readonly record struct Micronutrients(decimal? SaturatedFat, decimal? Sugars, decimal? Fiber, decimal? Salt)
{
    public static Micronutrients Empty { get; } = new(null, null, null, null);

    public bool Any => SaturatedFat is not null || Sugars is not null || Fiber is not null || Salt is not null;

    public static Micronutrients FromMatvare(IEnumerable<MatvareConstituent> rows)
    {
        decimal? saturated = null;
        decimal? sugars = null;
        decimal? fiber = null;
        decimal? salt = null;
        foreach (var row in rows)
        {
            var id = row.NutrientId?.Trim();
            if (id is null)
            {
                continue;
            }

            if (id == "Mettet")
            {
                saturated = Grams(row.Unit, row.Quantity);
            }
            else if (id == "Mono+Di")
            {
                sugars = Grams(row.Unit, row.Quantity);
            }
            else if (id == "Fiber")
            {
                fiber = Grams(row.Unit, row.Quantity);
            }
            else if (id == "NaCl")
            {
                salt = Grams(row.Unit, row.Quantity);
            }
        }

        return new Micronutrients(saturated, sugars, fiber, salt);
    }

    public static Micronutrients FromKassalapp(IEnumerable<KassalNutrient> rows)
    {
        decimal? saturated = null;
        decimal? sugars = null;
        decimal? fiber = null;
        decimal? salt = null;
        foreach (var row in rows)
        {
            var code = (row.Code ?? "").Trim().ToLowerInvariant();
            var grams = Grams(row.Unit, row.Amount);
            if (code is "mettede_fettsyrer" or "mettede" or "mettet_fett" or "fett_mettede" or "saturated_fat")
            {
                saturated = grams;
            }
            else if (code is "sukkerarter" or "sugars")
            {
                sugars = grams;
            }
            else if (code is "kostfiber" or "fiber" or "fibre")
            {
                fiber = grams;
            }
            else if (code == "salt")
            {
                salt = grams;
            }
        }

        return new Micronutrients(saturated, sugars, fiber, salt);
    }

    /// <summary>Null when the unit is not grams or the number is missing. Does not convert mg or sodium.</summary>
    public static decimal? Grams(string? unit, decimal? quantity)
    {
        if (quantity is not decimal value || value < 0)
        {
            return null;
        }

        if (!string.IsNullOrWhiteSpace(unit) && !string.Equals(unit.Trim(), "g", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return decimal.Round(value, 2, MidpointRounding.AwayFromZero);
    }

    public static decimal? Scale(decimal? per, decimal factor)
    {
        if (per is not decimal value)
        {
            return null;
        }

        return decimal.Round(value * factor, 2, MidpointRounding.AwayFromZero);
    }

    public Micronutrients Scaled(decimal factor) =>
        new(Scale(SaturatedFat, factor), Scale(Sugars, factor), Scale(Fiber, factor), Scale(Salt, factor));

    /// <summary>
    /// Sum when every value is present, including a published zero.
    /// Null when the list is empty or any value is unknown.
    /// </summary>
    public static decimal? CompleteSum(IEnumerable<decimal?> values)
    {
        decimal sum = 0;
        var any = false;
        foreach (var value in values)
        {
            if (value is not decimal known)
            {
                return null;
            }

            any = true;
            sum += known;
        }

        return any ? decimal.Round(sum, 2, MidpointRounding.AwayFromZero) : null;
    }

    public static decimal? Percent(int known, int total)
    {
        if (total <= 0)
        {
            return null;
        }

        return decimal.Round(known * 100m / total, 1, MidpointRounding.AwayFromZero);
    }

    public static string CoverageLine(string label, int total, int saturated, int sugars, int fiber, int salt)
    {
        return string.Create(
            CultureInfo.InvariantCulture,
            $"{label}: {total} foods, saturated fat {Format(Percent(saturated, total))} ({saturated}), sugars {Format(Percent(sugars, total))} ({sugars}), fiber {Format(Percent(fiber, total))} ({fiber}), salt {Format(Percent(salt, total))} ({salt}).");
    }

    public static string PanelCoverage(IReadOnlyList<Food> foods)
    {
        string Part(string name, Func<Food, decimal?> pick)
        {
            var count = foods.Count(row => pick(row) is not null);
            return $"{name} {Format(Percent(count, foods.Count))} ({count})";
        }

        return "Panel: " + string.Join(", ",
            Part("mono", row => row.MonoFatPer100),
            Part("poly", row => row.PolyFatPer100),
            Part("omega-3", row => row.Omega3Per100),
            Part("omega-6", row => row.Omega6Per100),
            Part("trans", row => row.TransFatPer100),
            Part("cholesterol", row => row.CholesterolPer100),
            Part("added sugar", row => row.AddedSugarsPer100),
            Part("sodium", row => row.SodiumPer100),
            Part("vitamin A", row => row.VitaminAPer100),
            Part("vitamin D", row => row.VitaminDPer100),
            Part("vitamin E", row => row.VitaminEPer100),
            Part("thiamin", row => row.ThiaminPer100),
            Part("riboflavin", row => row.RiboflavinPer100),
            Part("niacin", row => row.NiacinPer100),
            Part("vitamin B6", row => row.VitaminB6Per100),
            Part("folate", row => row.FolatePer100),
            Part("vitamin B12", row => row.VitaminB12Per100),
            Part("vitamin C", row => row.VitaminCPer100),
            Part("calcium", row => row.CalciumPer100),
            Part("iron", row => row.IronPer100),
            Part("zinc", row => row.ZincPer100),
            Part("magnesium", row => row.MagnesiumPer100),
            Part("potassium", row => row.PotassiumPer100),
            Part("phosphorus", row => row.PhosphorusPer100),
            Part("selenium", row => row.SeleniumPer100),
            Part("iodine", row => row.IodinePer100)) + ".";
    }

    private static string Format(decimal? percent) =>
        percent is decimal value ? value.ToString("0.0", CultureInfo.InvariantCulture) + "%" : "n/a";
}

public readonly record struct MatvareConstituent(string? NutrientId, string? Unit, decimal? Quantity);

public readonly record struct KassalNutrient(string? Code, string? Unit, decimal? Amount);
