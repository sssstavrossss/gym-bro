namespace GymBro.Api.Nutrition;

/// <summary>
/// The maths behind the trend: a damped local linear trend Kalman filter, one step per day.
/// The state is the true weight (level) and its daily change (slope). A real weigh-in is a
/// noisy look at the level; days without one only predict. The slope fades by
/// <see cref="SlopeDamping"/> a day, so a stopped diet does not carry on forever.
/// Past days are then smoothed backwards (Rauch–Tung–Striebel), so the line through a
/// gap is the best guess with hindsight. Days after the last weigh-in hold the level
/// flat; the uncertainty still grows as if the slope were applied, since it is unknown.
/// Pure; <see cref="TrendWeight"/> holds the rules.
/// </summary>
public static class TrendFilter
{
    /// <summary>Scale noise: one reading is about ±0.6 kg from the true weight (water, salt, food).</summary>
    public const double ReadingVariance = 0.36;

    /// <summary>How far the true weight can wander in a day, apart from the slope.</summary>
    public const double LevelVariance = 0.0025;

    /// <summary>How far the daily change can wander in a day.</summary>
    public const double SlopeVariance = 0.00003;

    /// <summary>
    /// Share of yesterday's slope kept today. 0.98 under-read a steady 1 kg/week loss by
    /// about 30%; 0.99 keeps most of a steady loss and still settles after a diet stops.
    /// </summary>
    public const double SlopeDamping = 0.99;

    /// <summary>The slope is unknown at the start: about ±0.14 kg a week.</summary>
    public const double FirstSlopeVariance = 0.0004;

    /// <param name="readings">Day offsets from the first reading (which is day 0), ascending and distinct.</param>
    /// <param name="length">Days to cover, at least the last reading's day + 1.</param>
    public static TrendPath Run(IReadOnlyList<(int Day, double Kg)> readings, int length)
    {
        if (readings.Count == 0 || readings[0].Day != 0 || length <= readings[^1].Day)
        {
            throw new ArgumentException("Readings start on day 0 and fit inside the length.", nameof(readings));
        }

        var lastDay = readings[^1].Day;
        var filtered = new State[length];
        var predicted = new State[length];
        var state = new State(new Vec(readings[0].Kg, 0), new Mat(ReadingVariance, 0, 0, FirstSlopeVariance));
        filtered[0] = state;
        var next = 1;
        for (var day = 1; day < length; day++)
        {
            if (day > lastDay)
            {
                // After the last weigh-in: hold the level, widen the band.
                state = state with { P = Predict(state).P };
                filtered[day] = state;
                continue;
            }

            state = Predict(state);
            predicted[day] = state;
            if (next < readings.Count && readings[next].Day == day)
            {
                state = Update(state, readings[next].Kg);
                next++;
            }

            filtered[day] = state;
        }

        var smoothed = (State[])filtered.Clone();
        for (var day = lastDay - 1; day >= 0; day--)
        {
            var gain = filtered[day].P * Transition.T * predicted[day + 1].P.Inverse();
            var x = filtered[day].X + gain * (smoothed[day + 1].X - predicted[day + 1].X);
            var p = filtered[day].P + gain * (smoothed[day + 1].P - predicted[day + 1].P) * gain.T;
            smoothed[day] = new State(x, p);
        }

        var levels = new double[length];
        var bands = new double[length];
        for (var day = 0; day < length; day++)
        {
            levels[day] = smoothed[day].X.Level;
            bands[day] = Math.Sqrt(Math.Max(0, smoothed[day].P.A));
        }

        return new TrendPath(levels, bands);
    }

    private static readonly Mat Transition = new(1, 1, 0, SlopeDamping);

    private static readonly Mat Noise = new(LevelVariance, 0, 0, SlopeVariance);

    private static State Predict(State state) =>
        new(Transition * state.X, Transition * state.P * Transition.T + Noise);

    private static State Update(State state, double kg)
    {
        var p = state.P;
        var spread = p.A + ReadingVariance;
        var gainLevel = p.A / spread;
        var gainSlope = p.C / spread;
        var miss = kg - state.X.Level;
        var x = new Vec(state.X.Level + gainLevel * miss, state.X.Slope + gainSlope * miss);
        var updated = new Mat(
            (1 - gainLevel) * p.A,
            (1 - gainLevel) * p.B,
            p.C - gainSlope * p.A,
            p.D - gainSlope * p.B);
        return new State(x, updated);
    }

    private readonly record struct State(Vec X, Mat P);

    private readonly record struct Vec(double Level, double Slope)
    {
        public static Vec operator +(Vec a, Vec b) => new(a.Level + b.Level, a.Slope + b.Slope);

        public static Vec operator -(Vec a, Vec b) => new(a.Level - b.Level, a.Slope - b.Slope);
    }

    /// <summary>[[A, B], [C, D]]</summary>
    private readonly record struct Mat(double A, double B, double C, double D)
    {
        public Mat T => new(A, C, B, D);

        public Mat Inverse()
        {
            var det = A * D - B * C;
            return new Mat(D / det, -B / det, -C / det, A / det);
        }

        public static Mat operator *(Mat x, Mat y) => new(
            x.A * y.A + x.B * y.C,
            x.A * y.B + x.B * y.D,
            x.C * y.A + x.D * y.C,
            x.C * y.B + x.D * y.D);

        public static Vec operator *(Mat m, Vec v) => new(m.A * v.Level + m.B * v.Slope, m.C * v.Level + m.D * v.Slope);

        public static Mat operator +(Mat x, Mat y) => new(x.A + y.A, x.B + y.B, x.C + y.C, x.D + y.D);

        public static Mat operator -(Mat x, Mat y) => new(x.A - y.A, x.B - y.B, x.C - y.C, x.D - y.D);
    }
}

/// <summary>Per day: the smoothed level and its standard deviation (kg).</summary>
public sealed record TrendPath(IReadOnlyList<double> Levels, IReadOnlyList<double> Bands);
