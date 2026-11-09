using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEntryGroupItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "entry_group_items",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    group_id = table.Column<Guid>(type: "uuid", nullable: false),
                    position = table.Column<int>(type: "integer", nullable: false),
                    food_id = table.Column<Guid>(type: "uuid", nullable: true),
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
                    table.PrimaryKey("PK_entry_group_items", x => x.id);
                    table.CheckConstraint("ck_entry_group_items_food_owner", "food_owner_key = '' OR food_owner_key = user_id");
                    table.ForeignKey(
                        name: "fk_entry_group_items_food_owner",
                        columns: x => new { x.food_owner_key, x.food_id },
                        principalTable: "foods",
                        principalColumns: new[] { "owner_key", "id" });
                    table.ForeignKey(
                        name: "fk_entry_group_items_group_owner",
                        columns: x => new { x.user_id, x.group_id },
                        principalTable: "entry_groups",
                        principalColumns: new[] { "user_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_entry_group_items_food_owner_key_food_id",
                table: "entry_group_items",
                columns: new[] { "food_owner_key", "food_id" });

            migrationBuilder.CreateIndex(
                name: "IX_entry_group_items_group_id_position",
                table: "entry_group_items",
                columns: new[] { "group_id", "position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_entry_group_items_user_id_group_id",
                table: "entry_group_items",
                columns: new[] { "user_id", "group_id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "entry_group_items");
        }
    }
}
