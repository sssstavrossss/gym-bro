using GymBro.Api.Data;

namespace GymBro.Api.Describe;

/// <summary>
/// The two questions "Describe a meal" asks a model. First: which foods are in the text, and how much of each.
/// Second, after the app has searched its own catalogue: which of the found foods is each one, in which unit.
/// The model never invents nutrients. Every number shown comes from a stored food.
/// </summary>
public interface IMealModel
{
    /// <summary>Kept on each description so cost can be read back per model.</summary>
    string Name { get; }

    /// <remarks>Each call adds what it cost to <paramref name="usage"/>, even when it then fails.</remarks>
    Task<IReadOnlyList<MealPart>> SplitAsync(string text, MealUsage usage, CancellationToken cancellationToken);

    Task<IReadOnlyList<MealPick>> PickAsync(
        string text,
        IReadOnlyList<MealChoice> choices,
        MealUsage usage,
        CancellationToken cancellationToken);
}

/// <summary>What one description cost: model calls and tokens. Kept on its row and written to the log.</summary>
public sealed class MealUsage
{
    public int Calls { get; private set; }

    public int InputTokens { get; private set; }

    public int OutputTokens { get; private set; }

    public void Add(long inputTokens, long outputTokens)
    {
        Calls++;
        InputTokens += (int)Math.Min(inputTokens, int.MaxValue - InputTokens);
        OutputTokens += (int)Math.Min(outputTokens, int.MaxValue - OutputTokens);
    }
}

/// <summary>One food named in the text.</summary>
/// <param name="Phrase">The words it came from, with the amount: "2 eggs".</param>
/// <param name="Name">A short plain name: "boiled egg".</param>
/// <param name="Searches">Catalogue searches to try, best first.</param>
/// <param name="Grams">Estimated grams (or ml) for the amount. A usual portion when the text gives none.</param>
/// <param name="Guessed">True when the text gives no amount.</param>
public sealed record MealPart(string Phrase, string Name, IReadOnlyList<string> Searches, decimal Grams, bool Guessed);

/// <summary>A unit a food can be logged in. <see cref="Grams"/> is the weight of one, when known.</summary>
public sealed record MealUnit(string Unit, string Label, decimal? Grams);

public sealed record MealCandidate(Food Food, bool Mine, IReadOnlyList<MealUnit> Units);

/// <summary>A part and the catalogue foods found for it, numbered from 1 in the order given.</summary>
public sealed record MealChoice(MealPart Part, IReadOnlyList<MealCandidate> Candidates);

/// <param name="Part">Index into the choices.</param>
/// <param name="Candidate">Index into that choice's candidates, or null when none fits.</param>
public sealed record MealPick(int Part, int? Candidate, decimal Amount, string Unit);

/// <summary>The model could not answer: no key, a network or API error, or a refusal.</summary>
public sealed class MealModelException(string message, bool refused = false, Exception? inner = null)
    : Exception(message, inner)
{
    public bool Refused { get; } = refused;
}
