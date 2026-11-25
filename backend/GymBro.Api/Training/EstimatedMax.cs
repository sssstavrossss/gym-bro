namespace GymBro.Api.Training;

/// <summary>
/// Estimated one-rep max, Epley with reps in reserve: kg × (1 + (reps + RIR) / 30) (docs/training.md → Rules).
/// A set counts when it's a working set with a weight and 1 to <see cref="MaxReps"/> reps; no RIR counts as 0.
/// </summary>
public static class EstimatedMax
{
    /// <summary>Past this many reps the estimate drifts too far to call a best.</summary>
    public const int MaxReps = 20;

    public static decimal? Of(string type, decimal? kg, int? reps, int? rir)
    {
        if (type != SetTypes.Working || kg is not > 0 || reps is not (>= 1 and <= MaxReps))
        {
            return null;
        }

        return Math.Round(kg.Value * (30 + reps.Value + Math.Max(0, rir ?? 0)) / 30, 2);
    }
}
