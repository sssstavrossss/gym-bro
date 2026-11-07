using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFoodAliases : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "food_aliases",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    source_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    phrase = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    normalized = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    expected_name_en = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_food_aliases", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_food_aliases_source_source_id_normalized",
                table: "food_aliases",
                columns: new[] { "source", "source_id", "normalized" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "food_aliases");
        }
    }
}
