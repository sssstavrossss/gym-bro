using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>The Fats card's saturated fat and cholesterol limits: normal (the default) or lower.</summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261118090000_AddFatLimits")]
    public partial class AddFatLimits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "fat_limits",
                table: "profiles",
                type: "character varying(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "normal");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "fat_limits", table: "profiles");
        }
    }
}
