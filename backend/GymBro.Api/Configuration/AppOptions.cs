using Npgsql;

namespace GymBro.Api.Configuration;

public sealed class EntraOptions
{
    public const string SectionName = "Entra";

    public string TenantSubdomain { get; set; } = "";

    public string TenantId { get; set; } = "";

    public string SpaClientId { get; set; } = "";

    public string ApiClientId { get; set; } = "";

    /// <summary>
    /// Metadata and token authority. Includes <c>/v2.0</c> because that is the
    /// OpenID configuration document the API downloads. MSAL on the SPA uses
    /// the same host without the <c>/v2.0</c> suffix and adds it itself.
    /// </summary>
    public string Authority =>
        $"https://{TenantSubdomain}.ciamlogin.com/{TenantId}/v2.0";

    public string Audience => $"api://{ApiClientId}";

    public string Scope => $"{Audience}/access_as_user";

    public void EnsureConfigured()
    {
        var missing = new List<string>();
        if (string.IsNullOrWhiteSpace(TenantSubdomain)) missing.Add("ENTRA_TENANT_SUBDOMAIN");
        if (string.IsNullOrWhiteSpace(TenantId)) missing.Add("ENTRA_TENANT_ID");
        if (string.IsNullOrWhiteSpace(SpaClientId)) missing.Add("ENTRA_SPA_CLIENT_ID");
        if (string.IsNullOrWhiteSpace(ApiClientId)) missing.Add("ENTRA_API_CLIENT_ID");

        if (missing.Count > 0)
        {
            throw new InvalidOperationException(
                "Missing Entra configuration: " + string.Join(", ", missing) +
                ". Copy .env.example to .env and fill these in.");
        }
    }
}

public sealed class PostgresOptions
{
    public const string SectionName = "Postgres";

    public string Host { get; set; } = "localhost";

    public int Port { get; set; } = 5432;

    public string Database { get; set; } = "gymbro";

    public string Username { get; set; } = "gymbro";

    public string Password { get; set; } = "";

    public string ToConnectionString()
    {
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = Host,
            Port = Port,
            Database = Database,
            Username = Username,
            Password = Password,
        };
        return builder.ConnectionString;
    }
}

public sealed class FoodOptions
{
    public const string SectionName = "Foods";

    public const string DefaultSearchUrl = "https://world.openfoodfacts.org/cgi/search.pl";

    public const string DefaultMatvaretabellenUrl = "https://www.matvaretabellen.no/api/nb/foods.json";

    public const string DefaultUserAgent = "GymBro/1.0 (self-hosted nutrition tracker)";

    public string OpenFoodFactsUserAgent { get; set; } = DefaultUserAgent;

    public string OpenFoodFactsSearchUrl { get; set; } = DefaultSearchUrl;

    public string MatvaretabellenUrl { get; set; } = DefaultMatvaretabellenUrl;
}

/// <summary>
/// <see cref="Provider"/> is <c>postgres</c> for the app and the test host.
/// </summary>
public sealed class DatabaseOptions
{
    public const string SectionName = "Database";

    public string Provider { get; set; } = "postgres";

    public string Sqlite { get; set; } = "Data Source=gymbro-tests.db";
}
