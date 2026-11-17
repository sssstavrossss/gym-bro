using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// A measured burn carried through profile changes: each target row keeps the
    /// formula burn it sat next to, how unsure its burn is, and JSON details for the
    /// history. A profile also remembers the fresh start it said "Not now" to.
    /// Existing rows get the formula burn from their own BMR and the profile's
    /// activity, and the formula's spread (350 kcal).
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261119090000_AddMeasuredBurn")]
    public partial class AddMeasuredBurn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "formula_tdee",
                table: "target_history",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "burn_sd_kcal",
                table: "target_history",
                type: "integer",
                nullable: false,
                defaultValue: 350);

            migrationBuilder.AddColumn<string>(
                name: "details",
                table: "target_history",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "fresh_start_declined_on",
                table: "profiles",
                type: "date",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE target_history t
                SET formula_tdee = coalesce(round(t.bmr * CASE p.activity
                    WHEN 'sedentary' THEN 1.2
                    WHEN 'light' THEN 1.375
                    WHEN 'moderate' THEN 1.55
                    WHEN 'very_active' THEN 1.725
                    WHEN 'athlete' THEN 1.9
                    ELSE NULL END), t.tdee)
                FROM profiles p
                WHERE p.user_id = t.user_id;
                UPDATE target_history SET formula_tdee = tdee WHERE formula_tdee = 0;
                ALTER TABLE target_history ALTER COLUMN formula_tdee DROP DEFAULT;
                ALTER TABLE target_history ALTER COLUMN burn_sd_kcal DROP DEFAULT;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "formula_tdee", table: "target_history");
            migrationBuilder.DropColumn(name: "burn_sd_kcal", table: "target_history");
            migrationBuilder.DropColumn(name: "details", table: "target_history");
            migrationBuilder.DropColumn(name: "fresh_start_declined_on", table: "profiles");
        }
    }
}
