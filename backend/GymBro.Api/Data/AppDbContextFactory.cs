using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace GymBro.Api.Data;

/// <summary>
/// Used by <c>dotnet ef</c> to build the model. The connection string is never
/// used to connect; migrations are generated from the entity model.
/// </summary>
public sealed class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql("Host=localhost;Database=gymbro;Username=gymbro;Password=design-time")
            .Options;
        return new AppDbContext(options);
    }
}
