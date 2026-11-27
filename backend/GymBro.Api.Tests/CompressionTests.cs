using System.IO.Compression;
using System.Net;
using System.Text.Json;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class CompressionTests(ApiFactory factory)
{
    [Theory]
    [InlineData("br", "br")]
    [InlineData("gzip", "gzip")]
    [InlineData("gzip, deflate, br", "br")]
    public async Task Json_answers_are_compressed_when_asked_also_behind_an_https_proxy(string accept, string expected)
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/health");
        request.Headers.TryAddWithoutValidation("Accept-Encoding", accept);
        request.Headers.TryAddWithoutValidation("X-Forwarded-Proto", "https");

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(expected, Assert.Single(response.Content.Headers.ContentEncoding));
        await using var raw = await response.Content.ReadAsStreamAsync();
        await using Stream body = expected == "br" ? new BrotliStream(raw, CompressionMode.Decompress) : new GZipStream(raw, CompressionMode.Decompress);
        var json = await JsonSerializer.DeserializeAsync<JsonElement>(body);
        Assert.Equal("ok", json.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Without_accept_encoding_the_answer_is_plain()
    {
        using var response = await factory.CreateClient().GetAsync("/api/health");
        Assert.Empty(response.Content.Headers.ContentEncoding);
    }
}
