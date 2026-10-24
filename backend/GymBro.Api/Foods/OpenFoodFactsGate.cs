namespace GymBro.Api.Foods;

/// <summary>
/// Open Food Facts allows 10 search requests a minute per IP. The browser
/// never calls them, so the limit applies to this server's outbound address.
/// Extra searches are refused with the local results instead of being queued,
/// so the caller is not left waiting.
/// </summary>
public sealed class OpenFoodFactsGate(TimeProvider clock)
{
    public const int PermitLimit = 10;

    public static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    private readonly Queue<DateTimeOffset> _hits = new();
    private readonly Lock _gate = new();

    public bool TryEnter()
    {
        lock (_gate)
        {
            var now = clock.GetUtcNow();
            while (_hits.Count > 0 && now - _hits.Peek() >= Window)
            {
                _hits.Dequeue();
            }

            if (_hits.Count >= PermitLimit)
            {
                return false;
            }

            _hits.Enqueue(now);
            return true;
        }
    }
}
