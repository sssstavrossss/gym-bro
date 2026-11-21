using System.Globalization;

namespace GymBro.Api.Describe;

/// <summary>
/// What the person sent: their words, a photo of the meal, or both. <see cref="Text"/> is trimmed and may be
/// empty. <see cref="Time"/> is the phone's local time when it was sent, a hint for the meal and its size.
/// </summary>
public sealed record MealNote(string Text, MealPhoto? Photo = null, TimeOnly? Time = null)
{
    /// <summary>"07:40" as a time, or null for anything else: the time is only a hint, so a bad one is dropped.</summary>
    public static TimeOnly? ReadTime(string? time) =>
        TimeOnly.TryParseExact(time?.Trim(), "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed) ? parsed : null;

    /// <summary>
    /// The note as the pick step reads it. Only the split sees the photo itself; by then each food has a
    /// phrase saying what was seen, so the pick needs only to know the note was a photo.
    /// </summary>
    public string ForPick => Photo is null
        ? Text
        : Text.Length > 0 ? $"A photo of the meal, with the words: {Text}" : "A photo of the meal.";
}

/// <summary>A photo of a meal, as sent: an image type and its bytes. It is passed to the model and not kept.</summary>
public sealed record MealPhoto(string MediaType, byte[] Data)
{
    /// <summary>
    /// The largest photo taken, in bytes. The app shrinks a photo to about 1,500 px before sending it,
    /// which is a few hundred KB; this leaves room and stays under Claude's 5 MB per image once base64 encoded.
    /// </summary>
    public const int MaxBytes = 3_500_000;

    public const string Unreadable = "That photo couldn't be read. Try another one.";

    public const string TooLarge = "That photo is too large. Try another one.";

    /// <summary>
    /// The photo from a request, or why it can't be used. The bytes must match the type they claim,
    /// so only JPEG, PNG and WebP reach the model.
    /// </summary>
    public static (MealPhoto? Photo, string? Error) Read(string? mediaType, string? base64)
    {
        if (string.IsNullOrEmpty(base64))
        {
            return (null, Unreadable);
        }

        // Base64 is 4 characters for every 3 bytes: refuse a large one before decoding it.
        if (base64.Length / 4L * 3 > MaxBytes + 3)
        {
            return (null, TooLarge);
        }

        byte[] data;
        try
        {
            data = Convert.FromBase64String(base64);
        }
        catch (FormatException)
        {
            return (null, Unreadable);
        }

        if (data.Length > MaxBytes)
        {
            return (null, TooLarge);
        }

        var type = (mediaType ?? "").Trim().ToLowerInvariant();
        return Matches(type, data) ? (new MealPhoto(type, data), null) : (null, Unreadable);
    }

    private static bool Matches(string type, byte[] data) => type switch
    {
        "image/jpeg" => data is [0xFF, 0xD8, 0xFF, ..],
        "image/png" => data is [0x89, (byte)'P', (byte)'N', (byte)'G', ..],
        "image/webp" => data.Length >= 12 && data[..4] is [(byte)'R', (byte)'I', (byte)'F', (byte)'F'] && data[8..12] is [(byte)'W', (byte)'E', (byte)'B', (byte)'P'],
        _ => false,
    };
}
