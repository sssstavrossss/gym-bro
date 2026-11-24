namespace GymBro.Api.Describe;

/// <summary>
/// A stand-in for Claude in Testing and E2e. Every photo shows the same fictional crispbread label, per 100 g with
/// a 13 g slice, so tests are free and repeatable.
/// </summary>
public sealed class RuleLabelModel : ILabelModel
{
    public static readonly LabelReading Label = new(
        Table: true,
        Name: "Fictional label crispbread",
        Brand: "Northbar",
        PerServing: false,
        ServingName: "slice",
        ServingGrams: 13m,
        Kcal: 370m,
        Kj: 1550m,
        Protein: 12m,
        Fat: 6.5m,
        Carbs: 58m,
        SaturatedFat: 1.1m,
        Sugars: 2m,
        Fiber: 17m,
        Salt: 1m);

    public string Name => "rule";

    public Task<LabelReading> ReadAsync(MealPhoto photo, MealUsage usage, CancellationToken cancellationToken)
    {
        usage.Add(0, 0);
        return Task.FromResult(Label);
    }
}
