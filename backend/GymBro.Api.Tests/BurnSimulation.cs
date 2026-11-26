using System.Globalization;
using System.Text;
using GymBro.Api.Nutrition;

namespace GymBro.Api.Tests;

/// <summary>
/// Synthetic people whose real burn is known, recalculating every Monday for 12 weeks. Each
/// scenario runs many times with different random days, through the period maths the app uses
/// today (<see cref="AdaptiveTarget"/>) and through the rolling readings (<see cref="BurnReadings"/>).
/// The body: food beyond the burn goes on as tissue at 7,700 kcal a kg, a big day leaves water and
/// food that fade over a few days, and the scale wobbles. An under-logger logs a share of what they
/// eat, so the burn worth learning is the one in logged calories.
/// </summary>
public static class BurnSimulation
{
    // BMR 1786, formula burn 2768 (the same person as AdaptiveTargetTests).
    private static readonly NutritionInput Person = new(
        Sexes.Male, 83.6m, 180m, 36, ActivityLevels.Moderate, Goals.Lose, 0.5m, 2.0m, 25m);

    public const int FormulaBurn = 2768;

    private const int Bmr = 1786;

    private const int Deficit = 550;

    private const int Weeks = 12;

    private static readonly DateOnly Setup = new(2026, 1, 5); // a Monday

    public enum Eating { Steady, SundayFeast }

    public enum Scale { Daily, ThreeAWeek, Weekly, EveryTwoWeeks }

    public sealed record Scenario(string Name, Scale Scale, Eating Eating, double BurnOff, double UnderLog = 0, double MissedDays = 0);

    public static readonly Scenario[] Scenarios =
    [
        new("Daily, steady, burn +12%", Scale.Daily, Eating.Steady, 0.12),
        new("3 a week, steady, burn +12%", Scale.ThreeAWeek, Eating.Steady, 0.12),
        new("Weekly, steady, burn +12%", Scale.Weekly, Eating.Steady, 0.12),
        new("Weekly, Sunday feast, burn +12%", Scale.Weekly, Eating.SundayFeast, 0.12),
        new("Weekly, Sunday feast, burn −10%", Scale.Weekly, Eating.SundayFeast, -0.10),
        new("Daily, Sunday feast, burn as formula", Scale.Daily, Eating.SundayFeast, 0),
        new("Every 2 weeks, steady, burn +12%", Scale.EveryTwoWeeks, Eating.Steady, 0.12),
        new("Daily, logs 80%, misses 10% of days", Scale.Daily, Eating.Steady, 0.05, 0.2, 0.1),
        new("Weekly, misses 25% of days", Scale.Weekly, Eating.Steady, 0.12, 0, 0.25),
        new("Daily, steady, burn as formula", Scale.Daily, Eating.Steady, 0),
    ];

    public sealed record Result(
        Scenario Scenario,
        double[] OldError,
        double[] NewError,
        double OldMeanStep,
        double NewMeanStep,
        double OldMaxStep,
        double NewMaxStep,
        double OldMeasured,
        double NewMeasured,
        double NewMaxStepShare);

    /// <summary>Mean absolute error after weeks 4, 8 and 12, how far each Monday moved the burn, and how often it was measured.</summary>
    public static Result Run(Scenario scenario, int runs = 200)
    {
        var oldError = new double[3];
        var newError = new double[3];
        double oldSteps = 0, newSteps = 0, oldMax = 0, newMax = 0, oldMeasured = 0, newMeasured = 0, maxShare = 0;
        var recalcs = 0;
        for (var seed = 0; seed < runs; seed++)
        {
            var run = Once(scenario, seed);
            for (var i = 0; i < 3; i++)
            {
                oldError[i] += run.OldError[i] / runs;
                newError[i] += run.NewError[i] / runs;
            }

            oldSteps += run.OldSteps.Sum();
            newSteps += run.NewSteps.Sum();
            oldMax = Math.Max(oldMax, run.OldSteps.Max());
            newMax = Math.Max(newMax, run.NewSteps.Max());
            oldMeasured += run.OldMeasured;
            newMeasured += run.NewMeasured;
            maxShare = Math.Max(maxShare, run.MaxShare);
            recalcs += run.OldSteps.Count;
        }

        return new Result(scenario, oldError, newError, oldSteps / recalcs, newSteps / recalcs, oldMax, newMax,
            oldMeasured / recalcs, newMeasured / recalcs, maxShare);
    }

    private sealed record Run1(double[] OldError, double[] NewError, List<double> OldSteps, List<double> NewSteps, int OldMeasured, int NewMeasured, double MaxShare);

