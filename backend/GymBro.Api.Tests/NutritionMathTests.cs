using GymBro.Api.Nutrition;

namespace GymBro.Api.Tests;

public sealed class NutritionMathTests
{
    [Fact]
    public void Worked_example_matches_the_spec()
    {
        var result = NutritionMath.Calculate(new NutritionInput(
            Sex: Sexes.Male,
            WeightKg: 83.6m,
            HeightCm: 180,
            Age: 36,
            Activity: ActivityLevels.Moderate,
            Goal: Goals.Lose,
            RateKgPerWeek: 0.5m,
            ProteinGramsPerKg: 2.0m,
            FatPercent: 25));

        Assert.Equal(1786, result.Bmr);
        Assert.Equal(2768, result.Tdee);
        Assert.Equal(2218, result.Kcal);
        Assert.Equal(167, result.Protein);
        Assert.Equal(62, result.Fat);
        Assert.Equal(249, result.Carbs);
        Assert.False(result.FloorApplied);
    }

    [Fact]
    public void Activity_factors_match_the_spec()
    {
        Assert.Equal(1.2m, NutritionMath.ActivityFactors[ActivityLevels.Sedentary]);
        Assert.Equal(1.375m, NutritionMath.ActivityFactors[ActivityLevels.Light]);
        Assert.Equal(1.55m, NutritionMath.ActivityFactors[ActivityLevels.Moderate]);
        Assert.Equal(1.725m, NutritionMath.ActivityFactors[ActivityLevels.VeryActive]);
        Assert.Equal(1.9m, NutritionMath.ActivityFactors[ActivityLevels.Athlete]);
    }

    [Fact]
    public void Half_a_kilocalorie_rounds_away_from_zero()
    {
        // 10×80 + 6.25×182 − 5×30 + 5 = 1792.5
        var result = NutritionMath.Calculate(new NutritionInput(
            Sexes.Male, 80, 182, 30, ActivityLevels.Sedentary, Goals.Maintain, 0, 2.0m, 25));

        Assert.Equal(1793, result.Bmr);
        Assert.Equal(2152, result.Tdee);
        Assert.Equal(2152, result.Kcal);
        Assert.False(result.FloorApplied);
    }

    [Fact]
    public void Calorie_floor_never_lets_the_target_fall_below_bmr()
    {
        var result = NutritionMath.Calculate(new NutritionInput(
            Sexes.Male, 83.6m, 180, 36, ActivityLevels.Moderate, Goals.Lose, 1.0m, 2.0m, 25));

        Assert.Equal(1786, result.Bmr);
        Assert.Equal(2768, result.Tdee);
        Assert.Equal(result.Bmr, result.Kcal);
        Assert.True(result.FloorApplied);
    }

    [Fact]
    public void Carbs_fill_the_rest_and_never_go_below_zero()
    {
        var result = NutritionMath.Calculate(new NutritionInput(
            Sexes.Female, 45, 150, 80, ActivityLevels.Sedentary, Goals.Lose, 1.0m, 3.0m, 40));

        Assert.True(result.FloorApplied);
        Assert.Equal(0, result.Carbs);
        Assert.Equal(result.Bmr, result.Kcal);
    }

    [Theory]
    [InlineData("less", 1.6)]
    [InlineData("normal", 2.0)]
    [InlineData("more", 2.4)]
    public void Protein_presets_are_the_spec_values(string setting, decimal grams)
    {
        Assert.True(NutritionMath.ProteinMatches(setting, grams));
        Assert.False(NutritionMath.ProteinMatches(setting, grams + 0.1m));
    }

    [Fact]
    public void Exact_protein_and_fat_stay_on_their_steps()
    {
        Assert.True(NutritionMath.ProteinMatches("exact", 1.2m));
        Assert.True(NutritionMath.ProteinMatches("exact", 3.0m));
        Assert.False(NutritionMath.ProteinMatches("exact", 1.25m));
        Assert.False(NutritionMath.ProteinMatches("exact", 1.1m));
        Assert.True(NutritionMath.FatMatches("exact", 15));
        Assert.True(NutritionMath.FatMatches("exact", 40));
        Assert.False(NutritionMath.FatMatches("exact", 22));
        Assert.False(NutritionMath.FatMatches("less", 25));
        Assert.True(NutritionMath.FatMatches("less", 20));
        Assert.True(NutritionMath.FatMatches("normal", 25));
        Assert.True(NutritionMath.FatMatches("more", 30));
    }

    [Fact]
    public void Gain_adds_the_same_daily_amount_lose_subtracts()
    {
        var lose = NutritionMath.Calculate(Example(Goals.Lose));
        var gain = NutritionMath.Calculate(Example(Goals.Gain));
        var maintain = NutritionMath.Calculate(Example(Goals.Maintain) with { RateKgPerWeek = 0 });

        Assert.Equal(550, maintain.Kcal - lose.Kcal);
        Assert.Equal(550, gain.Kcal - maintain.Kcal);
        Assert.False(lose.FloorApplied);
    }

    private static NutritionInput Example(string goal) => new(
        Sexes.Male, 83.6m, 180, 36, ActivityLevels.Moderate, goal, 0.5m, 2.0m, 25);
}
