using System.Net;
using System.Net.Sockets;
using System.Text;

namespace GymBro.Api.Describe;

/// <summary>Reads a recipe page for "Import a recipe". Tests and E2e use <see cref="RulePageFetcher"/>.</summary>
public interface IRecipePageFetcher
{
    /// <summary>The page's HTML, or null when it couldn't be read (blocked, unreachable, too big, not a page).</summary>
    Task<string?> FetchAsync(Uri url, CancellationToken cancellationToken);
}

/// <summary>
/// Fetches a page someone pasted a link to, from the public internet only. The server is reachable on a private
/// network, so a link must never make it fetch something inside one: every address a host name resolves to is
/// checked when the connection is made (so a name can't resolve to a public address for a check and a private one
/// for the fetch), redirects are followed by hand and checked again, only ports 80 and 443 are used, no proxy is
/// used, and a page is read for at most 10 seconds and 2 MB.
/// </summary>
public sealed class PublicPageFetcher(ILogger<PublicPageFetcher> logger) : IRecipePageFetcher
{
    public const int MaxBytes = 2_000_000;

    public const int MaxRedirects = 4;

    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

    private static readonly HttpClient Client = CreateClient();

    public async Task<string?> FetchAsync(Uri url, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Timeout);
        try
        {
            var current = url;
            for (var hop = 0; hop <= MaxRedirects; hop++)
            {
                if (!Allowed(current))
                {
                    return null;
                }

                using var request = new HttpRequestMessage(HttpMethod.Get, current);
                using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
                if ((int)response.StatusCode is >= 300 and < 400 && response.Headers.Location is { } location)
                {
                    current = location.IsAbsoluteUri ? location : new Uri(current, location);
                    continue;
                }

                if (response.StatusCode != HttpStatusCode.OK || !IsPage(response.Content.Headers.ContentType?.MediaType))
                {
                    return null;
                }

                if (response.Content.Headers.ContentLength > MaxBytes)
                {
                    return null;
                }

                return await ReadAsync(response, timeout.Token);
            }

            return null;
        }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or IOException or SocketException or InvalidOperationException)
        {
            if (cancellationToken.IsCancellationRequested)
            {
                throw;
            }

            logger.LogInformation("Recipe page {Host} couldn't be read: {Error}", url.Host, ex.GetType().Name);
            return null;
        }
    }

    /// <summary>http or https on its usual port, with a host name or address (checked again when connecting).</summary>
    public static bool Allowed(Uri url) =>
        url.IsAbsoluteUri
        && (url.Scheme == Uri.UriSchemeHttps || url.Scheme == Uri.UriSchemeHttp)
        && url.IsDefaultPort
        && string.IsNullOrEmpty(url.UserInfo)
        && url.Host.Length > 0;

    private static bool IsPage(string? mediaType) =>
        mediaType is null or "text/html" or "application/xhtml+xml";

    private static async Task<string?> ReadAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > MaxBytes)
            {
                return null;
            }

            buffer.Write(chunk, 0, read);
        }

        var encoding = Encoding.UTF8;
        if (response.Content.Headers.ContentType?.CharSet is { Length: > 0 } charset)
        {
            try
            {
                encoding = Encoding.GetEncoding(charset.Trim('"'));
            }
            catch (ArgumentException)
            {
                encoding = Encoding.UTF8;
            }
        }

        return encoding.GetString(buffer.GetBuffer(), 0, (int)buffer.Length);
    }

    private static HttpClient CreateClient()
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseProxy = false,
            UseCookies = false,
            AutomaticDecompression = DecompressionMethods.All,
            PooledConnectionLifetime = TimeSpan.FromMinutes(2),
            ConnectTimeout = TimeSpan.FromSeconds(5),
            MaxResponseHeadersLength = 64,
            ConnectCallback = ConnectAsync,
        };
        var client = new HttpClient(handler) { Timeout = System.Threading.Timeout.InfiniteTimeSpan };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (compatible; GymBro recipe import)");
        client.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/xhtml+xml");
        return client;
    }

    /// <summary>Connects only to a public address the host resolves to, so the check and the connection are the same address.</summary>
    private static async ValueTask<Stream> ConnectAsync(SocketsHttpConnectionContext context, CancellationToken cancellationToken)
    {
        var endpoint = context.DnsEndPoint;
        var addresses = IPAddress.TryParse(endpoint.Host, out var literal)
            ? [literal]
            : await Dns.GetHostAddressesAsync(endpoint.Host, cancellationToken);
        var usable = addresses.Where(PublicAddress.IsPublic).ToList();
        if (usable.Count == 0 || usable.Count != addresses.Length)
        {
            throw new HttpRequestException($"{endpoint.Host} is not a public address.");
        }

        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(usable.ToArray(), endpoint.Port, cancellationToken);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }
}

/// <summary>Which addresses count as the public internet: not loopback, private, link-local, shared (Tailscale's 100.64/10), or reserved.</summary>
public static class PublicAddress
{
    public static bool IsPublic(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = address.GetAddressBytes();
            return !(b[0] == 0
                || b[0] == 10
                || b[0] == 127
                || (b[0] == 100 && b[1] >= 64 && b[1] <= 127)
                || (b[0] == 169 && b[1] == 254)
                || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
                || (b[0] == 192 && b[1] == 0 && b[2] == 0)
                || (b[0] == 192 && b[1] == 0 && b[2] == 2)
                || (b[0] == 192 && b[1] == 168)
                || (b[0] == 198 && (b[1] == 18 || b[1] == 19))
                || (b[0] == 198 && b[1] == 51 && b[2] == 100)
                || (b[0] == 203 && b[1] == 0 && b[2] == 113)
                || b[0] >= 224);
        }

        if (address.AddressFamily != AddressFamily.InterNetworkV6)
        {
            return false;
        }

        var v6 = address.GetAddressBytes();
        // Global unicast is 2000::/3. Inside it: documentation (2001:db8::/32), 6to4 (2002::/16, which wraps a v4
        // address) and Teredo (2001::/32) are refused. Everything outside it (loopback, link-local, unique local such
        // as Tailscale's fd7a::, multicast, NAT64's 64:ff9b::) is not public.
        if ((v6[0] & 0xE0) != 0x20)
        {
            return false;
        }

        return !((v6[0] == 0x20 && v6[1] == 0x01 && v6[2] == 0x0d && v6[3] == 0xb8)
            || (v6[0] == 0x20 && v6[1] == 0x02)
            || (v6[0] == 0x20 && v6[1] == 0x01 && v6[2] == 0x00 && v6[3] == 0x00));
    }
}

/// <summary>
/// A stand-in in Testing and E2e: every link is the same fictional recipe page, and a link whose path ends in
/// <c>/no-recipe</c> is a page without one. Nothing leaves the machine.
/// </summary>
public sealed class RulePageFetcher : IRecipePageFetcher
{
    public const string Page = """
        <html><head><title>Fictional test stew</title>
        <script type="application/ld+json">
        {"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"Fictional test stew"},
         {"@type":"Recipe","name":"Fictional test stew &amp; rice","recipeYield":["4","4 porsjoner"],
          "recipeIngredient":["400 g fictional stew chicken","<b>200 g</b> fictional stew rice","1 klype fictional spice"]}]}
        </script></head><body>Not the recipe.</body></html>
        """;

    public Task<string?> FetchAsync(Uri url, CancellationToken cancellationToken) =>
        Task.FromResult<string?>(url.AbsolutePath.EndsWith("/no-recipe", StringComparison.Ordinal) ? "<html><body>No recipe here.</body></html>" : Page);
}
