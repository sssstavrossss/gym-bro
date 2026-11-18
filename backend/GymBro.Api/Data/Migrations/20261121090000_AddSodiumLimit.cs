using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>The sodium limit on the Carbs card and Progress: normal (the default) or lower.</summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261121090000_AddSodiumLimit")]
    public partial class AddSodiumLimit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "sodium_limit",
                table: "profiles",
                type: "character varying(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "normal");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "sodium_limit", table: "profiles");
        }
    }
}
