using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace GymBro.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();

    public DbSet<Profile> Profiles => Set<Profile>();

    public DbSet<WeighIn> WeighIns => Set<WeighIn>();

    public DbSet<TargetHistory> TargetHistories => Set<TargetHistory>();

    public DbSet<Food> Foods => Set<Food>();

    public DbSet<LogEntry> LogEntries => Set<LogEntry>();

    public DbSet<EntryGroup> EntryGroups => Set<EntryGroup>();

    public DbSet<DayStatus> DayStatuses => Set<DayStatus>();

    public DbSet<FoodSourceCredit> FoodSourceCredits => Set<FoodSourceCredit>();

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

        var profile = modelBuilder.Entity<Profile>();
        profile.ToTable("profiles");
        profile.HasKey(p => p.UserId);
        profile.Property(p => p.UserId).HasColumnName("user_id").HasMaxLength(64);
        profile.Property(p => p.Sex).HasColumnName("sex").HasMaxLength(8);
        profile.Property(p => p.BirthYear).HasColumnName("birth_year");
        profile.Property(p => p.HeightCm).HasColumnName("height_cm").HasPrecision(5, 1);
        profile.Property(p => p.Activity).HasColumnName("activity").HasMaxLength(16);
        profile.Property(p => p.Goal).HasColumnName("goal").HasMaxLength(16);
        profile.Property(p => p.RateKgPerWeek).HasColumnName("rate_kg_per_week").HasPrecision(3, 2);
        profile.Property(p => p.GoalWeightKg).HasColumnName("goal_weight_kg").HasPrecision(5, 1);
        profile.Property(p => p.ProteinSetting).HasColumnName("protein_setting").HasMaxLength(8);
        profile.Property(p => p.ProteinGramsPerKg).HasColumnName("protein_grams_per_kg").HasPrecision(3, 1);
        profile.Property(p => p.FatSetting).HasColumnName("fat_setting").HasMaxLength(8);
        profile.Property(p => p.FatPercent).HasColumnName("fat_percent").HasPrecision(4, 1);
        profile.Property(p => p.TimeZone).HasColumnName("time_zone").HasMaxLength(64);
        profile.Property(p => p.CreatedAt).HasColumnName("created_at");
        profile.Property(p => p.UpdatedAt).HasColumnName("updated_at");
        profile.HasOne<AppUser>().WithMany().HasForeignKey(p => p.UserId).OnDelete(DeleteBehavior.Cascade);

        var weighIn = modelBuilder.Entity<WeighIn>();
        weighIn.ToTable("weigh_ins");
        weighIn.HasKey(w => w.Id);
        weighIn.Property(w => w.Id).HasColumnName("id");
        weighIn.Property(w => w.UserId).HasColumnName("user_id").HasMaxLength(64);
        weighIn.Property(w => w.LocalDate).HasColumnName("local_date");
        weighIn.Property(w => w.Kg).HasColumnName("kg").HasPrecision(5, 1);
        weighIn.Property(w => w.UpdatedAt).HasColumnName("updated_at");
        weighIn.HasIndex(w => new { w.UserId, w.LocalDate }).IsUnique();
        weighIn.HasOne<AppUser>().WithMany().HasForeignKey(w => w.UserId).OnDelete(DeleteBehavior.Cascade);

        var target = modelBuilder.Entity<TargetHistory>();
        target.ToTable("target_history");
        target.HasKey(t => t.Id);
        target.Property(t => t.Id).HasColumnName("id").UseIdentityAlwaysColumn();
        target.Property(t => t.UserId).HasColumnName("user_id").HasMaxLength(64);
        target.Property(t => t.EffectiveDate).HasColumnName("effective_date");
        target.Property(t => t.Bmr).HasColumnName("bmr");
        target.Property(t => t.Tdee).HasColumnName("tdee");
        target.Property(t => t.Kcal).HasColumnName("kcal");
        target.Property(t => t.ProteinGrams).HasColumnName("protein_grams");
        target.Property(t => t.FatGrams).HasColumnName("fat_grams");
        target.Property(t => t.CarbGrams).HasColumnName("carb_grams");
        target.Property(t => t.FloorApplied).HasColumnName("floor_applied");
        target.Property(t => t.Reasons).HasColumnName("reasons").HasColumnType("text[]");
        target.Property(t => t.WeightKg).HasColumnName("weight_kg").HasPrecision(5, 2);
        target.Property(t => t.CreatedAt).HasColumnName("created_at");
        target.HasIndex(t => new { t.UserId, t.EffectiveDate })
            .IsUnique()
            .HasDatabaseName("ux_target_history_user_date");
        target.HasOne<AppUser>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);

        var food = modelBuilder.Entity<Food>();
        food.ToTable("foods", table =>
        {
            table.HasCheckConstraint("ck_foods_custom_owner", "source <> 'custom' OR user_id IS NOT NULL");
            table.HasCheckConstraint("ck_foods_catalog_owner", "source = 'custom' OR user_id IS NULL");
            table.HasCheckConstraint(
                "ck_foods_nutrient_basis",
                "(nutrient_basis = 'per_100' AND basis IN ('g', 'ml')) OR (nutrient_basis = 'per_serving' AND basis = 'serving' AND serving_quantity IS NULL AND piece_quantity IS NULL)");
        });
        food.HasKey(f => f.Id);
        food.Property(f => f.Id).HasColumnName("id");
        food.Property(f => f.UserId).HasColumnName("user_id").HasMaxLength(64);
        // Stored generated column. EF would mark it ValueGeneratedOnAddOrUpdate, which
        // cannot be part of the alternate key, so the value is fixed once inserted.
        // user_id does not change after a food is created.
        var ownerKey = food.Property(f => f.OwnerKey)
            .HasColumnName("owner_key")
            .HasMaxLength(64)
            .HasComputedColumnSql("COALESCE(user_id, '')", stored: true)
            .ValueGeneratedOnAdd();
        ownerKey.Metadata.SetBeforeSaveBehavior(PropertySaveBehavior.Ignore);
        ownerKey.Metadata.SetAfterSaveBehavior(PropertySaveBehavior.Ignore);
        food.Property(f => f.Source).HasColumnName("source").HasMaxLength(16);
        food.Property(f => f.SourceId).HasColumnName("source_id").HasMaxLength(64);
        food.Property(f => f.Barcode).HasColumnName("barcode").HasMaxLength(32);
        food.Property(f => f.Name).HasColumnName("name").HasMaxLength(300);
        food.Property(f => f.Basis).HasColumnName("basis").HasMaxLength(8);
        food.Property(f => f.NutrientBasis).HasColumnName("nutrient_basis").HasMaxLength(16);
        food.Property(f => f.KcalPer100).HasColumnName("kcal_per_100").HasPrecision(8, 2);
        food.Property(f => f.ProteinPer100).HasColumnName("protein_per_100").HasPrecision(8, 2);
        food.Property(f => f.FatPer100).HasColumnName("fat_per_100").HasPrecision(8, 2);
        food.Property(f => f.CarbsPer100).HasColumnName("carbs_per_100").HasPrecision(8, 2);
        food.Property(f => f.ServingQuantity).HasColumnName("serving_quantity").HasPrecision(8, 2);
        food.Property(f => f.ServingLabel).HasColumnName("serving_label").HasMaxLength(80);
        food.Property(f => f.PieceQuantity).HasColumnName("piece_quantity").HasPrecision(8, 2);
        food.Property(f => f.PieceLabel).HasColumnName("piece_label").HasMaxLength(80);
        food.Property(f => f.RetiredAt).HasColumnName("retired_at");
        food.Property(f => f.UpdatedAt).HasColumnName("updated_at");
        food.HasIndex(f => new { f.Source, f.SourceId }).IsUnique().HasFilter("user_id IS NULL");
        food.HasIndex(f => new { f.UserId, f.Source, f.SourceId }).IsUnique().HasFilter("user_id IS NOT NULL");
        food.HasIndex(f => f.Barcode);
        food.HasAlternateKey(f => new { f.OwnerKey, f.Id }).HasName("ux_foods_owner_key_id");
        food.HasOne<AppUser>().WithMany().HasForeignKey(f => f.UserId).OnDelete(DeleteBehavior.Cascade);

        var entry = modelBuilder.Entity<LogEntry>();
        entry.ToTable("log_entries", table =>
        {
            table.HasCheckConstraint(
                "ck_log_entries_food_owner",
                "food_owner_key = '' OR food_owner_key = user_id");
        });
        entry.HasKey(e => e.Id);
        entry.Property(e => e.Id).HasColumnName("id");
        entry.Property(e => e.UserId).HasColumnName("user_id").HasMaxLength(64);
        entry.Property(e => e.LocalDate).HasColumnName("local_date");
        entry.Property(e => e.LoggedAt).HasColumnName("logged_at").HasColumnType("timestamp without time zone");
        entry.Property(e => e.TimeZone).HasColumnName("time_zone").HasMaxLength(64);
        entry.Property(e => e.GroupId).HasColumnName("group_id");
        entry.Property(e => e.FoodId).HasColumnName("food_id");
        entry.Property(e => e.FoodOwnerKey).HasColumnName("food_owner_key").HasMaxLength(64);
        entry.Property(e => e.Source).HasColumnName("source").HasMaxLength(32);
        entry.Property(e => e.SourceId).HasColumnName("source_id").HasMaxLength(64);
        entry.Property(e => e.Grams).HasColumnName("grams").HasPrecision(8, 2);
        entry.Property(e => e.Name).HasColumnName("name").HasMaxLength(300);
        entry.Property(e => e.Amount).HasColumnName("amount").HasPrecision(8, 2);
        entry.Property(e => e.Unit).HasColumnName("unit").HasMaxLength(16);
        entry.Property(e => e.Kcal).HasColumnName("kcal").HasPrecision(8, 2);
        entry.Property(e => e.Protein).HasColumnName("protein").HasPrecision(8, 2);
        entry.Property(e => e.Fat).HasColumnName("fat").HasPrecision(8, 2);
        entry.Property(e => e.Carbs).HasColumnName("carbs").HasPrecision(8, 2);
        entry.Property(e => e.IdempotencyKey).HasColumnName("idempotency_key").HasMaxLength(64);
        entry.Property(e => e.DeletedAt).HasColumnName("deleted_at");
        entry.HasIndex(e => new { e.UserId, e.IdempotencyKey }).IsUnique();
        entry.HasIndex(e => new { e.UserId, e.LocalDate });
        entry.HasOne<AppUser>().WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
        // Catalogue foods have a null owner, so (user_id, food_id) cannot reference them.
        // owner_key is the user id or '' for the catalogue. food_owner_key must be '' or
        // this row's user_id (see ck_log_entries_food_owner). ON DELETE SET NULL (food_id)
        // is applied in the migration; EF models the relationship as NoAction because
        // food_owner_key is not nullable.
        entry.HasOne<Food>()
            .WithMany()
            .HasForeignKey(e => new { e.FoodOwnerKey, e.FoodId })
            .HasPrincipalKey(f => new { f.OwnerKey, f.Id })
            .OnDelete(DeleteBehavior.NoAction)
            .HasConstraintName("fk_log_entries_food_owner");
        entry.HasOne<EntryGroup>()
            .WithMany()
            .HasForeignKey(e => new { e.UserId, e.GroupId })
            .HasPrincipalKey(g => new { g.UserId, g.Id })
            .OnDelete(DeleteBehavior.NoAction)
            .HasConstraintName("fk_log_entries_group_owner");

        var group = modelBuilder.Entity<EntryGroup>();
        group.ToTable("entry_groups");
        group.HasKey(g => g.Id);
        group.Property(g => g.Id).HasColumnName("id");
        group.Property(g => g.UserId).HasColumnName("user_id").HasMaxLength(64);
        group.Property(g => g.Name).HasColumnName("name").HasMaxLength(120);
        group.Property(g => g.CreatedAt).HasColumnName("created_at");
        group.HasIndex(g => g.UserId);
        group.HasAlternateKey(g => new { g.UserId, g.Id }).HasName("ux_entry_groups_user_id");
        group.HasOne<AppUser>().WithMany().HasForeignKey(g => g.UserId).OnDelete(DeleteBehavior.Cascade);

        var day = modelBuilder.Entity<DayStatus>();
        day.ToTable("day_status");
        day.HasKey(d => new { d.UserId, d.LocalDate });
        day.Property(d => d.UserId).HasColumnName("user_id").HasMaxLength(64);
        day.Property(d => d.LocalDate).HasColumnName("local_date");
        day.Property(d => d.Complete).HasColumnName("complete");
        day.Property(d => d.Fasting).HasColumnName("fasting").HasDefaultValue(false);
        day.HasOne<AppUser>().WithMany().HasForeignKey(d => d.UserId).OnDelete(DeleteBehavior.Cascade);

        var credit = modelBuilder.Entity<FoodSourceCredit>();
        credit.ToTable("food_source_credits");
        credit.HasKey(c => c.Source);
        credit.Property(c => c.Source).HasColumnName("source").HasMaxLength(16);
        credit.Property(c => c.Citation).HasColumnName("citation").HasMaxLength(300);
        credit.Property(c => c.ImportedAt).HasColumnName("imported_at");
        credit.Property(c => c.FoodCount).HasColumnName("food_count");
    }
}
