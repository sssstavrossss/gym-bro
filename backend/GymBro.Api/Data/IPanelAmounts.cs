namespace GymBro.Api.Data;

/// <summary>
/// The nutrient panel past the label basics, as an amount: a log entry, a saved group item,
/// a recipe ingredient, or a whole recipe. Per-100 values on a food are separate.
/// </summary>
public interface IPanelAmounts
{
    decimal? MonoFat { get; set; }
    decimal? PolyFat { get; set; }
    decimal? Omega3 { get; set; }
    decimal? Omega6 { get; set; }
    decimal? TransFat { get; set; }
    decimal? Cholesterol { get; set; }
    decimal? AddedSugars { get; set; }
    decimal? Sodium { get; set; }
    decimal? VitaminA { get; set; }
    decimal? VitaminD { get; set; }
    decimal? VitaminE { get; set; }
    decimal? Thiamin { get; set; }
    decimal? Riboflavin { get; set; }
    decimal? Niacin { get; set; }
    decimal? VitaminB6 { get; set; }
    decimal? Folate { get; set; }
    decimal? VitaminB12 { get; set; }
    decimal? VitaminC { get; set; }
    decimal? Calcium { get; set; }
    decimal? Iron { get; set; }
    decimal? Zinc { get; set; }
    decimal? Magnesium { get; set; }
    decimal? Potassium { get; set; }
    decimal? Phosphorus { get; set; }
    decimal? Selenium { get; set; }
    decimal? Iodine { get; set; }
    decimal? Copper { get; set; }
    decimal? Starch { get; set; }
    decimal? EpaDha { get; set; }
}
