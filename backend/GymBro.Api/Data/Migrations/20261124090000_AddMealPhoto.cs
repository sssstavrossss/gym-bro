using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>Describe a meal takes a photo: each attempt records whether one was sent. The photo isn't stored.</summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261124090000_AddMealPhoto")]
    public partial class AddMealPhoto : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(name: "has_photo", table: "meal_descriptions", type: "boolean", nullable: false, defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "has_photo", table: "meal_descriptions");
        }
    }
}
