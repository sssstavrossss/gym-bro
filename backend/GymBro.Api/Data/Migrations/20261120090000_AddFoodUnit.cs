using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>How food amounts are shown: g (the default, grams and millilitres) or oz (ounces and fluid ounces).</summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261120090000_AddFoodUnit")]
    public partial class AddFoodUnit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "food_unit",
                table: "profiles",
                type: "character varying(4)",
                maxLength: 4,
                nullable: false,
                defaultValue: "g");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "food_unit", table: "profiles");
        }
    }
}
