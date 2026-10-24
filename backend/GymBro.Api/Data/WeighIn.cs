namespace GymBro.Api.Data;

/// <summary>One weigh-in per person per local date. Kilograms, one decimal.</summary>
public sealed class WeighIn
{
    public Guid Id { get; set; }

    public string UserId { get; set; } = "";

    public DateOnly LocalDate { get; set; }

    public decimal Kg { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
