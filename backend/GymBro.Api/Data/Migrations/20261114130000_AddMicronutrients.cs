using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// Additive. Saturated fat, total sugars, fibre, and salt. Null means the
    /// source did not publish the number. Existing log, recipe, and group
    /// snapshots stay null; they are not back-filled.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261114130000_AddMicronutrients")]
    public partial class AddMicronutrients : Migration
    {
        private static readonly string[] Tables = ["foods", "log_entries", "recipes", "recipe_ingredients", "entry_group_items"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            foreach (var table in Tables)
            {
                var per100 = table == "foods";
                Add(migrationBuilder, table, per100 ? "saturated_fat_per_100" : "saturated_fat");
                Add(migrationBuilder, table, per100 ? "sugars_per_100" : "sugars");
                Add(migrationBuilder, table, per100 ? "fiber_per_100" : "fiber");
                Add(migrationBuilder, table, per100 ? "salt_per_100" : "salt");
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var table in Tables)
            {
                var per100 = table == "foods";
                migrationBuilder.DropColumn(name: per100 ? "saturated_fat_per_100" : "saturated_fat", table: table);
                migrationBuilder.DropColumn(name: per100 ? "sugars_per_100" : "sugars", table: table);
                migrationBuilder.DropColumn(name: per100 ? "fiber_per_100" : "fiber", table: table);
                migrationBuilder.DropColumn(name: per100 ? "salt_per_100" : "salt", table: table);
            }
        }

        private static void Add(MigrationBuilder migrationBuilder, string table, string name)
        {
            migrationBuilder.AddColumn<decimal>(
                name: name,
                table: table,
                type: "numeric(8,2)",
                precision: 8,
                scale: 2,
                nullable: true);
        }
    }
}
