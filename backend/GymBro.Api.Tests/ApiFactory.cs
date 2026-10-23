using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace GymBro.Api.Tests;

public sealed class ApiFactory : WebApplicationFactory<Program>
{
    public ManualTimeProvider Clock { get; } = new();

    private readonly string _databaseFile = Path.Combine(Path.GetTempPath(), $"gymbro-{Guid.NewGuid():N}.db");

    public ApiFactory()
    {
        // Set before the host starts so Program skips .env and uses SQLite.
        Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Testing");
        Environment.SetEnvironmentVariable("Database__Provider", "sqlite");
        Environment.SetEnvironmentVariable("Database__Sqlite", $"Data Source={_databaseFile}");
        Environment.SetEnvironmentVariable("Entra__TenantSubdomain", "test-tenant");
        Environment.SetEnvironmentVariable("Entra__TenantId", "11111111-1111-1111-1111-111111111111");
        Environment.SetEnvironmentVariable("Entra__SpaClientId", "22222222-2222-2222-2222-222222222222");
        Environment.SetEnvironmentVariable("Entra__ApiClientId", "33333333-3333-3333-3333-333333333333");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Clock);

            services.AddAuthentication(options =>
            {
                options.DefaultAuthenticateScheme = TestAuthHandler.SchemeName;
                options.DefaultChallengeScheme = TestAuthHandler.SchemeName;
            }).AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.SchemeName, _ => { });
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        TryDelete(_databaseFile);
        TryDelete(_databaseFile + "-wal");
        TryDelete(_databaseFile + "-shm");
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (IOException)
        {
            // The host may still be releasing the file. The temp directory can keep it.
        }
    }
}

[CollectionDefinition(ApiCollection.Name)]
public sealed class ApiCollection : ICollectionFixture<ApiFactory>
{
    public const string Name = "api";
}
