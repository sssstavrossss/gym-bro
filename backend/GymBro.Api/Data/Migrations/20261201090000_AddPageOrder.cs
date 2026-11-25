using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// Additive. The macros card's and the Progress card's page order, as the app's ids, saved on the
    /// account like the hidden lists. Null until the app first saves an order.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261201090000_AddPageOrder")]
    public partial class AddPageOrder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string[]>(name: "macros_order", table: "profiles", type: "text[]", nullable: true);
            migrationBuilder.AddColumn<string[]>(name: "progress_order", table: "profiles", type: "text[]", nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "macros_order", table: "profiles");
            migrationBuilder.DropColumn(name: "progress_order", table: "profiles");
        }
    }
}
