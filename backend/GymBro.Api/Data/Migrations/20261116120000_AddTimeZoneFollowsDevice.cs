using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>Additive. Existing people follow their device's time zone.</summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261116120000_AddTimeZoneFollowsDevice")]
    public partial class AddTimeZoneFollowsDevice : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "time_zone_follows_device",
                table: "profiles",
                type: "boolean",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "time_zone_follows_device",
                table: "profiles");
        }
    }
}