    private static Run1 Once(Scenario scenario, int seed)
    {
        var random = new Random(seed * 7919 + scenario.Name.Length);
        double Normal(double sd) => sd * Math.Sqrt(-2 * Math.Log(1 - random.NextDouble())) * Math.Cos(2 * Math.PI * random.NextDouble());

        var baseBurn = FormulaBurn * (1 + scenario.BurnOff);
        var tissue = 84.0;
        var water = 0.0;
        var weighIns = new List<(DateOnly Date, decimal Kg)>();
        var days = new List<IntakeDay>();
        var facts = new List<DayFact>();
        var trueIntake = new List<double>();
        var trueBurn = new List<double>();

        decimal oldBurn = FormulaBurn, newBurn = FormulaBurn, newSd = BurnEstimate.FormulaSdKcal;
        var newLast = Setup;
        var oldSd = (int)BurnEstimate.FormulaSdKcal;
        DateOnly? lastStart = null;
        var oldError = new double[3];
        var newError = new double[3];
        var oldSteps = new List<double>();
        var newSteps = new List<double>();
        int oldMeasured = 0, newMeasured = 0;
        double maxShare = 0;

        for (var d = 0; d < Weeks * 7 + 1; d++)
        {
            var date = Setup.AddDays(d);
            var week = d / 7;
            if (Weighs(scenario.Scale, d, random))
            {
                weighIns.Add((date, Math.Round((decimal)(tissue + water + Normal(0.25)), 1)));
            }

            if (d >= 14 && d % 7 == 0)
            {
                // Monday recalculation, both ways, before this day's food.
                var period = RecalculatePeriod.For(date, Setup, null, lastStart, null);
                var review = AdaptiveTarget.Review(
                    new ReviewInput(period.From, period.To, facts, weighIns.Where(row => row.Date >= period.SlopeFrom && row.Date <= date).ToList(), Person, (int)oldBurn, oldSd),
                    new HashSet<DateOnly>());
                var oldBefore = oldBurn;
                if (review.Measured)
                {
                    oldBurn = review.Burn;
                    oldSd = review.BurnSdKcal;
                    lastStart = date;
                    oldMeasured++;
                }

                oldSteps.Add(Math.Abs((double)(oldBurn - oldBefore)));

                var window = BurnReadings.Measure(date, Setup.AddDays(BurnEstimate.SettlingDays), weighIns, days, newBurn);
                var newBefore = newBurn;
                if (window.Burn is not null)
                {
                    var step = BurnReadings.Step(newBurn, newSd, date.DayNumber - newLast.DayNumber, window);
                    newBurn = Math.Max(step.Burn, Bmr);
                    newSd = step.BurnSd;
                    newLast = date;
                    newMeasured++;
                }

                newSteps.Add(Math.Abs((double)(newBurn - newBefore)));
                maxShare = Math.Max(maxShare, Math.Abs((double)((newBurn - newBefore) / newBefore)));

                if (week is 4 or 8 or 12)
                {
                    // The burn worth learning is in logged calories: an under-logger's is lower.
                    var recent = Enumerable.Range(Math.Max(0, d - 28), Math.Min(28, d)).ToList();
                    var effective = recent.Average(i => trueBurn[i]) - scenario.UnderLog * recent.Average(i => trueIntake[i]);
                    var slot = week / 4 - 1;
                    oldError[slot] = Math.Abs((double)oldBurn - effective);
                    newError[slot] = Math.Abs((double)newBurn - effective);
                }
            }

            // The day's food: each person eats to their own target, which follows their burn.
            var target = 0; // filled per method below; the eater follows the new method's target
            target = (int)Math.Round((double)newBurn) - Deficit;
            var eaten = scenario.Eating switch
            {
                Eating.SundayFeast when date.DayOfWeek == DayOfWeek.Sunday => target * 1.45 * (1 + Normal(0.05)),
                Eating.SundayFeast => target * 0.86 * (1 + Normal(0.05)),
                _ => target * (1 + Normal(0.08)),
            };
            var burnToday = baseBurn - 22 * (84 - tissue);
            trueIntake.Add(eaten);
            trueBurn.Add(burnToday);
            var missed = random.NextDouble() < scenario.MissedDays;
            decimal? logged = missed ? null : (decimal)Math.Round(eaten * (1 - scenario.UnderLog));
            days.Add(new IntakeDay(date, logged, target));
            facts.Add(new DayFact(date, logged ?? 0, logged is not null, target));

            tissue += (eaten - burnToday) / 7700;
            water = 0.5 * water + 0.0006 * (eaten - target);
        }

        return new Run1(oldError, newError, oldSteps, newSteps, oldMeasured, newMeasured, maxShare);
    }

    private static bool Weighs(Scale scale, int day, Random random) => scale switch
    {
        Scale.Daily => random.NextDouble() < 0.9 || day == 0,
        Scale.ThreeAWeek => day % 7 is 0 or 2 or 4,
        Scale.Weekly => day % 7 == 0,
        _ => day % 14 == 0,
    };

    public static string Report(IEnumerable<Result> results)
    {
        var text = new StringBuilder();
        text.AppendLine("| Scenario | Off by, week 4 (now → new) | Week 8 | Week 12 | Average move a Monday | Biggest move | Mondays measured |");
        text.AppendLine("|---|---|---|---|---|---|---|");
        foreach (var r in results)
        {
            string Pair(double a, double b) => $"{K(a)} → {K(b)}";
            text.AppendLine(string.Create(CultureInfo.InvariantCulture,
                $"| {r.Scenario.Name} | {Pair(r.OldError[0], r.NewError[0])} | {Pair(r.OldError[1], r.NewError[1])} | {Pair(r.OldError[2], r.NewError[2])} | {Pair(r.OldMeanStep, r.NewMeanStep)} | {Pair(r.OldMaxStep, r.NewMaxStep)} | {r.OldMeasured:P0} → {r.NewMeasured:P0} |"));
        }

        return text.ToString();
    }

    private static string K(double kcal) => Math.Round(kcal).ToString("N0", CultureInfo.GetCultureInfo("en-GB"));
}
