namespace GymBro.Api.Configuration;

/// <summary>
/// Loads a local <c>.env</c> file into the process environment before the
/// generic host reads configuration. Existing variables win, so Compose and
/// CI are not overwritten by a file that happens to be on disk.
/// </summary>
public static class EnvFile
{
    public static void Load()
    {
        if (string.Equals(
                Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT"),
                "Testing",
                StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var path = Find(Directory.GetCurrentDirectory()) ?? Find(AppContext.BaseDirectory);
        if (path is null)
        {
            ApplyFriendlyNames();
            return;
        }

        foreach (var (key, value) in Parse(File.ReadAllText(path)))
        {
            if (Environment.GetEnvironmentVariable(key) is null)
            {
                Environment.SetEnvironmentVariable(key, value);
            }
        }

        ApplyFriendlyNames();
    }

    /// <summary>
    /// Parses <c>KEY=VALUE</c> lines. Blank lines and full-line comments are
    /// ignored. An optional <c>export </c> prefix is stripped. Matching single
    /// or double quotes around a value are removed. Inline <c>#</c> characters
    /// are kept so a password can contain one.
    /// </summary>
    public static IReadOnlyDictionary<string, string> Parse(string contents)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var raw in contents.Split('\n'))
        {
            var line = raw.Trim().TrimEnd('\r');
            if (line.Length == 0 || line[0] == '#')
            {
                continue;
            }

            if (line.StartsWith("export ", StringComparison.Ordinal))
            {
                line = line["export ".Length..].TrimStart();
            }

            var separator = line.IndexOf('=');
            if (separator <= 0)
            {
                continue;
            }

            var key = line[..separator].Trim();
            if (key.Length == 0)
            {
                continue;
            }

            var value = line[(separator + 1)..].Trim();
            if (value.Length >= 2 &&
                ((value[0] == '"' && value[^1] == '"') || (value[0] == '\'' && value[^1] == '\'')))
            {
                value = value[1..^1];
            }

            values[key] = value;
        }

        return values;
    }

    private static void ApplyFriendlyNames()
    {
        // .env uses readable names. ASP.NET Core configuration binds the
        // double-underscore form (Entra__TenantId -> Entra:TenantId).
        Copy("ENTRA_TENANT_SUBDOMAIN", "Entra__TenantSubdomain");
        Copy("ENTRA_TENANT_ID", "Entra__TenantId");
        Copy("ENTRA_SPA_CLIENT_ID", "Entra__SpaClientId");
        Copy("ENTRA_API_CLIENT_ID", "Entra__ApiClientId");
        Copy("POSTGRES_HOST", "Postgres__Host");
        Copy("POSTGRES_PORT", "Postgres__Port");
        Copy("POSTGRES_DB", "Postgres__Database");
        Copy("POSTGRES_USER", "Postgres__Username");
        Copy("POSTGRES_PASSWORD", "Postgres__Password");
    }

    private static void Copy(string from, string to)
    {
        var value = Environment.GetEnvironmentVariable(from);
        if (string.IsNullOrEmpty(value))
        {
            return;
        }

        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(to)))
        {
            Environment.SetEnvironmentVariable(to, value);
        }
    }

    private static string? Find(string start)
    {
        var dir = new DirectoryInfo(start);
        for (var depth = 0; depth < 8 && dir is not null; depth++)
        {
            var candidate = Path.Combine(dir.FullName, ".env");
            if (File.Exists(candidate))
            {
                return candidate;
            }

            // Stop at the repo root so a home-directory .env is not picked up.
            if (File.Exists(Path.Combine(dir.FullName, "GymBro.sln")))
            {
                return null;
            }

            dir = dir.Parent;
        }

        return null;
    }
}
