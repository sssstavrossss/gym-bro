using GymBro.Api.Data;

namespace GymBro.Api.Training;

/// <summary>
/// Your training: the answers every new plan starts from, saved on the account (README, Your training). The goal and
/// the days stay with each plan. Making or editing a plan saves its answers here too, so the two agree.
/// </summary>
public sealed record TrainingSettings(int Minutes, string Experience, IReadOnlyList<string> Equipment, IReadOnlyList<string> GoEasy, bool WarmUp, bool CoolDown)
{
    /// <summary>The profile's, or null until first saved.</summary>
    public static TrainingSettings? Of(Profile profile) =>
        profile.TrainingMinutes is { } minutes && profile.TrainingExperience is { } experience
            ? new(minutes, experience, profile.TrainingEquipment ?? [], profile.TrainingGoEasy ?? [], profile.TrainingWarmUp ?? false, profile.TrainingCoolDown ?? false)
            : null;

    /// <summary>A plan's answers, as they're kept for the next plan.</summary>
    public static TrainingSettings From(PlanAnswers answers) =>
        new(answers.Minutes, answers.Experience, answers.Equipment, answers.GoEasy, answers.WarmUp, answers.CoolDown);

    /// <summary>Checks what the app sends, or returns the first thing wrong (the plan's own messages).</summary>
    public static (TrainingSettings? Settings, string? Error) Check(TrainingSettingsRequest request)
    {
        var (kit, error) = PlanRules.CheckKit(request.Minutes, request.Experience, request.Equipment, request.GoEasy);
        return kit is { } checkedKit
            ? (new(checkedKit.Minutes, checkedKit.Experience, checkedKit.Equipment, checkedKit.GoEasy, request.WarmUp ?? false, request.CoolDown ?? false), null)
            : (null, error);
    }

    public void SaveTo(Profile profile)
    {
        profile.TrainingMinutes = Minutes;
        profile.TrainingExperience = Experience;
        profile.TrainingEquipment = [.. Equipment];
        profile.TrainingGoEasy = [.. GoEasy];
        profile.TrainingWarmUp = WarmUp;
        profile.TrainingCoolDown = CoolDown;
    }
}

/// <summary>Your training, as the app sends it: every field, each time.</summary>
public sealed class TrainingSettingsRequest
{
    public int? Minutes { get; set; }

    public string? Experience { get; set; }

    public List<string>? Equipment { get; set; }

    public List<string>? GoEasy { get; set; }

    public bool? WarmUp { get; set; }

    public bool? CoolDown { get; set; }
}
