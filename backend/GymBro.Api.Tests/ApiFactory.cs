using GymBro.Api.Foods;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Testcontainers.PostgreSql;

namespace GymBro.Api.Tests;

public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private PostgreSqlContainer? _postgres;
    private int _disposed;

    public ManualTimeProvider Clock { get; } = new();

    public StubOpenFoodFacts Off { get; } = new();

    public ApiFactory()
    {
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Testing");
    }

    public async Task InitializeAsync()
    {
        _postgres = new PostgreSqlBuilder("postgres:17")
            .WithDatabase("gymbro")
            .WithUsername("gymbro")
            .WithPassword("gymbro")
            .Build();
        await _postgres.StartAsync();

        var port = _postgres.GetMappedPublicPort(5432).ToString();
        Environment.SetEnvironmentVariable("Database__Provider", "postgres");
        Environment.SetEnvironmentVariable("Postgres__Host", _postgres.Hostname);
        Environment.SetEnvironmentVariable("Postgres__Port", port);
        Environment.SetEnvironmentVariable("Postgres__Database", "gymbro");
        Environment.SetEnvironmentVariable("Postgres__Username", "gymbro");
        Environment.SetEnvironmentVariable("Postgres__Password", "gymbro");
        Environment.SetEnvironmentVariable("Entra__TenantSubdomain", "test-tenant");
        Environment.SetEnvironmentVariable("Entra__TenantId", "11111111-1111-1111-1111-111111111111");
        Environment.SetEnvironmentVariable("Entra__SpaClientId", "22222222-2222-2222-2222-222222222222");
        Environment.SetEnvironmentVariable("Entra__ApiClientId", "33333333-3333-3333-3333-333333333333");
        Environment.SetEnvironmentVariable("Foods__OpenFoodFactsUserAgent", "GymBroTests/1.0 (api tests)");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        if (_postgres is not null)
        {
            builder.UseSetting("Database:Provider", "postgres");
            builder.UseSetting("Postgres:Host", _postgres.Hostname);
            builder.UseSetting("Postgres:Port", _postgres.GetMappedPublicPort(5432).ToString());
            builder.UseSetting("Postgres:Database", "gymbro");
            builder.UseSetting("Postgres:Username", "gymbro");
            builder.UseSetting("Postgres:Password", "gymbro");
            builder.UseSetting("Foods:OpenFoodFactsUserAgent", "GymBroTests/1.0 (api tests)");
        }

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Clock);
            services.RemoveAll<IOpenFoodFactsClient>();
            services.AddSingleton<IOpenFoodFactsClient>(Off);

            services.AddAuthentication(options =>
            {
                options.DefaultAuthenticateScheme = TestAuthHandler.SchemeName;
                options.DefaultChallengeScheme = TestAuthHandler.SchemeName;
            }).AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.SchemeName, _ => { });
        });
    }

    async Task IAsyncLifetime.DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 1)
        {
            return;
        }

        await base.DisposeAsync();
        if (_postgres is not null)
        {
            await _postgres.DisposeAsync();
        }
    }
}

public sealed class StubOpenFoodFacts : IOpenFoodFactsClient
{
    public int Calls { get; set; }

    public string? LastQuery { get; set; }

    public OffStatus Status { get; set; } = OffStatus.Ok;

    public IReadOnlyList<ParsedFood> Foods { get; set; } = [];

    public Task<OffSearchOutcome> SearchAsync(string query, CancellationToken cancellationToken)
    {
        Calls++;
        LastQuery = query;
        return Task.FromResult(new OffSearchOutcome(Status, Foods));
    }

    public void Reset()
    {
        Calls = 0;
        LastQuery = null;
        Status = OffStatus.Ok;
        Foods = [];
    }
}

[CollectionDefinition(ApiCollection.Name)]
public sealed class ApiCollection : ICollectionFixture<ApiFactory>
{
    public const string Name = "api";
}
