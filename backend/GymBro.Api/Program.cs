using System.Net.Http.Headers;
using GymBro.Api.Auth;
using GymBro.Api.Configuration;
using GymBro.Api.Data;
using GymBro.Api.Endpoints;
using GymBro.Api.Foods;
using GymBro.Api.Hosting;
using GymBro.Api.Users;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;

EnvFile.Load();

var builder = WebApplication.CreateBuilder(args);
var testing = builder.Environment.IsEnvironment("Testing");
var e2e = builder.Environment.IsEnvironment("E2e");

builder.Services.Configure<EntraOptions>(builder.Configuration.GetSection(EntraOptions.SectionName));
builder.Services.Configure<PostgresOptions>(builder.Configuration.GetSection(PostgresOptions.SectionName));
builder.Services.Configure<FoodOptions>(builder.Configuration.GetSection(FoodOptions.SectionName));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<UserDirectory>();
builder.Services.AddScoped<MatvaretabellenImporter>();
builder.Services.AddScoped<WeeklyTargetRecalculator>();
builder.Services.AddSingleton<OpenFoodFactsGate>();
builder.Services.AddHttpClient<IOpenFoodFactsClient, OpenFoodFactsClient>((serviceProvider, client) =>
{
    var foods = serviceProvider.GetRequiredService<Microsoft.Extensions.Options.IOptions<FoodOptions>>().Value;
    var agent = string.IsNullOrWhiteSpace(foods.OpenFoodFactsUserAgent)
        ? FoodOptions.DefaultUserAgent
        : foods.OpenFoodFactsUserAgent;
    client.Timeout = TimeSpan.FromSeconds(8);
    client.DefaultRequestHeaders.UserAgent.ParseAdd(agent);
    client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
});
builder.Services.AddHttpClient("matvaretabellen", client =>
{
    client.Timeout = TimeSpan.FromMinutes(2);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("GymBro/1.0 (self-hosted; Matvaretabellen import)");
    client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
});
if (!testing && !e2e)
{
    builder.Services.AddHostedService<WeeklyTargetHostedService>();
}

var database = builder.Configuration.GetSection(DatabaseOptions.SectionName).Get<DatabaseOptions>() ?? new DatabaseOptions();
var postgres = builder.Configuration.GetSection(PostgresOptions.SectionName).Get<PostgresOptions>() ?? new PostgresOptions();

builder.Services.AddDbContext<AppDbContext>(options =>
{
    if (string.Equals(database.Provider, "sqlite", StringComparison.OrdinalIgnoreCase))
    {
        options.UseSqlite(database.Sqlite);
    }
    else
    {
        options.UseNpgsql(postgres.ToConnectionString());
    }
});

if (e2e)
{
    var enabled = builder.Configuration["E2E_AUTH"];
    if (!string.Equals(enabled, "true", StringComparison.OrdinalIgnoreCase))
    {
        throw new InvalidOperationException(
            "The E2e environment refuses to start unless E2E_AUTH=true. Do not use E2e for a real deployment.");
    }

    if (string.IsNullOrEmpty(postgres.Password))
    {
        throw new InvalidOperationException(
            "Set POSTGRES_PASSWORD in .env (or Postgres__Password) before starting the API.");
    }

    builder.Services.AddAuthentication(E2eAuthHandler.SchemeName)
        .AddScheme<Microsoft.AspNetCore.Authentication.AuthenticationSchemeOptions, E2eAuthHandler>(
            E2eAuthHandler.SchemeName,
            _ => { });
}
else if (!testing)
{
    var entra = builder.Configuration.GetSection(EntraOptions.SectionName).Get<EntraOptions>() ?? new EntraOptions();
    entra.EnsureConfigured();
    if (string.IsNullOrEmpty(postgres.Password))
    {
        throw new InvalidOperationException(
            "Set POSTGRES_PASSWORD in .env (or Postgres__Password) before starting the API.");
    }

    builder.AddEntraExternalId(entra);
}

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy(ApiAccess.PolicyName, policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.RequireAssertion(context => ApiAccess.HasAcceptedScope(context.User));
    });
});

// TLS stops at the reverse proxy (Tailscale serve). The app is plain HTTP.
// Forwarded headers restore the original https scheme and host. The known-proxy
// list is cleared so the local proxy is trusted. Keep the host publish on
// loopback: any client that can connect could otherwise spoof those headers.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders =
        ForwardedHeaders.XForwardedFor |
        ForwardedHeaders.XForwardedProto |
        ForwardedHeaders.XForwardedHost;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

if (!testing && string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ASPNETCORE_URLS")))
{
    var address = builder.Configuration["BIND_ADDRESS"];
    if (string.IsNullOrWhiteSpace(address))
    {
        address = "127.0.0.1";
    }

    var port = builder.Configuration["BIND_PORT"];
    if (string.IsNullOrWhiteSpace(port))
    {
        port = "8100";
    }

    builder.WebHost.UseUrls($"http://{address}:{port}");
}

var app = builder.Build();

app.UseForwardedHeaders();

if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
}

app.UseAuthentication();
app.UseAuthorization();

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        // Vite fingerprints JS and CSS. index.html must be revalidated so a
        // new container is picked up without a hard refresh.
        if (context.File.Name.Equals("index.html", StringComparison.OrdinalIgnoreCase))
        {
            context.Context.Response.Headers.CacheControl = "no-cache";
        }
    },
});

app.MapGymBro();

if (e2e)
{
    app.Logger.LogWarning("E2E authentication is enabled. Do not expose this environment.");
}

if (!app.Environment.IsEnvironment("Testing"))
{
    // Migrations run before Kestrel opens the socket, so this is the line that
    // says where the app will be once Postgres is ready.
    var urls = Environment.GetEnvironmentVariable("ASPNETCORE_URLS");
    if (string.IsNullOrWhiteSpace(urls))
    {
        var address = builder.Configuration["BIND_ADDRESS"];
        var port = builder.Configuration["BIND_PORT"];
        urls = $"http://{(string.IsNullOrWhiteSpace(address) ? "127.0.0.1" : address)}:{(string.IsNullOrWhiteSpace(port) ? "8100" : port)}";
    }

    app.Logger.LogInformation("Gym Bro will listen on {Urls} after the database migration.", urls);
}

await app.ApplyMigrationsAsync();

if (args.Contains("--import-matvaretabellen"))
{
    await using var scope = app.Services.CreateAsyncScope();
    var importer = scope.ServiceProvider.GetRequiredService<MatvaretabellenImporter>();
    try
    {
        var result = await importer.ImportOfficialAsync(CancellationToken.None);
        Console.WriteLine(
            $"Matvaretabellen: {result.Upserted} foods upserted, {result.Retired} retired, {result.Skipped} skipped.");
        Console.WriteLine(Matvaretabellen.Citation);
        if (result.Upserted == 0)
        {
            Environment.ExitCode = 1;
        }
    }
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        Console.Error.WriteLine("Matvaretabellen import failed: " + ex.Message);
        Environment.ExitCode = 1;
    }

    return;
}

app.Run();

public partial class Program
{
}
