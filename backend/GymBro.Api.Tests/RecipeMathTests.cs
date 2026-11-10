using GymBro.Api.Data;
using GymBro.Api.Logging;

namespace GymBro.Api.Tests;

public sealed class RecipeMathTests
{
    [Fact]
    public void Protein_per_portion_is_the_ingredient_total_divided_by_portions()
    {
        var chicken = Sample("Chicken", 400, 100, 10, 0);
        var line = RecipeRules.BuildNew(chicken, "user", 250, "g", null);
        Assert.Equal(RecipeRules.BuildStatus.Ok, line.Status);
        Assert.Equal(250, line.Grams);
        Assert.Equal(1000, line.Nutrients.Kcal);
        Assert.Equal(250, line.Nutrients.Protein);

        var total = RecipeRules.Sum([line.Nutrients]);
        Assert.NotNull(total);
        Assert.Equal(50, RecipeRules.PerPortion(total.Value, 5).Protein);
        Assert.Equal(200, RecipeRules.PerPortion(total.Value, 5).Kcal);

        var one = RecipeRules.ScaleLog(total.Value, 5, 500, 1, RecipeRules.LogMode.Portion);
        Assert.Null(one.Error);
        Assert.Equal("portion", one.Unit);
        Assert.Equal(1, one.Amount);
        Assert.Equal(50, one.Nutrients.Protein);
        Assert.Equal(100, one.Grams);

        var half = RecipeRules.ScaleLog(total.Value, 5, 500, 0.5m, RecipeRules.LogMode.Portion);
        Assert.Equal(25, half.Nutrients.Protein);
        Assert.Equal(50, half.Grams);

        var byGram = RecipeRules.ScaleLog(total.Value, 5, 500, 100, RecipeRules.LogMode.Grams);
        Assert.Null(byGram.Error);
        Assert.Equal("g", byGram.Unit);
        Assert.Equal(100, byGram.Grams);
        Assert.Equal(50, byGram.Nutrients.Protein);
        Assert.Equal(200, byGram.Nutrients.Kcal);

        var missingWeight = RecipeRules.ScaleLog(total.Value, 5, null, 100, RecipeRules.LogMode.Grams);
        Assert.Equal(RecipeRules.NoFinishedWeight, missingWeight.Error);
        Assert.Null(RecipeRules.PerGram(total.Value, null));
        Assert.Equal(0.5m, RecipeRules.PerGram(total.Value, 500)!.Value.Protein);
    }

    [Fact]
    public void Grams_and_millilitres_add_nutrients_without_converting_units()
    {
        var oats = Sample("Oats", 200, 20, 4, 30);
        var milk = Sample("Milk", 50, 5, 2, 6, "ml");
        var solid = RecipeRules.BuildNew(oats, "user", 100, "g", null);
        var liquid = RecipeRules.BuildNew(milk, "user", 250, "ml", null);
        Assert.Equal(100, solid.Grams);
        Assert.Null(liquid.Grams);
        Assert.Equal(125, liquid.Nutrients.Kcal);

        var total = RecipeRules.Sum([solid.Nutrients, liquid.Nutrients])!.Value;
        Assert.Equal(325, total.Kcal);
        Assert.Equal(32.5m, total.Protein);
        Assert.Equal(162.5m, RecipeRules.PerPortion(total, 2).Kcal);

        var logged = RecipeRules.ScaleLog(total, 2, null, 1, RecipeRules.LogMode.Portion);
        Assert.Null(logged.Grams);
        Assert.Equal(162.5m, logged.Nutrients.Kcal);
        Assert.Equal(16.25m, logged.Nutrients.Protein);
    }

