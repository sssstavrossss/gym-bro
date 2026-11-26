using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// Additive. A plan's mobility settings: a warm-up of dynamic moves and a cool-down of stretches. Existing plans
    /// get both off, so they stay as they are.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261206090000_AddPlanMobility")]
    public partial class AddPlanMobility : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "warm_up", table: "training_plans", type: "boolean", nullable: false, defaultValue: false);
            migrationBuilder.AddColumn<bool>(
                name: "cool_down", table: "training_plans", type: "boolean", nullable: false, defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "warm_up", table: "training_plans");
            migrationBuilder.DropColumn(name: "cool_down", table: "training_plans");
        }
    }
}
