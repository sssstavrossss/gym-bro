using GymBro.Api.Nutrition;

namespace GymBro.Api.Progress;

/// <summary>One stored target's burn: what the Burn chart reads from each row.</summary>
public sealed record BurnRow(DateOnly Date, int Bmr, int Tdee, int FormulaTdee, int BurnSdKcal, IReadOnlyList<string> Reasons);

/// <summary>
/// The burn in effect on a day. <see cref="SdKcal"/> is how unsure it is that day: it grows
/// <see cref="BurnEstimate.WeeklyDriftKcal"/> a week after the burn was set, up to the formula's spread.
/// <see cref="Measured"/> is a burn read from intake and weight, not the formula alone.
/// </summary>
public sealed record BurnDay(int Kcal, int BmrKcal, int SdKcal, bool Measured, DateOnly SetOn);

/// <summary>
/// The daily burn and BMR as they stood each day, from the stored targets alone. Like the
/// target, a day before the first row has none. Profile edits keep a row's spread, so the
/// spread counts from the last recalculation or fresh start.
/// </summary>
public static class BurnSeries
{
    /// <param name="rows">Oldest first.</param>
    public static BurnDay? At(IReadOnlyList<BurnRow> rows, DateOnly day)
    {
        BurnRow? row = null;
        DateOnly? setOn = null;
        foreach (var item in rows)
        {
            if (item.Date > day) break;
            row = item;
            setOn ??= item.Date;
            if (item.Reasons.Any(RecalculationReasons.StartsPeriod)) setOn = item.Date;
        }

        if (row is null || setOn is not DateOnly set) return null;
        var weeks = (day.DayNumber - set.DayNumber) / 7m;
        var sd = BurnEstimate.SpreadAfter(row.BurnSdKcal, weeks);
        return new BurnDay(
            row.Tdee,
            row.Bmr,
            (int)decimal.Round(sd, 0, MidpointRounding.AwayFromZero),
            row.Tdee != row.FormulaTdee,
            set);
    }
}
