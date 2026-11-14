using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// Additive. Existing people keep every notification type on.
    /// Push still sends only when reminders were already turned on.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261114010000_AddNotifyRecalculate")]
    public partial class AddNotifyRecalculate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "notify_recalculate",
                table: "profiles",
                type: "boolean",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "notify_recalculate",
                table: "profiles");
        }
    }
}
