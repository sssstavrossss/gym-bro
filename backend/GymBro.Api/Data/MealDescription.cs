namespace GymBro.Api.Data;

/// <summary>
/// One "Describe a meal" request. A row is saved for every attempt, so a person's use can be counted and
/// read back (<see cref="Outcome"/>, tokens, time), and a logged one can be used again. <see cref="Items"/> is
/// JSON: the foods as last logged (or as matched until then), each with phrase, name, guessed, food id, amount
/// and unit; empty unless <see cref="Outcome"/> is found. <see cref="FoodCount"/> and <see cref="Kcal"/> describe
/// it for the recent list. <see cref="LoggedAt"/> is null until the foods are added.
/// </summary>
public sealed class MealDescription
{
    public Guid Id { get; set; }

    public string UserId { get; set; } = "";

    public string Text { get; set; } = "";

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
