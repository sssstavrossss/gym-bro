namespace GymBro.Api.Describe;

/// <summary>
/// "Describe a meal" settings. Without an API key the feature is off: the app hides it and the
/// endpoints say it isn't available. Testing and E2e use <see cref="RuleMealModel"/> and never call Claude.
/// </summary>
public sealed class DescribeOptions
{
    public const string SectionName = "Describe";

    public const string DefaultModel = "claude-haiku-5-5";

    public string ApiKey { get; set; } = "";

    public string Model { get; set; } = DefaultModel;

    /// <summary>Descriptions one person can send in 24 hours. Each one costs two model calls.</summary>
    public int DailyLimit { get; set; } = 40;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);
}
