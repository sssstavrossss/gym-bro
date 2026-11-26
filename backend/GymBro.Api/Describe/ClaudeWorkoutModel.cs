using System.Text.Json;
using GymBro.Api.Training;

namespace GymBro.Api.Describe;

/// <summary>
/// <see cref="IWorkoutModel"/> on the Claude API: one call with the library's exercise ids and a schema for the
/// exercises and their sets. Claude copies the numbers the words give and never adds a weight.
/// </summary>
public sealed class ClaudeWorkoutModel(ClaudeAsk claude) : IWorkoutModel
{
    public string Name => claude.Model;

    private const string Instructions = """
        You turn someone's description of a workout they did into the exercises and sets for a training log.
        The words may be short and loose ("bench 3x8 60, then pullups 3 sets of 10, 5k run 26 min"), and in
        English or another language.

        - exercises: in the order done. For each:
          - name: the exercise as the words name it, short ("bench", "5k run").
          - exerciseId: the id from the list below that is this exercise. Pick the plainest match: "bench" is
            barbell-bench-press-medium-grip, "squat" is barbell-squat, "pull-ups" is pullups, "run" is run,
            "row" on a machine is rowing-stationary. Use "" when nothing in the list is this exercise. Never
            invent an id.
          - superset: true when it was done as a superset or circuit with the exercise before it. The first
            exercise of a superset is false, and so is anything done on its own.
          - sets: one entry per set. "3x8" or "3 sets of 8" is three sets of 8 reps; "5/5/3" is three sets.
            For each set:
            - kg: the weight the words give for it, in kilograms (pounds × 0.4536). Null when the words give
              no weight. Never estimate or suggest a weight.
            - reps: the reps, or null.
            - seconds: a hold's or a run's time in seconds ("26 min" is 1560, "1:30" is 90), or null.
            - metres: a distance in metres ("5k" or "5 km" is 5000, "500m" is 500), or null.
          When the words name an exercise without sets, give no sets.
        Copy the numbers the words give. Don't add exercises, sets or values the words don't have.
        Words that aren't about exercise give no exercises.

        The exercise ids:
        """;

    // The instructions and every id in the library, one per line. Built once per library.
    private (ExerciseLibrary Library, string Text)? system;

    private string SystemFor(ExerciseLibrary library)
    {
        if (system is { } built && ReferenceEquals(built.Library, library))
        {
            return built.Text;
        }

        var text = Instructions + "\n" + string.Join("\n", library.All.Select(item => item.Id).Order(StringComparer.Ordinal));
        system = (library, text);
        return text;
    }

    public async Task<IReadOnlyList<WorkoutPart>> ReadAsync(string text, ExerciseLibrary library, MealUsage usage, CancellationToken cancellationToken)
    {
        var json = await claude.AskAsync(SystemFor(library), text, Schema, 2048, usage, cancellationToken);
        return Read(json);
    }

    public static IReadOnlyList<WorkoutPart> Read(JsonElement json) =>
        [.. json.GetProperty("exercises").EnumerateArray().Select(item => new WorkoutPart(
            item.GetProperty("name").GetString() ?? "",
            item.GetProperty("exerciseId").GetString(),
            item.GetProperty("superset").GetBoolean(),
            [.. item.GetProperty("sets").EnumerateArray().Select(set => new WorkoutPartSet(
                Number(set, "kg"),
                (int?)Number(set, "reps"),
                (int?)Number(set, "seconds"),
                Number(set, "metres")))]))];

    private static decimal? Number(JsonElement json, string name) =>
        json.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number)
            ? Math.Round(number, 2)
            : null;

    private static readonly Dictionary<string, JsonElement> Schema = ClaudeAsk.Schema("""
        {
          "type": "object",
          "properties": {
            "exercises": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "name": { "type": "string" },
                  "exerciseId": { "type": "string" },
                  "superset": { "type": "boolean" },
                  "sets": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "kg": { "type": ["number", "null"] },
                        "reps": { "type": ["integer", "null"] },
                        "seconds": { "type": ["integer", "null"] },
                        "metres": { "type": ["number", "null"] }
                      },
                      "required": ["kg", "reps", "seconds", "metres"],
                      "additionalProperties": false
                    }
                  }
                },
                "required": ["name", "exerciseId", "superset", "sets"],
                "additionalProperties": false
              }
            }
          },
          "required": ["exercises"],
          "additionalProperties": false
        }
        """);
}
