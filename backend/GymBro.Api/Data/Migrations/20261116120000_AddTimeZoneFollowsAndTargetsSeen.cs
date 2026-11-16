using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// Additive. Existing people follow their device's time zone, and every
    /// target change so far counts as seen, so nothing old shows up as new.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261116120000_AddTimeZoneFollowsAndTargetsSeen")]
    public partial class AddTimeZoneFollowsAndTargetsSeen : Migration
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

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "targets_seen_at",
                table: "profiles",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.Sql("UPDATE profiles SET targets_seen_at = now();");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "targets_seen_at",
                table: "profiles");

            migrationBuilder.DropColumn(
                name: "time_zone_follows_device",
                table: "profiles");
        }
    }
}
