namespace GymBro.Api.Data;

/// <summary>
/// One profile per signed-in person. <see cref="UserId"/> is the Entra <c>oid</c>.
/// Macro defaults live here too: protein Normal is 2.0 g/kg and fat Normal is 25%.
/// </summary>
public sealed class Profile
{
    public string UserId { get; set; } = "";

    public string Sex { get; set; } = "";

    public int BirthYear { get; set; }

    public decimal HeightCm { get; set; }

    public string Activity { get; set; } = "";

    public string Goal { get; set; } = "";

    /// <summary>Null while the goal is maintain. Otherwise 0.25, 0.5, 0.75, or 1.0.</summary>
    public decimal? RateKgPerWeek { get; set; }

    public decimal GoalWeightKg { get; set; }

    public string ProteinSetting { get; set; } = "";

    public decimal ProteinGramsPerKg { get; set; }

    public string FatSetting { get; set; } = "";

    public decimal FatPercent { get; set; }

    /// <summary>IANA time zone. Monday and "today" are decided in this zone.</summary>
    public string TimeZone { get; set; } = "";

    /// <summary>The app moves <see cref="TimeZone"/> to the device's zone when they differ. Off once a zone is picked by hand.</summary>
    public bool TimeZoneFollowsDevice { get; set; } = true;

    /// <summary>
    /// The country picked by hand, as an ISO code (<c>SE</c>). Empty until one is picked. Read it through
    /// <see cref="GymBro.Api.Profiles.FoodCountries.Home(Profile)"/>, which follows the time zone instead while
    /// <see cref="FoodCountryFollowsZone"/> is on.
    /// </summary>
    public string FoodCountry { get; set; } = "";

    /// <summary>The food country is the time zone's country. Off once a country is picked by hand.</summary>
    public bool FoodCountryFollowsZone { get; set; } = true;

    /// <summary>How body weight is shown: <c>kg</c> or <c>lb</c>. Storage is always kilograms.</summary>
    public string WeightUnit { get; set; } = Units.Kilograms;

    /// <summary>How height is shown: <c>cm</c> or <c>ftin</c>. Storage is always centimetres.</summary>
    public string HeightUnit { get; set; } = Units.Centimetres;

    /// <summary>How food amounts are shown and typed: <c>g</c> (g and ml) or <c>oz</c> (oz and fl oz). Entries are always stored in grams or millilitres.</summary>
    public string FoodUnit { get; set; } = Units.Grams;

    /// <summary>Saturated fat and cholesterol limits on the Fats card: <c>normal</c> or <c>lower</c>. Display only.</summary>
    public string FatLimits { get; set; } = global::GymBro.Api.Data.FatLimits.Normal;

    /// <summary>The sodium limit on the Carbs card and Progress: <c>normal</c> or <c>lower</c>. Display only.</summary>
    public string SodiumLimit { get; set; } = SodiumLimits.Normal;

    /// <summary>Monday morning push asking the person to recalculate. Off until they turn it on.</summary>
    public bool RemindersEnabled { get; set; }

    /// <summary>Weekly recalculate push. On unless the person turns that type off.</summary>
    public bool NotifyRecalculate { get; set; } = true;

    /// <summary>The fresh-start day the person said "Not now" to. The prompt stays hidden for that fresh start.</summary>
    public DateOnly? FreshStartDeclinedOn { get; set; }

    /// <summary>"Keep my goal" on goal reached: the weigh-in day it was said on. The card stays hidden for that day and goal.</summary>
    public DateOnly? GoalKeptOn { get; set; }

    /// <summary>The goal weight that was kept. A new goal brings the card back.</summary>
    public decimal? GoalKeptKg { get; set; }

    /// <summary>Home cards switched off, as the app's ids. Null until the app first saves a choice.</summary>
    public string[]? HomeHidden { get; set; }

    /// <summary>Macros card pages switched off, on every macros card. Null until the app first saves a choice.</summary>
    public string[]? MacrosHidden { get; set; }

    /// <summary>Progress card pages switched off. Null until the app first saves a choice.</summary>
    public string[]? ProgressHidden { get; set; }

    /// <summary>
    /// The macros card's pages in the order they swipe, as the app's ids, hidden ones included.
    /// Null until the app first saves an order; ids it doesn't list keep their default place.
    /// </summary>
    public string[]? MacrosOrder { get; set; }

    /// <summary>The Progress card's pages in the order they swipe, like <see cref="MacrosOrder"/>.</summary>
    public string[]? ProgressOrder { get; set; }

    /// <summary>
    /// The + fan's pages, each the app's action ids joined by commas (see <see cref="Profiles.FanPages"/>).
    /// Null until the app first saves a layout; empty is the default layout.
    /// </summary>
    public string[]? FanPages { get; set; }

    /// <summary>
    /// Your training (<see cref="Training.TrainingSettings"/>): the answers every new plan starts from. All null until
    /// first saved, from Train or by making a plan; saved together.
    /// </summary>
    public int? TrainingMinutes { get; set; }

    public string? TrainingExperience { get; set; }

    public string[]? TrainingEquipment { get; set; }

    public string[]? TrainingGoEasy { get; set; }

    public bool? TrainingWarmUp { get; set; }

    public bool? TrainingCoolDown { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>Display units. Only what is shown and typed changes; the database stays metric.</summary>
public static class Units
{
    public const string Kilograms = "kg";
    public const string Pounds = "lb";
    public const string Centimetres = "cm";
    public const string FeetInches = "ftin";
    public const string Grams = "g";
    public const string Ounces = "oz";

    public static bool IsWeight(string value) => value is Kilograms or Pounds;

    public static bool IsHeight(string value) => value is Centimetres or FeetInches;

    public static bool IsFood(string value) => value is Grams or Ounces;
}

/// <summary>
/// How strict the Fats card's limits are. Normal: saturated fat at most 10% of calories (NNR 2023).
/// Lower: at most 7% of calories and cholesterol at most 200 mg a day (the heart-health level for raised LDL).
/// The numbers live in the client; the server only stores the choice.
/// </summary>
public static class FatLimits
{
    public const string Normal = "normal";
    public const string Lower = "lower";

    public static bool IsValid(string value) => value is Normal or Lower;
}

/// <summary>
/// How strict the sodium limit is. Normal: 2,300 mg a day (NNR 2023). Lower: 1,500 mg a day
/// (the American Heart Association's ideal, for raised blood pressure).
/// The numbers live in the client; the server only stores the choice.
/// </summary>
public static class SodiumLimits
{
    public const string Normal = "normal";
    public const string Lower = "lower";

    public static bool IsValid(string value) => value is Normal or Lower;
}
