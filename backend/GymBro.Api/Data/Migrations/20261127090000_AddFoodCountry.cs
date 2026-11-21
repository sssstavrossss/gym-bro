using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>Additive. Existing people follow their time zone's country, and none is picked by hand.</summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261127090000_AddFoodCountry")]
    public partial class AddFoodCountry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "food_country",
                table: "profiles",
                type: "character varying(2)",
                maxLength: 2,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<bool>(
                name: "food_country_follows_zone",
                table: "profiles",
                type: "boolean",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "food_country",
                table: "profiles");

            migrationBuilder.DropColumn(
                name: "food_country_follows_zone",
                table: "profiles");
        }
    }
}
