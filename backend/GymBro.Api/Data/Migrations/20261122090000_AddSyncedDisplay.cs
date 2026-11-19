using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// Display choices that follow the account: hidden Home cards and card pages (null until the app
    /// first saves them, so it can adopt what a device already had), and "Keep my goal" on goal reached.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261122090000_AddSyncedDisplay")]
    public partial class AddSyncedDisplay : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(name: "goal_kept_on", table: "profiles", type: "date", nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "goal_kept_kg", table: "profiles", type: "numeric(5,2)", precision: 5, scale: 2, nullable: true);
            migrationBuilder.AddColumn<string[]>(name: "home_hidden", table: "profiles", type: "text[]", nullable: true);
            migrationBuilder.AddColumn<string[]>(name: "macros_hidden", table: "profiles", type: "text[]", nullable: true);
            migrationBuilder.AddColumn<string[]>(name: "progress_hidden", table: "profiles", type: "text[]", nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "goal_kept_on", table: "profiles");
            migrationBuilder.DropColumn(name: "goal_kept_kg", table: "profiles");
            migrationBuilder.DropColumn(name: "home_hidden", table: "profiles");
            migrationBuilder.DropColumn(name: "macros_hidden", table: "profiles");
            migrationBuilder.DropColumn(name: "progress_hidden", table: "profiles");
        }
    }
}
