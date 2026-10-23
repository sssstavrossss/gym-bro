using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var user = modelBuilder.Entity<AppUser>();
        user.ToTable("users");
        user.HasKey(u => u.ObjectId);
        user.Property(u => u.ObjectId).HasColumnName("object_id").HasMaxLength(64);
        user.Property(u => u.DisplayName).HasColumnName("display_name").HasMaxLength(256);
        user.Property(u => u.Email).HasColumnName("email").HasMaxLength(320);
        user.Property(u => u.FirstSeenAt).HasColumnName("first_seen_at");
        user.Property(u => u.LastSeenAt).HasColumnName("last_seen_at");
    }
}
