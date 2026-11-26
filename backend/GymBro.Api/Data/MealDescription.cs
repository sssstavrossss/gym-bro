namespace GymBro.Api.Data;

/// <summary>
/// One "Describe a meal" request: words, a photo, or both. A row is saved for every attempt, so a person's use can be counted and
/// read back (<see cref="Outcome"/>, tokens, time), and a logged one can be used again. <see cref="Items"/> is
/// JSON: the foods as last logged (or as matched until then), each with phrase, name, guessed, food id, amount
/// and unit; empty unless <see cref="Outcome"/> is found. <see cref="FoodCount"/> and <see cref="Kcal"/> describe
/// it for the recent list. <see cref="LoggedAt"/> is null until the foods are added.
/// </summary>
public sealed class MealDescription
{
    public Guid Id { get; set; }

    public string UserId { get; set; } = "";

    /// <summary>One of <see cref="MealKinds"/>: a meal described, or a label read for New food. Both count toward the same daily limit.</summary>
    public string Kind { get; set; } = MealKinds.Meal;

    /// <summary>The person's words. Empty when they sent only a photo.</summary>
    public string Text { get; set; } = "";

    /// <summary>A photo was sent with it. The photo itself goes to the model and is not kept.</summary>
    public bool HasPhoto { get; set; }

    public string Items { get; set; } = "[]";

    public int FoodCount { get; set; }

    public decimal Kcal { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? LoggedAt { get; set; }

    /// <summary>One of <see cref="MealOutcomes"/>.</summary>
    public string Outcome { get; set; } = MealOutcomes.Found;

    /// <summary>The model that answered, or the test model's name.</summary>
    public string Model { get; set; } = "";

    public int Calls { get; set; }

    public int InputTokens { get; set; }

    public int OutputTokens { get; set; }

    public int DurationMs { get; set; }

    /// <summary>The caller's earlier description this one tries again, after editing the words.</summary>
    public Guid? RetryOf { get; set; }
}

public static class MealKinds
{
    /// <summary>"Describe a meal".</summary>
    public const string Meal = "meal";

    /// <summary>A photo of a nutrition label read for New food. Found means the label filled the form.</summary>
    public const string Label = "label";

    /// <summary>A recipe's ingredients matched for New recipe, from a link or pasted text. Found means the list came back.</summary>
    public const string Recipe = "recipe";

    /// <summary>A workout described for the workout screen. Found means at least one exercise came back.</summary>
    public const string Workout = "workout";
}

public static class MealOutcomes
{
    /// <summary>At least one food came back.</summary>
    public const string Found = "found";

    /// <summary>The model answered but named no food.</summary>
    public const string Nothing = "nothing";

    /// <summary>The model declined to answer.</summary>
    public const string Declined = "declined";

    /// <summary>The model couldn't be reached, timed out, or was cut off. Doesn't count toward the limit.</summary>
    public const string Failed = "failed";
}
