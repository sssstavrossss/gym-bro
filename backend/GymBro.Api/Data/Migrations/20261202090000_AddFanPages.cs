using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// Additive. The + fan's pages as the person arranged them, each the app's action ids joined by
    /// commas. Null until the app first saves a layout.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261202090000_AddFanPages")]
    public partial class AddFanPages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string[]>(name: "fan_pages", table: "profiles", type: "text[]", nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "fan_pages", table: "profiles");
        }
    }
}
