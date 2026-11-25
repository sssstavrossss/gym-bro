using System.Runtime.CompilerServices;
using GymBro.Api.Training;

namespace GymBro.Api.Tests;

/// <summary>The photos come from the same free-exercise-db commit as the library, at the paths the API names.</summary>
public sealed class ExercisePhotoTests
{
    [Fact]
    public void The_photo_script_fetches_the_commit_the_library_is_pinned_to()
    {
        var script = File.ReadAllText(Path.Combine(RepoRoot(), "tools", "exercise-photos", "build.sh"));
        Assert.Contains($"commit={ExerciseCatalog.FreeExerciseDbCommit}\n", script, StringComparison.Ordinal);
        Assert.Equal("/exercise-photos/f00c92c", ExerciseCatalog.PhotoBase);
    }

    [Fact]
    public void The_image_copies_the_photos_where_the_app_serves_them()
    {
        var dockerfile = File.ReadAllText(Path.Combine(RepoRoot(), "Dockerfile"));
        Assert.Contains("RUN sh /build.sh /photos", dockerfile, StringComparison.Ordinal);
        Assert.Contains($"COPY --from=photos /photos wwwroot{ExerciseCatalog.PhotosPath}", dockerfile, StringComparison.Ordinal);
    }

    [Fact]
    public void Source_photo_paths_are_the_exercise_folder_and_a_number_from_zero()
    {
        // build.sh writes <id>/<n>.webp from <source id>/<n>.jpg, so the count is all the app needs.
        var source = System.Text.Json.JsonSerializer.Deserialize<List<SourcePhotos>>(
            File.ReadAllText(Path.Combine(RepoRoot(), "backend", "GymBro.Api", "Training", "free-exercise-db.json")),
            new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        Assert.All(source, item =>
        {
            Assert.Equal(item.Images.Select((_, index) => $"{item.Id}/{index}.jpg"), item.Images);
            Assert.Equal(item.Images.Count, ExerciseCatalog.Current.Find(ExerciseCatalog.IdFrom(item.Id))!.Images);
        });
    }

    private sealed record SourcePhotos(string Id, IReadOnlyList<string> Images);

    /// <summary>Up from this source file, or from the test binaries when the build maps source paths.</summary>
    private static string RepoRoot([CallerFilePath] string here = "")
    {
        foreach (var start in new[] { Path.GetDirectoryName(here), AppContext.BaseDirectory })
        {
            for (var dir = start; !string.IsNullOrEmpty(dir); dir = Path.GetDirectoryName(dir))
            {
                if (File.Exists(Path.Combine(dir, "Dockerfile")) && Directory.Exists(Path.Combine(dir, "tools")))
                {
                    return dir;
                }
            }
        }

        throw new InvalidOperationException("The repository root was not found.");
    }
}
