namespace GymBro.Api.Training;

public static class PlanGoals
{
    public const string Muscle = "muscle";
    public const string Strength = "strength";
    public const string Fitness = "fitness";

    /// <summary>Hyrox: strength days between the race's stations and runs (docs/training.md, phase 6). Its split is <see cref="Splits.Hyrox"/>.</summary>
    public const string Hyrox = "hyrox";

    public static readonly IReadOnlySet<string> All = new HashSet<string>([Muscle, Strength, Fitness, Hyrox]);
}

public static class Experience
{
    public const string New = "new";
    public const string Some = "some";
    public const string Experienced = "experienced";

    public static readonly IReadOnlySet<string> All = new HashSet<string>([New, Some, Experienced]);
}

/// <summary>The equipment presets the setup offers. They can be combined, like Dumbbells and Kettlebells.</summary>
public static class EquipmentPresets
{
    public const string Gym = "gym";
    public const string Home = "home";
    public const string Dumbbells = "dumbbells";
    public const string Kettlebells = "kettlebells";
    public const string Bodyweight = "bodyweight";

    /// <summary>What each preset holds, as the generator's kit (<see cref="Kit"/>). Body weight comes with all of them.</summary>
    public static readonly IReadOnlyDictionary<string, string[]> Holds = new Dictionary<string, string[]>
    {
        [Gym] = [Kit.Barbell, Kit.Dumbbell, Kit.Kettlebell, Kit.Cable, Kit.Machine, Kit.Bar, Kit.Stations, Kit.Bodyweight],
        [Home] = [Kit.Barbell, Kit.Dumbbell, Kit.Bar, Kit.Bodyweight],
        [Dumbbells] = [Kit.Dumbbell, Kit.Bodyweight],
        [Kettlebells] = [Kit.Kettlebell, Kit.Bodyweight],
        [Bodyweight] = [Kit.Bodyweight],
    };

    public static IReadOnlySet<string> KitOf(IEnumerable<string> presets) =>
        presets.SelectMany(preset => Holds.GetValueOrDefault(preset, [])).Append(Kit.Bodyweight).ToHashSet();
}

/// <summary>What an exercise needs. A bench comes with dumbbells and barbells; a bar is for pull-ups and hanging.</summary>
public static class Kit
{
    public const string Barbell = "barbell";
    public const string Dumbbell = "dumbbell";
    public const string Kettlebell = "kettlebell";
    public const string Cable = "cable";
    public const string Machine = "machine";
    public const string Bar = "bar";

    /// <summary>A sled, a sandbag and a wall-ball target: Hyrox's stations, which a full gym has.</summary>
    public const string Stations = "stations";
    public const string Bodyweight = "bodyweight";
}

/// <summary>The areas "Go easy on" offers. The generator leaves out the core exercises that load them hardest.</summary>
public static class Joints
{
    public const string Shoulders = "shoulders";
    public const string Elbows = "elbows";
    public const string Wrists = "wrists";
    public const string LowerBack = "lower-back";
    public const string Hips = "hips";
    public const string Knees = "knees";
    public const string Ankles = "ankles";

    public static readonly IReadOnlyList<string> All = [Shoulders, Elbows, Wrists, LowerBack, Hips, Knees, Ankles];
}

public static class Splits
{
    public const string FullBody = "full_body";
    public const string UpperLower = "upper_lower";
    public const string PushPullLegs = "push_pull_legs";
    /// <summary>Five days: push, pull, legs, then upper and lower.</summary>
    public const string PplUpperLower = "ppl_upper_lower";

    /// <summary>Your own: one empty workout a day, filled in by hand (docs/training.md, phase 5).</summary>
    public const string Custom = "custom";

    /// <summary>The Hyrox goal's own: strength, stations and runs in turn. Only that goal has it.</summary>
    public const string Hyrox = "hyrox";

    public static readonly IReadOnlySet<string> All = new HashSet<string>([FullBody, UpperLower, PushPullLegs, PplUpperLower, Custom, Hyrox]);

    /// <summary>The split that follows from the goal and the days a week (docs/training.md, decision 3).</summary>
    public static string For(int days, string? goal = null) => goal == PlanGoals.Hyrox ? Hyrox : days switch
    {
        <= 3 => FullBody,
        4 => UpperLower,
        5 => PplUpperLower,
        _ => PushPullLegs,
    };
}

/// <summary>The setup's answers, as the app sends them.</summary>
public sealed class PlanRequest
{
    public string? Goal { get; set; }

    /// <summary>Days of the week, 0 = Monday. They only date the sessions; the count is days a week.</summary>
    public List<int>? Weekdays { get; set; }

