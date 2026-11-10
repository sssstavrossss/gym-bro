using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddRecipes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "recipes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    portions = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    finished_grams = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                    kcal = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    protein = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    fat = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    carbs = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    retired_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_recipes", x => x.id);
                    table.UniqueConstraint("ux_recipes_user_id", x => new { x.user_id, x.id });
                    table.CheckConstraint("ck_recipes_finished_grams", "finished_grams IS NULL OR (finished_grams > 0 AND finished_grams <= 100000)");
                    table.CheckConstraint("ck_recipes_portions", "portions > 0 AND portions <= 1000");
                    table.ForeignKey(
                        name: "FK_recipes_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "object_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "recipe_ingredients",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    recipe_id = table.Column<Guid>(type: "uuid", nullable: false),
                    position = table.Column<int>(type: "integer", nullable: false),
                    food_id = table.Column<Guid>(type: "uuid", nullable: false),
                    food_owner_key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    amount = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    unit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    grams = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                    kcal = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    protein = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    fat = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    carbs = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_recipe_ingredients", x => x.id);
                    table.CheckConstraint("ck_recipe_ingredients_amount", "amount > 0 AND amount <= 10000");
                    table.CheckConstraint("ck_recipe_ingredients_food_owner", "food_owner_key = '' OR food_owner_key = user_id");
                    table.ForeignKey(
                        name: "fk_recipe_ingredients_food_owner",
                        columns: x => new { x.food_owner_key, x.food_id },
                        principalTable: "foods",
                        principalColumns: new[] { "owner_key", "id" });
                    table.ForeignKey(
                        name: "fk_recipe_ingredients_recipe_owner",
                        columns: x => new { x.user_id, x.recipe_id },
                        principalTable: "recipes",
                        principalColumns: new[] { "user_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_recipe_ingredients_food_owner_key_food_id",
                table: "recipe_ingredients",
                columns: new[] { "food_owner_key", "food_id" });

            migrationBuilder.CreateIndex(
                name: "IX_recipe_ingredients_recipe_id_position",
                table: "recipe_ingredients",
                columns: new[] { "recipe_id", "position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_recipe_ingredients_user_id_recipe_id",
                table: "recipe_ingredients",
                columns: new[] { "user_id", "recipe_id" });

            migrationBuilder.CreateIndex(
                name: "IX_recipes_user_id_retired_at",
                table: "recipes",
                columns: new[] { "user_id", "retired_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "recipe_ingredients");

            migrationBuilder.DropTable(
                name: "recipes");
        }
    }
}
