using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddKassalappBasisConfirmation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_foods_nutrient_basis",
                table: "foods");

            migrationBuilder.AlterColumn<string>(
                name: "basis",
                table: "foods",
                type: "character varying(8)",
                maxLength: 8,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(8)",
                oldMaxLength: 8);

            migrationBuilder.CreateTable(
                name: "food_basis_confirmations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    food_id = table.Column<Guid>(type: "uuid", nullable: false),
                    basis = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    nutrition_stamp = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    confirmed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_food_basis_confirmations", x => x.id);
                    table.CheckConstraint("ck_food_basis_confirmations_basis", "basis IN ('g', 'ml')");
                    table.ForeignKey(
                        name: "FK_food_basis_confirmations_foods_food_id",
                        column: x => x.food_id,
                        principalTable: "foods",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_food_basis_confirmations_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "object_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_foods_nutrient_basis",
                table: "foods",
                sql: "(nutrient_basis = 'per_100' AND basis IN ('g', 'ml')) OR (nutrient_basis = 'per_serving' AND basis = 'serving' AND serving_quantity IS NULL AND piece_quantity IS NULL) OR (nutrient_basis = 'unconfirmed' AND basis IS NULL AND source = 'kassalapp')");

            migrationBuilder.CreateIndex(
                name: "IX_food_basis_confirmations_food_id",
                table: "food_basis_confirmations",
                column: "food_id");

            migrationBuilder.CreateIndex(
                name: "IX_food_basis_confirmations_user_id_food_id",
                table: "food_basis_confirmations",
                columns: new[] { "user_id", "food_id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Unconfirmed rows have a null basis. Making basis required again fails, and deleting
            // those foods would set log_entries.food_id to null. Refuse instead of doing either.
            migrationBuilder.Sql(
                """
                DO $$
                BEGIN
                  IF EXISTS (SELECT 1 FROM foods WHERE basis IS NULL OR nutrient_basis = 'unconfirmed') THEN
                    RAISE EXCEPTION 'Do not roll back AddKassalappBasisConfirmation while an unconfirmed food exists. Retiring those rows does not make this rollback succeed. Revert the application code and leave this schema. To hide the catalogue from search: UPDATE foods SET retired_at = now() WHERE source = ''kassalapp'' AND retired_at IS NULL. Do not DELETE those rows: log_entries.food_id is ON DELETE SET NULL.';
                  END IF;
                END $$;
                """);
            migrationBuilder.DropTable(
                name: "food_basis_confirmations");

            migrationBuilder.DropCheckConstraint(
                name: "ck_foods_nutrient_basis",
                table: "foods");

            migrationBuilder.AlterColumn<string>(
                name: "basis",
                table: "foods",
                type: "character varying(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(8)",
                oldMaxLength: 8,
                oldNullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_foods_nutrient_basis",
                table: "foods",
                sql: "(nutrient_basis = 'per_100' AND basis IN ('g', 'ml')) OR (nutrient_basis = 'per_serving' AND basis = 'serving' AND serving_quantity IS NULL AND piece_quantity IS NULL)");
        }
    }
}
