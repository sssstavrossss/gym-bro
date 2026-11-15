using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// Additive. Copper (mg), starch (g), and EPA + DHA (g) per 100 on foods, and as snapshots on
    /// log entries, saved-group items, recipes, and recipe ingredients. Null means not known.
    /// Existing snapshots stay null. Running the Matvaretabellen import again fills the foods.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261115230000_AddCopperStarchEpaDha")]
    public partial class AddCopperStarchEpaDha : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(name: "copper_per_100", table: "foods", type: "numeric(8,2)", precision: 8, scale: 2, nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "starch_per_100", table: "foods", type: "numeric(8,2)", precision: 8, scale: 2, nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "epa_dha_per_100", table: "foods", type: "numeric(8,2)", precision: 8, scale: 2, nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "copper", table: "log_entries", type: "numeric(8,2)", precision: 8, scale: 2, nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "starch", table: "log_entries", type: "numeric(8,2)", precision: 8, scale: 2, nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "epa_dha", table: "log_entries", type: "numeric(8,2)", precision: 8, scale: 2, nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "copper", table: "entry_group_items", type: "numeric(8,2)", precision: 8, scale: 2, nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "starch", table: "entry_group_items", type: "numeric(8,2)", precision: 8, scale: 2, nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "epa_dha", table: "entry_group_items", type: "numeric(8,2)", precision: 8, scale: 2, nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "copper", table: "recipes", type: "numeric(8,2)", precision: 8, scale: 2, nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "starch", table: "recipes", type: "numeric(8,2)", precision: 8, scale: 2, nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "epa_dha", table: "recipes", type: "numeric(8,2)", precision: 8, scale: 2, nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "copper", table: "recipe_ingredients", type: "numeric(8,2)", precision: 8, scale: 2, nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "starch", table: "recipe_ingredients", type: "numeric(8,2)", precision: 8, scale: 2, nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "epa_dha", table: "recipe_ingredients", type: "numeric(8,2)", precision: 8, scale: 2, nullable: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "copper_per_100", table: "foods");
            migrationBuilder.DropColumn(name: "starch_per_100", table: "foods");
            migrationBuilder.DropColumn(name: "epa_dha_per_100", table: "foods");
            migrationBuilder.DropColumn(name: "copper", table: "log_entries");
            migrationBuilder.DropColumn(name: "starch", table: "log_entries");
            migrationBuilder.DropColumn(name: "epa_dha", table: "log_entries");
            migrationBuilder.DropColumn(name: "copper", table: "entry_group_items");
            migrationBuilder.DropColumn(name: "starch", table: "entry_group_items");
            migrationBuilder.DropColumn(name: "epa_dha", table: "entry_group_items");
            migrationBuilder.DropColumn(name: "copper", table: "recipes");
            migrationBuilder.DropColumn(name: "starch", table: "recipes");
            migrationBuilder.DropColumn(name: "epa_dha", table: "recipes");
            migrationBuilder.DropColumn(name: "copper", table: "recipe_ingredients");
            migrationBuilder.DropColumn(name: "starch", table: "recipe_ingredients");
            migrationBuilder.DropColumn(name: "epa_dha", table: "recipe_ingredients");
        }
    }
}
