using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// Additive. Declined recalculations are their own rows. They do not
    /// change the target in effect and do not collapse onto a day's history row.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261114090000_AddRecalculationDeclines")]
    public partial class AddRecalculationDeclines : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "recalculation_declines",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    period_from = table.Column<DateOnly>(type: "date", nullable: false),
                    period_to = table.Column<DateOnly>(type: "date", nullable: false),
                    suggested_bmr = table.Column<int>(type: "integer", nullable: false),
                    suggested_tdee = table.Column<int>(type: "integer", nullable: false),
                    suggested_kcal = table.Column<int>(type: "integer", nullable: false),
                    suggested_protein = table.Column<int>(type: "integer", nullable: false),
                    suggested_fat = table.Column<int>(type: "integer", nullable: false),
                    suggested_carbs = table.Column<int>(type: "integer", nullable: false),
                    kept_kcal = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_recalculation_declines", x => x.id);
                    table.ForeignKey(
                        name: "fk_recalculation_declines_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "object_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_recalculation_declines_user_id_created_at",
                table: "recalculation_declines",
                columns: new[] { "user_id", "created_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "recalculation_declines");
        }
    }
}
