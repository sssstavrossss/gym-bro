using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddTrainingPlans : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "training_plans",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    goal = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    weekdays = table.Column<int[]>(type: "integer[]", nullable: false),
                    minutes = table.Column<int>(type: "integer", nullable: false),
                    experience = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    equipment = table.Column<string[]>(type: "text[]", nullable: false),
                    go_easy = table.Column<string[]>(type: "text[]", nullable: false),
                    ease_in = table.Column<bool>(type: "boolean", nullable: false),
                    split = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    block_weeks = table.Column<int>(type: "integer", nullable: false),
                    start_date = table.Column<DateOnly>(type: "date", nullable: false),
                    workouts = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_training_plans", x => x.id);
                    table.ForeignKey(
                        name: "FK_training_plans_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "object_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_training_plans_user_id",
                table: "training_plans",
                column: "user_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "training_plans");
        }
    }
}
