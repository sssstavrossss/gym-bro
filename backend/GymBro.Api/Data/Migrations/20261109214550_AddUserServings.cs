using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddUserServings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "user_servings",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    food_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    name_key = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    grams = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_servings", x => x.id);
                    table.CheckConstraint("ck_user_servings_grams", "grams > 0 AND grams <= 10000");
                    table.CheckConstraint("ck_user_servings_name", "char_length(name) BETWEEN 1 AND 16");
                    table.ForeignKey(
                        name: "FK_user_servings_foods_food_id",
                        column: x => x.food_id,
                        principalTable: "foods",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_user_servings_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "object_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_user_servings_food_id",
                table: "user_servings",
                column: "food_id");

            migrationBuilder.CreateIndex(
                name: "IX_user_servings_user_id_food_id_name_key",
                table: "user_servings",
                columns: new[] { "user_id", "food_id", "name_key" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "user_servings");
        }
    }
}
