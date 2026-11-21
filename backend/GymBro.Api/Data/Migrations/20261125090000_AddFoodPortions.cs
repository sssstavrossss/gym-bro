using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>Matvaretabellen household measures (slice, tablespoon, glass, dl) on each food. Filled by the next import.</summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261125090000_AddFoodPortions")]
    public partial class AddFoodPortions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "portions", table: "foods", type: "jsonb", nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "portions", table: "foods");
        }
    }
}