    [Fact]
    public void An_own_serving_uses_its_gram_weight_and_a_per_serving_food_has_none()
    {
        var bread = Sample("Bread", 250, 10, 2, 40);
        var slices = RecipeRules.BuildNew(bread, "user", 2, "slice", 40);
        Assert.Equal(RecipeRules.BuildStatus.Ok, slices.Status);
        Assert.Equal("slice", slices.Unit);
        Assert.Equal(80, slices.Grams);
        Assert.Equal(200, slices.Nutrients.Kcal);
        Assert.Equal(8, slices.Nutrients.Protein);

        var shake = new Food
        {
            Name = "Shake",
            NutrientBasis = NutrientBases.PerServing,
            Basis = "serving",
            KcalPer100 = 220,
            ProteinPer100 = 30,
            FatPer100 = 4,
            CarbsPer100 = 8,
        };
        var servings = RecipeRules.BuildNew(shake, "user", 2, "serving", null);
        Assert.Null(servings.Grams);
        Assert.Equal(440, servings.Nutrients.Kcal);
        Assert.Equal(60, servings.Nutrients.Protein);

        var total = RecipeRules.Sum([slices.Nutrients, servings.Nutrients])!.Value;
        Assert.Equal(68, total.Protein);
        Assert.Equal(34, RecipeRules.PerPortion(total, 2).Protein);
    }

    [Fact]
    public void A_retired_ingredient_keeps_or_scales_its_saved_totals()
    {
        var id = Guid.NewGuid();
        var retired = Sample("Chicken", 999, 999, 999, 999);
        retired.Id = id;
        retired.RetiredAt = DateTimeOffset.Parse("2026-11-01T00:00:00Z");
        var kept = new RecipeIngredient
        {
            FoodId = id,
            Name = "Chicken",
            Amount = 250,
            Unit = "g",
            Grams = 250,
            Kcal = 1000,
            Protein = 250,
            Fat = 20,
            Carbs = 0,
            FoodOwnerKey = Food.CatalogueOwnerKey,
        };

        var same = RecipeRules.BuildEdit(retired, "user", 250, "g", null, kept);
        Assert.Equal(250, same.Nutrients.Protein);
        Assert.Equal(1000, same.Nutrients.Kcal);
        Assert.Equal("Chicken", same.Name);

        var half = RecipeRules.BuildEdit(retired, "user", 125, "g", null, kept);
        Assert.Equal(125, half.Amount);
        Assert.Equal(125, half.Nutrients.Protein);
        Assert.Equal(500, half.Nutrients.Kcal);
        Assert.Equal(125, half.Grams);

        var otherUnit = RecipeRules.BuildEdit(retired, "user", 1, "serving", null, kept);
        Assert.Equal(RecipeRules.KeepAmount, otherUnit.Error);

        var fresh = RecipeRules.BuildNew(retired, "user", 250, "g", null);
        Assert.Equal(RecipeRules.FoodRetired, fresh.Error);

        var stranger = Sample("Secret", 10, 1, 1, 1);
        stranger.UserId = "someone-else";
        Assert.Equal(RecipeRules.BuildStatus.NotFound, RecipeRules.BuildNew(stranger, "user", 100, "g", null).Status);
    }

    [Fact]
    public void Names_portions_and_finished_weight_reject_empty_or_out_of_range_values()
    {
        Assert.Equal(RecipeRules.NeedName, RecipeRules.RejectName("   ", out _));
        Assert.Null(RecipeRules.RejectName("  Weeknight   stew ", out var name));
        Assert.Equal("Weeknight stew", name);
        Assert.Equal(RecipeRules.PortionsLimit, RecipeRules.RejectPortions(0));
        Assert.Equal(RecipeRules.PortionsLimit, RecipeRules.RejectPortions(1001));
        Assert.Null(RecipeRules.RejectPortions(5));
        Assert.Null(RecipeRules.RejectFinished(null));
        Assert.Equal(RecipeRules.FinishedLimit, RecipeRules.RejectFinished(0));
        Assert.Equal(RecipeRules.FinishedLimit, RecipeRules.RejectFinished(100_001));
        Assert.Contains("Chicken", RecipeRules.RetiredNotice(["Chicken"]));
    }

    private static Food Sample(string name, decimal kcal, decimal protein, decimal fat, decimal carbs, string basis = "g") =>
        new()
        {
            Id = Guid.NewGuid(),
            Name = name,
            Basis = basis,
            NutrientBasis = NutrientBases.Per100,
            KcalPer100 = kcal,
            ProteinPer100 = protein,
            FatPer100 = fat,
            CarbsPer100 = carbs,
        };
}
