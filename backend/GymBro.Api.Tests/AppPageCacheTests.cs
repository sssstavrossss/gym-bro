using System.Net;
using Microsoft.AspNetCore.Hosting;

namespace GymBro.Api.Tests;

/// <summary>
/// The page must be revalidated at every address the app opens at. A page kept from the last deploy asks for
/// scripts the new container doesn't have, and the Home Screen app opens blank.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class AppPageCacheTests(ApiFactory factory) : IDisposable
{
    private readonly string _webRoot = Directory.CreateTempSubdirectory("gymbro-webroot-").FullName;

    [Theory]
    [InlineData("/")]
    [InlineData("/index.html")]
    [InlineData("/today")]
    [InlineData("/train")]
    [InlineData("/sw.js")]
    public async Task The_page_and_the_service_worker_are_revalidated(string path)
    {
        using var client = Site().CreateClient();

        using var response = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoCache, $"{path} has Cache-Control: {response.Headers.CacheControl}");
    }

    [Fact]
    public async Task Fingerprinted_files_are_not_marked_no_cache()
    {
        using var client = Site().CreateClient();

        using var response = await client.GetAsync("/assets/index-abc123.js");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotEqual(true, response.Headers.CacheControl?.NoCache);
    }

    private Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> Site()
    {
        File.WriteAllText(Path.Combine(_webRoot, "index.html"), "<!doctype html><title>Gym Bro</title>");
        File.WriteAllText(Path.Combine(_webRoot, "sw.js"), "// worker");
        Directory.CreateDirectory(Path.Combine(_webRoot, "assets"));
        File.WriteAllText(Path.Combine(_webRoot, "assets", "index-abc123.js"), "// app");
        return factory.WithWebHostBuilder(builder => builder.UseWebRoot(_webRoot));
    }

    public void Dispose() => Directory.Delete(_webRoot, recursive: true);
}
