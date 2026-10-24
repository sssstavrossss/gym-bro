using System.Net;
using System.Text;
using GymBro.Api.Configuration;
using GymBro.Api.Foods;
using Microsoft.Extensions.Options;

namespace GymBro.Api.Tests;

public sealed class OpenFoodFactsTests
{
    [Fact]
    public void Parser_keeps_label_kcal_and_skips_products_without_it()
    {
        var foods = OpenFoodFactsParser.Read("""
            {
              "products": [
                {
                  "code": "0000000000017",
                  "product_name": "Fictional crunch bar",
                  "nutrition_data_per": "100g",
                  "serving_quantity": "40",
                  "serving_size": "1 bar (40 g)",
                  "nutriments": {
                    "energy-kcal_100g": 100,
                    "proteins_100g": 10,
                    "fat_100g": 10,
                    "carbohydrates_100g": 10
                  }
                },
                {
                  "code": "0000000000024",
                  "product_name": "Fictional no label",
                  "nutriments": { "proteins_100g": 10, "fat_100g": 10, "carbohydrates_100g": 10 }
                }
              ]
            }
            """);

        var food = Assert.Single(foods);
        Assert.Equal("off", food.Source);
        Assert.Equal("0000000000017", food.Barcode);
        Assert.Equal(100, food.KcalPer100);
        Assert.NotEqual(170, food.KcalPer100);
        Assert.Equal(40, food.ServingQuantity);
    }

    [Fact]
    public async Task Gate_allows_ten_searches_a_minute_and_then_refuses()
    {
        var clock = new ManualTimeProvider { UtcNow = new DateTimeOffset(2026, 10, 24, 8, 0, 0, TimeSpan.Zero) };
        var handler = new ScriptedHandler();
        using var http = new HttpClient(handler);
        http.DefaultRequestHeaders.UserAgent.ParseAdd("GymBroTests/1.0 (api tests)");
        var client = new OpenFoodFactsClient(http, new OpenFoodFactsGate(clock), Options.Create(new FoodOptions()));

        for (var i = 0; i < OpenFoodFactsGate.PermitLimit; i++)
        {
            var ok = await client.SearchAsync("oats", CancellationToken.None);
            Assert.Equal(OffStatus.Ok, ok.Status);
        }

        var limited = await client.SearchAsync("oats", CancellationToken.None);
        Assert.Equal(OffStatus.RateLimited, limited.Status);
        Assert.Equal(OpenFoodFactsGate.PermitLimit, handler.Calls);
        Assert.Equal("GymBroTests/1.0 (api tests)", handler.Agents[0]);

        clock.UtcNow = clock.UtcNow.Add(OpenFoodFactsGate.Window);
        var again = await client.SearchAsync("oats", CancellationToken.None);
        Assert.Equal(OffStatus.Ok, again.Status);
        Assert.Equal(OpenFoodFactsGate.PermitLimit + 1, handler.Calls);
    }

    [Fact]
    public async Task Http_429_and_server_errors_are_reported_without_throwing()
    {
        var clock = new ManualTimeProvider();
        var limited = new ScriptedHandler
        {
            Respond = _ => new HttpResponseMessage(HttpStatusCode.TooManyRequests),
        };
        using var limitedHttp = new HttpClient(limited);
        var client = new OpenFoodFactsClient(limitedHttp, new OpenFoodFactsGate(clock), Options.Create(new FoodOptions()));
        Assert.Equal(OffStatus.RateLimited, (await client.SearchAsync("oats", CancellationToken.None)).Status);

        var down = new ScriptedHandler
        {
            Respond = _ => new HttpResponseMessage(HttpStatusCode.InternalServerError),
        };
        using var downHttp = new HttpClient(down);
        var other = new OpenFoodFactsClient(downHttp, new OpenFoodFactsGate(clock), Options.Create(new FoodOptions()));
        Assert.Equal(OffStatus.Unavailable, (await other.SearchAsync("oats", CancellationToken.None)).Status);
    }

    [Fact]
    public async Task An_oversized_response_is_unavailable()
    {
        var advertised = new ScriptedHandler
        {
            Respond = _ =>
            {
                var message = new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("""{"products":[]}""", Encoding.UTF8, "application/json"),
                };
                message.Content.Headers.ContentLength = OpenFoodFactsClient.MaxResponseBytes + 1;
                return message;
            },
        };
        using var http = new HttpClient(advertised);
        var client = new OpenFoodFactsClient(http, new OpenFoodFactsGate(new ManualTimeProvider()), Options.Create(new FoodOptions()));
        Assert.Equal(OffStatus.Unavailable, (await client.SearchAsync("oats", CancellationToken.None)).Status);

        var streamed = new ScriptedHandler
        {
            Respond = _ => new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StreamContent(new UnboundedStream(OpenFoodFactsClient.MaxResponseBytes + 8)),
            },
        };
        using var streamedHttp = new HttpClient(streamed);
        var streamedClient = new OpenFoodFactsClient(streamedHttp, new OpenFoodFactsGate(new ManualTimeProvider()), Options.Create(new FoodOptions()));
        Assert.Equal(OffStatus.Unavailable, (await streamedClient.SearchAsync("oats", CancellationToken.None)).Status);
    }

    private sealed class UnboundedStream(int bytes) : Stream
    {
        private int _left = bytes;

        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override void Flush()
        {
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            if (_left == 0)
            {
                return 0;
            }

            var n = Math.Min(count, _left);
            Array.Fill(buffer, (byte)' ', offset, n);
            _left -= n;
            return n;
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    private sealed class ScriptedHandler : HttpMessageHandler
    {
        public int Calls { get; private set; }

        public List<string> Agents { get; } = [];

        public Func<int, HttpResponseMessage> Respond { get; set; } = _ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("""{"products":[]}""", Encoding.UTF8, "application/json"),
        };

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            Agents.Add(request.Headers.UserAgent.ToString());
            return Task.FromResult(Respond(Calls));
        }
    }
}