    public int? Minutes { get; set; }

    public string? Experience { get; set; }

    public List<string>? Equipment { get; set; }

    public List<string>? GoEasy { get; set; }

    /// <summary>Null takes the default: on for New and for anyone with an area to go easy on.</summary>
    public bool? EaseIn { get; set; }

    /// <summary>Null takes the split that follows from the days.</summary>
    public string? Split { get; set; }

    /// <summary>A mobility warm-up of dynamic moves before each workout (<see cref="Mobility"/>). Null is off.</summary>
    public bool? WarmUp { get; set; }

    /// <summary>A cool-down of held stretches after each workout (<see cref="Mobility"/>). Null is off.</summary>
    public bool? CoolDown { get; set; }

    /// <summary>The person's time zone, so a new plan starts on their today.</summary>
    public string? TimeZone { get; set; }
}

/// <summary>Checked answers, ready for the generator.</summary>
public sealed record PlanAnswers(
    string Goal,
    IReadOnlyList<int> Weekdays,
    int Minutes,
    string Experience,
    IReadOnlyList<string> Equipment,
    IReadOnlyList<string> GoEasy,
    bool EaseIn,
    string Split,
    bool WarmUp = false,
    bool CoolDown = false);

public static class PlanRules
{
    public const int MinMinutes = 10;
    public const int MaxMinutes = 120;
    public const int MinuteStep = 5;

    /// <summary>About five weeks stepping from 3 to 1 in reserve, then a lighter week (docs/training.md, Rules).</summary>
    public const int BlockWeeks = 6;

    public const string UnknownGoal = "Pick a goal: muscle, strength, fitness or Hyrox.";
    public const string NeedsDays = "Pick at least one day of the week.";
    public const string BadDay = "Days of the week are 0 (Monday) to 6 (Sunday).";
    public const string BadMinutes = "Time per workout is 10 to 120 minutes, in steps of 5.";
    public const string UnknownExperience = "Pick an experience: new, some or experienced.";
    public const string NeedsEquipment = "Pick the equipment you have.";
    public const string UnknownEquipment = "Pick equipment from the list.";
    public const string UnknownJoint = "Pick areas to go easy on from the list.";
    public const string UnknownSplit = "Pick a split from the list.";

    /// <summary>Checks the answers and fills in the defaults, or returns the first thing wrong.</summary>
    public static (PlanAnswers? Answers, string? Error) Check(PlanRequest request)
    {
        var goal = request.Goal?.Trim();
        if (goal is null || !PlanGoals.All.Contains(goal))
        {
            return (null, UnknownGoal);
        }

        var days = (request.Weekdays ?? []).Distinct().Order().ToList();
        if (days.Count == 0)
        {
            return (null, NeedsDays);
        }

        if (days.Any(day => day is < 0 or > 6))
        {
            return (null, BadDay);
        }

        if (request.Minutes is not { } minutes || minutes < MinMinutes || minutes > MaxMinutes || minutes % MinuteStep != 0)
        {
            return (null, BadMinutes);
        }

        var experience = request.Experience?.Trim();
        if (experience is null || !Training.Experience.All.Contains(experience))
        {
            return (null, UnknownExperience);
        }

        var equipment = (request.Equipment ?? []).Select(item => item.Trim()).Distinct().ToList();
        if (equipment.Count == 0)
        {
            return (null, NeedsEquipment);
        }

        if (equipment.Any(item => !EquipmentPresets.Holds.ContainsKey(item)))
        {
            return (null, UnknownEquipment);
        }

        var goEasy = (request.GoEasy ?? []).Select(item => item.Trim()).Distinct().ToList();
        if (goEasy.Any(item => !Joints.All.Contains(item)))
        {
            return (null, UnknownJoint);
        }

        var split = string.IsNullOrWhiteSpace(request.Split) ? Splits.For(days.Count, goal) : request.Split.Trim();
        // Hyrox has its own split (or your own); the other goals don't take it.
        if (!Splits.All.Contains(split) || ((split == Splits.Hyrox) != (goal == PlanGoals.Hyrox) && split != Splits.Custom))
        {
            return (null, UnknownSplit);
        }

        // Keep the list's order, so the same answers always store the same way.
        goEasy = Joints.All.Where(goEasy.Contains).ToList();
        var easeIn = request.EaseIn ?? (experience == Training.Experience.New || goEasy.Count > 0);
        return (new PlanAnswers(goal, days, minutes, experience, equipment, goEasy, easeIn, split, request.WarmUp ?? false, request.CoolDown ?? false), null);
    }
}
