using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// Additive. <c>meal_descriptions.kind</c> tells a described meal (<c>meal</c>) from a nutrition label read for
    /// New food (<c>label</c>), so both count toward the same daily limit. Every earlier row is a meal.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261130090000_AddMealKind")]
    public partial class AddMealKind : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "kind",
                table: "meal_descriptions",
                type: "character varying(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "meal");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DELETE FROM meal_descriptions WHERE kind <> 'meal';");
            migrationBuilder.DropColumn(name: "kind", table: "meal_descriptions");
        }
    }
}
