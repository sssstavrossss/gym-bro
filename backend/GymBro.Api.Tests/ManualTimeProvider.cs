namespace GymBro.Api.Tests;

public sealed class ManualTimeProvider : TimeProvider
{
    public DateTimeOffset UtcNow { get; set; } = new(2026, 4, 1, 8, 0, 0, TimeSpan.Zero);

    public override DateTimeOffset GetUtcNow() => UtcNow;
}
