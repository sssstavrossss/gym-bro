using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace GymBro.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();

    public DbSet<Profile> Profiles => Set<Profile>();

    public DbSet<WeighIn> WeighIns => Set<WeighIn>();

    public DbSet<TargetHistory> TargetHistories => Set<TargetHistory>();

    public DbSet<RecalculationDecline> RecalculationDeclines => Set<RecalculationDecline>();

    public DbSet<Food> Foods => Set<Food>();

    public DbSet<FoodAlias> FoodAliases => Set<FoodAlias>();

    public DbSet<FoodBasisConfirmation> FoodBasisConfirmations => Set<FoodBasisConfirmation>();

    public DbSet<UserServing> UserServings => Set<UserServing>();

    public DbSet<LogEntry> LogEntries => Set<LogEntry>();

    public DbSet<EntryGroup> EntryGroups => Set<EntryGroup>();

    public DbSet<EntryGroupItem> EntryGroupItems => Set<EntryGroupItem>();

    public DbSet<Recipe> Recipes => Set<Recipe>();

    public DbSet<RecipeIngredient> RecipeIngredients => Set<RecipeIngredient>();

    public DbSet<DayStatus> DayStatuses => Set<DayStatus>();

    public DbSet<PushSubscription> PushSubscriptions => Set<PushSubscription>();

    public DbSet<ReminderSend> ReminderSends => Set<ReminderSend>();

    public DbSet<UserNotification> UserNotifications => Set<UserNotification>();

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
        profile.Property(p => p.RemindersEnabled).HasColumnName("reminders_enabled").HasDefaultValue(false);
        profile.Property(p => p.NotifyRecalculate).HasColumnName("notify_recalculate").HasDefaultValue(true);
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

        var declined = modelBuilder.Entity<RecalculationDecline>();
        declined.ToTable("recalculation_declines");
        declined.HasKey(d => d.Id);
        declined.Property(d => d.Id).HasColumnName("id").UseIdentityAlwaysColumn();
        declined.Property(d => d.UserId).HasColumnName("user_id").HasMaxLength(64);
        declined.Property(d => d.PeriodFrom).HasColumnName("period_from");
        declined.Property(d => d.PeriodTo).HasColumnName("period_to");
        declined.Property(d => d.SuggestedBmr).HasColumnName("suggested_bmr");
        declined.Property(d => d.SuggestedTdee).HasColumnName("suggested_tdee");
        declined.Property(d => d.SuggestedKcal).HasColumnName("suggested_kcal");
        declined.Property(d => d.SuggestedProtein).HasColumnName("suggested_protein");
        declined.Property(d => d.SuggestedFat).HasColumnName("suggested_fat");
        declined.Property(d => d.SuggestedCarbs).HasColumnName("suggested_carbs");
        declined.Property(d => d.KeptKcal).HasColumnName("kept_kcal");
        declined.Property(d => d.CreatedAt).HasColumnName("created_at");
        declined.HasIndex(d => new { d.UserId, d.CreatedAt });
        declined.HasOne<AppUser>().WithMany().HasForeignKey(d => d.UserId).OnDelete(DeleteBehavior.Cascade);

        var food = modelBuilder.Entity<Food>();
        food.ToTable("foods", table =>
        {
            table.HasCheckConstraint("ck_foods_custom_owner", "source <> 'custom' OR user_id IS NOT NULL");
            table.HasCheckConstraint("ck_foods_catalog_owner", "source = 'custom' OR user_id IS NULL");
            table.HasCheckConstraint(
                "ck_foods_nutrient_basis",
                "(nutrient_basis = 'per_100' AND basis IN ('g', 'ml')) OR (nutrient_basis = 'per_serving' AND basis = 'serving' AND serving_quantity IS NULL AND piece_quantity IS NULL) OR (nutrient_basis = 'unconfirmed' AND basis IS NULL AND source = 'kassalapp')");
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
        food.Property(f => f.Brand).HasColumnName("brand").HasMaxLength(80);
        food.Property(f => f.Name).HasColumnName("name").HasMaxLength(300);
        food.Property(f => f.NameEn).HasColumnName("name_en").HasMaxLength(300);
        food.Property(f => f.SearchName).HasColumnName("search_name").HasMaxLength(300);
        food.Property(f => f.SearchNameEn).HasColumnName("search_name_en").HasMaxLength(300);
        food.Property(f => f.SearchBrand).HasColumnName("search_brand").HasMaxLength(80);
        food.Property(f => f.Basis).HasColumnName("basis").HasMaxLength(8).IsRequired(false);
        food.Property(f => f.NutrientBasis).HasColumnName("nutrient_basis").HasMaxLength(16);
        food.Property(f => f.KcalPer100).HasColumnName("kcal_per_100").HasPrecision(8, 2);
        food.Property(f => f.ProteinPer100).HasColumnName("protein_per_100").HasPrecision(8, 2);
        food.Property(f => f.FatPer100).HasColumnName("fat_per_100").HasPrecision(8, 2);
        food.Property(f => f.CarbsPer100).HasColumnName("carbs_per_100").HasPrecision(8, 2);
        food.Property(f => f.SaturatedFatPer100).HasColumnName("saturated_fat_per_100").HasPrecision(8, 2);
        food.Property(f => f.SugarsPer100).HasColumnName("sugars_per_100").HasPrecision(8, 2);
        food.Property(f => f.FiberPer100).HasColumnName("fiber_per_100").HasPrecision(8, 2);
        food.Property(f => f.SaltPer100).HasColumnName("salt_per_100").HasPrecision(8, 2);
        food.Property(f => f.MonoFatPer100).HasColumnName("mono_fat_per_100").HasPrecision(8, 2);
        food.Property(f => f.PolyFatPer100).HasColumnName("poly_fat_per_100").HasPrecision(8, 2);
        food.Property(f => f.Omega3Per100).HasColumnName("omega3_per_100").HasPrecision(8, 2);
        food.Property(f => f.Omega6Per100).HasColumnName("omega6_per_100").HasPrecision(8, 2);
        food.Property(f => f.TransFatPer100).HasColumnName("trans_fat_per_100").HasPrecision(8, 2);
        food.Property(f => f.CholesterolPer100).HasColumnName("cholesterol_per_100").HasPrecision(8, 2);
        food.Property(f => f.AddedSugarsPer100).HasColumnName("added_sugars_per_100").HasPrecision(8, 2);
        food.Property(f => f.SodiumPer100).HasColumnName("sodium_per_100").HasPrecision(8, 2);
        food.Property(f => f.VitaminAPer100).HasColumnName("vitamin_a_per_100").HasPrecision(8, 2);
        food.Property(f => f.VitaminDPer100).HasColumnName("vitamin_d_per_100").HasPrecision(8, 2);
        food.Property(f => f.VitaminEPer100).HasColumnName("vitamin_e_per_100").HasPrecision(8, 2);
        food.Property(f => f.ThiaminPer100).HasColumnName("thiamin_per_100").HasPrecision(8, 2);
        food.Property(f => f.RiboflavinPer100).HasColumnName("riboflavin_per_100").HasPrecision(8, 2);
        food.Property(f => f.NiacinPer100).HasColumnName("niacin_per_100").HasPrecision(8, 2);
        food.Property(f => f.VitaminB6Per100).HasColumnName("vitamin_b6_per_100").HasPrecision(8, 2);
        food.Property(f => f.FolatePer100).HasColumnName("folate_per_100").HasPrecision(8, 2);
        food.Property(f => f.VitaminB12Per100).HasColumnName("vitamin_b12_per_100").HasPrecision(8, 2);
        food.Property(f => f.VitaminCPer100).HasColumnName("vitamin_c_per_100").HasPrecision(8, 2);
        food.Property(f => f.CalciumPer100).HasColumnName("calcium_per_100").HasPrecision(8, 2);
        food.Property(f => f.IronPer100).HasColumnName("iron_per_100").HasPrecision(8, 2);
        food.Property(f => f.ZincPer100).HasColumnName("zinc_per_100").HasPrecision(8, 2);
        food.Property(f => f.MagnesiumPer100).HasColumnName("magnesium_per_100").HasPrecision(8, 2);
        food.Property(f => f.PotassiumPer100).HasColumnName("potassium_per_100").HasPrecision(8, 2);
        food.Property(f => f.PhosphorusPer100).HasColumnName("phosphorus_per_100").HasPrecision(8, 2);
        food.Property(f => f.SeleniumPer100).HasColumnName("selenium_per_100").HasPrecision(8, 2);
        food.Property(f => f.IodinePer100).HasColumnName("iodine_per_100").HasPrecision(8, 2);

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

        var alias = modelBuilder.Entity<FoodAlias>();
        alias.ToTable("food_aliases");
        alias.HasKey(a => a.Id);
        alias.Property(a => a.Id).HasColumnName("id");
        alias.Property(a => a.Source).HasColumnName("source").HasMaxLength(16);
        alias.Property(a => a.SourceId).HasColumnName("source_id").HasMaxLength(64);
        alias.Property(a => a.Phrase).HasColumnName("phrase").HasMaxLength(80);
        alias.Property(a => a.Normalized).HasColumnName("normalized").HasMaxLength(80);
        alias.Property(a => a.ExpectedNameEn).HasColumnName("expected_name_en").HasMaxLength(300);
        alias.HasIndex(a => new { a.Source, a.SourceId, a.Normalized }).IsUnique();

        var confirmation = modelBuilder.Entity<FoodBasisConfirmation>();
        confirmation.ToTable("food_basis_confirmations", table =>
        {
            table.HasCheckConstraint("ck_food_basis_confirmations_basis", "basis IN ('g', 'ml')");
        });
        confirmation.HasKey(c => c.Id);
        confirmation.Property(c => c.Id).HasColumnName("id");
        confirmation.Property(c => c.UserId).HasColumnName("user_id").HasMaxLength(64);
        confirmation.Property(c => c.FoodId).HasColumnName("food_id");
        confirmation.Property(c => c.Basis).HasColumnName("basis").HasMaxLength(8);
        confirmation.Property(c => c.NutritionStamp).HasColumnName("nutrition_stamp").HasMaxLength(80);
        confirmation.Property(c => c.ConfirmedAt).HasColumnName("confirmed_at");
        confirmation.HasIndex(c => new { c.UserId, c.FoodId }).IsUnique();
        confirmation.HasOne<AppUser>().WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
        confirmation.HasOne<Food>().WithMany().HasForeignKey(c => c.FoodId).OnDelete(DeleteBehavior.Cascade);

        var serving = modelBuilder.Entity<UserServing>();
        serving.ToTable("user_servings", table =>
        {
            table.HasCheckConstraint("ck_user_servings_grams", "grams > 0 AND grams <= 10000");
            table.HasCheckConstraint("ck_user_servings_name", "char_length(name) BETWEEN 1 AND 16");
        });
        serving.HasKey(s => s.Id);
        serving.Property(s => s.Id).HasColumnName("id");
        serving.Property(s => s.UserId).HasColumnName("user_id").HasMaxLength(64);
        serving.Property(s => s.FoodId).HasColumnName("food_id");
        serving.Property(s => s.Name).HasColumnName("name").HasMaxLength(16);
        serving.Property(s => s.NameKey).HasColumnName("name_key").HasMaxLength(16);
        serving.Property(s => s.Grams).HasColumnName("grams").HasPrecision(8, 2);
        serving.Property(s => s.UpdatedAt).HasColumnName("updated_at");
        serving.HasIndex(s => new { s.UserId, s.FoodId, s.NameKey }).IsUnique();
        serving.HasOne<AppUser>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
        serving.HasOne<Food>().WithMany().HasForeignKey(s => s.FoodId).OnDelete(DeleteBehavior.Cascade);

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
        entry.Property(e => e.SaturatedFat).HasColumnName("saturated_fat").HasPrecision(8, 2);
        entry.Property(e => e.Sugars).HasColumnName("sugars").HasPrecision(8, 2);
        entry.Property(e => e.Fiber).HasColumnName("fiber").HasPrecision(8, 2);
        entry.Property(e => e.Salt).HasColumnName("salt").HasPrecision(8, 2);
        entry.Property(e => e.MonoFat).HasColumnName("mono_fat").HasPrecision(8, 2);
        entry.Property(e => e.PolyFat).HasColumnName("poly_fat").HasPrecision(8, 2);
        entry.Property(e => e.Omega3).HasColumnName("omega3").HasPrecision(8, 2);
        entry.Property(e => e.Omega6).HasColumnName("omega6").HasPrecision(8, 2);
        entry.Property(e => e.TransFat).HasColumnName("trans_fat").HasPrecision(8, 2);
        entry.Property(e => e.Cholesterol).HasColumnName("cholesterol").HasPrecision(8, 2);
        entry.Property(e => e.AddedSugars).HasColumnName("added_sugars").HasPrecision(8, 2);
        entry.Property(e => e.Sodium).HasColumnName("sodium").HasPrecision(8, 2);
        entry.Property(e => e.VitaminA).HasColumnName("vitamin_a").HasPrecision(8, 2);
        entry.Property(e => e.VitaminD).HasColumnName("vitamin_d").HasPrecision(8, 2);
        entry.Property(e => e.VitaminE).HasColumnName("vitamin_e").HasPrecision(8, 2);
        entry.Property(e => e.Thiamin).HasColumnName("thiamin").HasPrecision(8, 2);
        entry.Property(e => e.Riboflavin).HasColumnName("riboflavin").HasPrecision(8, 2);
        entry.Property(e => e.Niacin).HasColumnName("niacin").HasPrecision(8, 2);
        entry.Property(e => e.VitaminB6).HasColumnName("vitamin_b6").HasPrecision(8, 2);
        entry.Property(e => e.Folate).HasColumnName("folate").HasPrecision(8, 2);
        entry.Property(e => e.VitaminB12).HasColumnName("vitamin_b12").HasPrecision(8, 2);
        entry.Property(e => e.VitaminC).HasColumnName("vitamin_c").HasPrecision(8, 2);
        entry.Property(e => e.Calcium).HasColumnName("calcium").HasPrecision(8, 2);
        entry.Property(e => e.Iron).HasColumnName("iron").HasPrecision(8, 2);
        entry.Property(e => e.Zinc).HasColumnName("zinc").HasPrecision(8, 2);
        entry.Property(e => e.Magnesium).HasColumnName("magnesium").HasPrecision(8, 2);
        entry.Property(e => e.Potassium).HasColumnName("potassium").HasPrecision(8, 2);
        entry.Property(e => e.Phosphorus).HasColumnName("phosphorus").HasPrecision(8, 2);
        entry.Property(e => e.Selenium).HasColumnName("selenium").HasPrecision(8, 2);
        entry.Property(e => e.Iodine).HasColumnName("iodine").HasPrecision(8, 2);

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

        var item = modelBuilder.Entity<EntryGroupItem>();
        item.ToTable("entry_group_items", table =>
        {
            table.HasCheckConstraint(
                "ck_entry_group_items_food_owner",
                "food_owner_key = '' OR food_owner_key = user_id");
        });
        item.HasKey(i => i.Id);
        item.Property(i => i.Id).HasColumnName("id");
        item.Property(i => i.UserId).HasColumnName("user_id").HasMaxLength(64);
        item.Property(i => i.GroupId).HasColumnName("group_id");
        item.Property(i => i.Position).HasColumnName("position");
        item.Property(i => i.FoodId).HasColumnName("food_id");
        item.Property(i => i.FoodOwnerKey).HasColumnName("food_owner_key").HasMaxLength(64);
        item.Property(i => i.Name).HasColumnName("name").HasMaxLength(300);
        item.Property(i => i.Amount).HasColumnName("amount").HasPrecision(8, 2);
        item.Property(i => i.Unit).HasColumnName("unit").HasMaxLength(16);
        item.Property(i => i.Grams).HasColumnName("grams").HasPrecision(8, 2);
        item.Property(i => i.Kcal).HasColumnName("kcal").HasPrecision(8, 2);
        item.Property(i => i.Protein).HasColumnName("protein").HasPrecision(8, 2);
        item.Property(i => i.Fat).HasColumnName("fat").HasPrecision(8, 2);
        item.Property(i => i.Carbs).HasColumnName("carbs").HasPrecision(8, 2);
        item.Property(i => i.SaturatedFat).HasColumnName("saturated_fat").HasPrecision(8, 2);
        item.Property(i => i.Sugars).HasColumnName("sugars").HasPrecision(8, 2);
        item.Property(i => i.Fiber).HasColumnName("fiber").HasPrecision(8, 2);
        item.Property(i => i.Salt).HasColumnName("salt").HasPrecision(8, 2);
        item.Property(i => i.MonoFat).HasColumnName("mono_fat").HasPrecision(8, 2);
        item.Property(i => i.PolyFat).HasColumnName("poly_fat").HasPrecision(8, 2);
        item.Property(i => i.Omega3).HasColumnName("omega3").HasPrecision(8, 2);
        item.Property(i => i.Omega6).HasColumnName("omega6").HasPrecision(8, 2);
        item.Property(i => i.TransFat).HasColumnName("trans_fat").HasPrecision(8, 2);
        item.Property(i => i.Cholesterol).HasColumnName("cholesterol").HasPrecision(8, 2);
        item.Property(i => i.AddedSugars).HasColumnName("added_sugars").HasPrecision(8, 2);
        item.Property(i => i.Sodium).HasColumnName("sodium").HasPrecision(8, 2);
        item.Property(i => i.VitaminA).HasColumnName("vitamin_a").HasPrecision(8, 2);
        item.Property(i => i.VitaminD).HasColumnName("vitamin_d").HasPrecision(8, 2);
        item.Property(i => i.VitaminE).HasColumnName("vitamin_e").HasPrecision(8, 2);
        item.Property(i => i.Thiamin).HasColumnName("thiamin").HasPrecision(8, 2);
        item.Property(i => i.Riboflavin).HasColumnName("riboflavin").HasPrecision(8, 2);
        item.Property(i => i.Niacin).HasColumnName("niacin").HasPrecision(8, 2);
        item.Property(i => i.VitaminB6).HasColumnName("vitamin_b6").HasPrecision(8, 2);
        item.Property(i => i.Folate).HasColumnName("folate").HasPrecision(8, 2);
        item.Property(i => i.VitaminB12).HasColumnName("vitamin_b12").HasPrecision(8, 2);
        item.Property(i => i.VitaminC).HasColumnName("vitamin_c").HasPrecision(8, 2);
        item.Property(i => i.Calcium).HasColumnName("calcium").HasPrecision(8, 2);
        item.Property(i => i.Iron).HasColumnName("iron").HasPrecision(8, 2);
        item.Property(i => i.Zinc).HasColumnName("zinc").HasPrecision(8, 2);
        item.Property(i => i.Magnesium).HasColumnName("magnesium").HasPrecision(8, 2);
        item.Property(i => i.Potassium).HasColumnName("potassium").HasPrecision(8, 2);
        item.Property(i => i.Phosphorus).HasColumnName("phosphorus").HasPrecision(8, 2);
        item.Property(i => i.Selenium).HasColumnName("selenium").HasPrecision(8, 2);
        item.Property(i => i.Iodine).HasColumnName("iodine").HasPrecision(8, 2);

        item.HasIndex(i => new { i.GroupId, i.Position }).IsUnique();
        item.HasOne<EntryGroup>()
            .WithMany()
            .HasForeignKey(i => new { i.UserId, i.GroupId })
            .HasPrincipalKey(g => new { g.UserId, g.Id })
            .OnDelete(DeleteBehavior.Cascade)
            .HasConstraintName("fk_entry_group_items_group_owner");
        item.HasOne<Food>()
            .WithMany()
            .HasForeignKey(i => new { i.FoodOwnerKey, i.FoodId })
            .HasPrincipalKey(f => new { f.OwnerKey, f.Id })
            .OnDelete(DeleteBehavior.NoAction)
            .HasConstraintName("fk_entry_group_items_food_owner");

        var recipe = modelBuilder.Entity<Recipe>();
        recipe.ToTable("recipes", table =>
        {
            table.HasCheckConstraint("ck_recipes_portions", "portions > 0 AND portions <= 1000");
            table.HasCheckConstraint(
                "ck_recipes_finished_grams",
                "finished_grams IS NULL OR (finished_grams > 0 AND finished_grams <= 100000)");
        });
        recipe.HasKey(r => r.Id);
        recipe.Property(r => r.Id).HasColumnName("id");
        recipe.Property(r => r.UserId).HasColumnName("user_id").HasMaxLength(64);
        recipe.Property(r => r.Name).HasColumnName("name").HasMaxLength(120);
        recipe.Property(r => r.Portions).HasColumnName("portions").HasPrecision(8, 2);
        recipe.Property(r => r.FinishedGrams).HasColumnName("finished_grams").HasPrecision(8, 2);
        recipe.Property(r => r.Kcal).HasColumnName("kcal").HasPrecision(8, 2);
        recipe.Property(r => r.Protein).HasColumnName("protein").HasPrecision(8, 2);
        recipe.Property(r => r.Fat).HasColumnName("fat").HasPrecision(8, 2);
        recipe.Property(r => r.Carbs).HasColumnName("carbs").HasPrecision(8, 2);
        recipe.Property(r => r.SaturatedFat).HasColumnName("saturated_fat").HasPrecision(8, 2);
        recipe.Property(r => r.Sugars).HasColumnName("sugars").HasPrecision(8, 2);
        recipe.Property(r => r.Fiber).HasColumnName("fiber").HasPrecision(8, 2);
        recipe.Property(r => r.Salt).HasColumnName("salt").HasPrecision(8, 2);
        recipe.Property(r => r.MonoFat).HasColumnName("mono_fat").HasPrecision(8, 2);
        recipe.Property(r => r.PolyFat).HasColumnName("poly_fat").HasPrecision(8, 2);
        recipe.Property(r => r.Omega3).HasColumnName("omega3").HasPrecision(8, 2);
        recipe.Property(r => r.Omega6).HasColumnName("omega6").HasPrecision(8, 2);
        recipe.Property(r => r.TransFat).HasColumnName("trans_fat").HasPrecision(8, 2);
        recipe.Property(r => r.Cholesterol).HasColumnName("cholesterol").HasPrecision(8, 2);
        recipe.Property(r => r.AddedSugars).HasColumnName("added_sugars").HasPrecision(8, 2);
        recipe.Property(r => r.Sodium).HasColumnName("sodium").HasPrecision(8, 2);
        recipe.Property(r => r.VitaminA).HasColumnName("vitamin_a").HasPrecision(8, 2);
        recipe.Property(r => r.VitaminD).HasColumnName("vitamin_d").HasPrecision(8, 2);
        recipe.Property(r => r.VitaminE).HasColumnName("vitamin_e").HasPrecision(8, 2);
        recipe.Property(r => r.Thiamin).HasColumnName("thiamin").HasPrecision(8, 2);
        recipe.Property(r => r.Riboflavin).HasColumnName("riboflavin").HasPrecision(8, 2);
        recipe.Property(r => r.Niacin).HasColumnName("niacin").HasPrecision(8, 2);
        recipe.Property(r => r.VitaminB6).HasColumnName("vitamin_b6").HasPrecision(8, 2);
        recipe.Property(r => r.Folate).HasColumnName("folate").HasPrecision(8, 2);
        recipe.Property(r => r.VitaminB12).HasColumnName("vitamin_b12").HasPrecision(8, 2);
        recipe.Property(r => r.VitaminC).HasColumnName("vitamin_c").HasPrecision(8, 2);
        recipe.Property(r => r.Calcium).HasColumnName("calcium").HasPrecision(8, 2);
        recipe.Property(r => r.Iron).HasColumnName("iron").HasPrecision(8, 2);
        recipe.Property(r => r.Zinc).HasColumnName("zinc").HasPrecision(8, 2);
        recipe.Property(r => r.Magnesium).HasColumnName("magnesium").HasPrecision(8, 2);
        recipe.Property(r => r.Potassium).HasColumnName("potassium").HasPrecision(8, 2);
        recipe.Property(r => r.Phosphorus).HasColumnName("phosphorus").HasPrecision(8, 2);
        recipe.Property(r => r.Selenium).HasColumnName("selenium").HasPrecision(8, 2);
        recipe.Property(r => r.Iodine).HasColumnName("iodine").HasPrecision(8, 2);

        recipe.Property(r => r.CreatedAt).HasColumnName("created_at");
        recipe.Property(r => r.UpdatedAt).HasColumnName("updated_at");
        recipe.Property(r => r.RetiredAt).HasColumnName("retired_at");
        recipe.HasIndex(r => new { r.UserId, r.RetiredAt });
        recipe.HasAlternateKey(r => new { r.UserId, r.Id }).HasName("ux_recipes_user_id");
        recipe.HasOne<AppUser>().WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Cascade);

        var ingredient = modelBuilder.Entity<RecipeIngredient>();
        ingredient.ToTable("recipe_ingredients", table =>
        {
            table.HasCheckConstraint(
                "ck_recipe_ingredients_food_owner",
                "food_owner_key = '' OR food_owner_key = user_id");
            table.HasCheckConstraint("ck_recipe_ingredients_amount", "amount > 0 AND amount <= 10000");
        });
        ingredient.HasKey(i => i.Id);
        ingredient.Property(i => i.Id).HasColumnName("id");
        ingredient.Property(i => i.UserId).HasColumnName("user_id").HasMaxLength(64);
        ingredient.Property(i => i.RecipeId).HasColumnName("recipe_id");
        ingredient.Property(i => i.Position).HasColumnName("position");
        ingredient.Property(i => i.FoodId).HasColumnName("food_id");
        ingredient.Property(i => i.FoodOwnerKey).HasColumnName("food_owner_key").HasMaxLength(64);
        ingredient.Property(i => i.Name).HasColumnName("name").HasMaxLength(300);
        ingredient.Property(i => i.Amount).HasColumnName("amount").HasPrecision(8, 2);
        ingredient.Property(i => i.Unit).HasColumnName("unit").HasMaxLength(16);
        ingredient.Property(i => i.Grams).HasColumnName("grams").HasPrecision(8, 2);
        ingredient.Property(i => i.Kcal).HasColumnName("kcal").HasPrecision(8, 2);
        ingredient.Property(i => i.Protein).HasColumnName("protein").HasPrecision(8, 2);
        ingredient.Property(i => i.Fat).HasColumnName("fat").HasPrecision(8, 2);
        ingredient.Property(i => i.Carbs).HasColumnName("carbs").HasPrecision(8, 2);
        ingredient.Property(i => i.SaturatedFat).HasColumnName("saturated_fat").HasPrecision(8, 2);
        ingredient.Property(i => i.Sugars).HasColumnName("sugars").HasPrecision(8, 2);
        ingredient.Property(i => i.Fiber).HasColumnName("fiber").HasPrecision(8, 2);
        ingredient.Property(i => i.Salt).HasColumnName("salt").HasPrecision(8, 2);
        ingredient.Property(i => i.MonoFat).HasColumnName("mono_fat").HasPrecision(8, 2);
        ingredient.Property(i => i.PolyFat).HasColumnName("poly_fat").HasPrecision(8, 2);
        ingredient.Property(i => i.Omega3).HasColumnName("omega3").HasPrecision(8, 2);
        ingredient.Property(i => i.Omega6).HasColumnName("omega6").HasPrecision(8, 2);
        ingredient.Property(i => i.TransFat).HasColumnName("trans_fat").HasPrecision(8, 2);
        ingredient.Property(i => i.Cholesterol).HasColumnName("cholesterol").HasPrecision(8, 2);
        ingredient.Property(i => i.AddedSugars).HasColumnName("added_sugars").HasPrecision(8, 2);
        ingredient.Property(i => i.Sodium).HasColumnName("sodium").HasPrecision(8, 2);
        ingredient.Property(i => i.VitaminA).HasColumnName("vitamin_a").HasPrecision(8, 2);
        ingredient.Property(i => i.VitaminD).HasColumnName("vitamin_d").HasPrecision(8, 2);
        ingredient.Property(i => i.VitaminE).HasColumnName("vitamin_e").HasPrecision(8, 2);
        ingredient.Property(i => i.Thiamin).HasColumnName("thiamin").HasPrecision(8, 2);
        ingredient.Property(i => i.Riboflavin).HasColumnName("riboflavin").HasPrecision(8, 2);
        ingredient.Property(i => i.Niacin).HasColumnName("niacin").HasPrecision(8, 2);
        ingredient.Property(i => i.VitaminB6).HasColumnName("vitamin_b6").HasPrecision(8, 2);
        ingredient.Property(i => i.Folate).HasColumnName("folate").HasPrecision(8, 2);
        ingredient.Property(i => i.VitaminB12).HasColumnName("vitamin_b12").HasPrecision(8, 2);
        ingredient.Property(i => i.VitaminC).HasColumnName("vitamin_c").HasPrecision(8, 2);
        ingredient.Property(i => i.Calcium).HasColumnName("calcium").HasPrecision(8, 2);
        ingredient.Property(i => i.Iron).HasColumnName("iron").HasPrecision(8, 2);
        ingredient.Property(i => i.Zinc).HasColumnName("zinc").HasPrecision(8, 2);
        ingredient.Property(i => i.Magnesium).HasColumnName("magnesium").HasPrecision(8, 2);
        ingredient.Property(i => i.Potassium).HasColumnName("potassium").HasPrecision(8, 2);
        ingredient.Property(i => i.Phosphorus).HasColumnName("phosphorus").HasPrecision(8, 2);
        ingredient.Property(i => i.Selenium).HasColumnName("selenium").HasPrecision(8, 2);
        ingredient.Property(i => i.Iodine).HasColumnName("iodine").HasPrecision(8, 2);

        ingredient.HasIndex(i => new { i.RecipeId, i.Position }).IsUnique();
        ingredient.HasOne<Recipe>()
            .WithMany()
            .HasForeignKey(i => new { i.UserId, i.RecipeId })
            .HasPrincipalKey(r => new { r.UserId, r.Id })
            .OnDelete(DeleteBehavior.Cascade)
            .HasConstraintName("fk_recipe_ingredients_recipe_owner");
        ingredient.HasOne<Food>()
            .WithMany()
            .HasForeignKey(i => new { i.FoodOwnerKey, i.FoodId })
            .HasPrincipalKey(f => new { f.OwnerKey, f.Id })
            .OnDelete(DeleteBehavior.NoAction)
            .HasConstraintName("fk_recipe_ingredients_food_owner");

        var day = modelBuilder.Entity<DayStatus>();
        day.ToTable("day_status");
        day.HasKey(d => new { d.UserId, d.LocalDate });
        day.Property(d => d.UserId).HasColumnName("user_id").HasMaxLength(64);
        day.Property(d => d.LocalDate).HasColumnName("local_date");
        day.Property(d => d.Complete).HasColumnName("complete");
        day.Property(d => d.Fasting).HasColumnName("fasting").HasDefaultValue(false);
        day.HasOne<AppUser>().WithMany().HasForeignKey(d => d.UserId).OnDelete(DeleteBehavior.Cascade);

        var push = modelBuilder.Entity<PushSubscription>();
        push.ToTable("push_subscriptions");
        push.HasKey(p => p.Id);
        push.Property(p => p.Id).HasColumnName("id");
        push.Property(p => p.UserId).HasColumnName("user_id").HasMaxLength(64);
        push.Property(p => p.Endpoint).HasColumnName("endpoint").HasMaxLength(2000);
        push.Property(p => p.P256dh).HasColumnName("p256dh").HasMaxLength(200);
        push.Property(p => p.Auth).HasColumnName("auth").HasMaxLength(200);
        push.Property(p => p.CreatedAt).HasColumnName("created_at");
        push.HasIndex(p => p.Endpoint).IsUnique();
        push.HasIndex(p => p.UserId);
        push.HasOne<AppUser>().WithMany().HasForeignKey(p => p.UserId).OnDelete(DeleteBehavior.Cascade);

        var sent = modelBuilder.Entity<ReminderSend>();
        sent.ToTable("reminder_sends");
        sent.HasKey(s => new { s.UserId, s.LocalDate, s.Kind });
        sent.Property(s => s.UserId).HasColumnName("user_id").HasMaxLength(64);
        sent.Property(s => s.LocalDate).HasColumnName("local_date");
        sent.Property(s => s.Kind).HasColumnName("kind").HasMaxLength(40);
        sent.Property(s => s.SentAt).HasColumnName("sent_at");
        sent.HasOne<AppUser>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);

        var note = modelBuilder.Entity<UserNotification>();
        note.ToTable("notifications");
        note.HasKey(n => n.Id);
        note.Property(n => n.Id).HasColumnName("id");
        note.Property(n => n.UserId).HasColumnName("user_id").HasMaxLength(64);
        note.Property(n => n.Type).HasColumnName("type").HasMaxLength(40);
        note.Property(n => n.Title).HasColumnName("title").HasMaxLength(200);
        note.Property(n => n.Body).HasColumnName("body").HasMaxLength(500);
        note.Property(n => n.Link).HasColumnName("link").HasMaxLength(200);
        note.Property(n => n.WeekStart).HasColumnName("week_start");
        note.Property(n => n.CreatedAt).HasColumnName("created_at");
        note.Property(n => n.ReadAt).HasColumnName("read_at");
        note.HasIndex(n => new { n.UserId, n.Type, n.WeekStart }).IsUnique();
        note.HasIndex(n => new { n.UserId, n.CreatedAt });
        note.HasOne<AppUser>().WithMany().HasForeignKey(n => n.UserId).OnDelete(DeleteBehavior.Cascade);

        var credit = modelBuilder.Entity<FoodSourceCredit>();
        credit.ToTable("food_source_credits");
        credit.HasKey(c => c.Source);
        credit.Property(c => c.Source).HasColumnName("source").HasMaxLength(16);
        credit.Property(c => c.Citation).HasColumnName("citation").HasMaxLength(300);
        credit.Property(c => c.ImportedAt).HasColumnName("imported_at");
        credit.Property(c => c.FoodCount).HasColumnName("food_count");
    }
}
