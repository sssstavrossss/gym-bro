using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddWorkouts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "workout_sessions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    local_date = table.Column<DateOnly>(type: "date", nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ended_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    plan_workout_id = table.Column<Guid>(type: "uuid", nullable: true),
                    sequence_position = table.Column<int>(type: "integer", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_workout_sessions", x => x.id);
                    table.ForeignKey(
                        name: "FK_workout_sessions_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "object_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "workout_sets",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    session_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    exercise_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    block = table.Column<int>(type: "integer", nullable: false),
                    position = table.Column<int>(type: "integer", nullable: false),
                    type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    reps = table.Column<int>(type: "integer", nullable: true),
                    kg = table.Column<decimal>(type: "numeric(7,2)", precision: 7, scale: 2, nullable: true),
                    rir = table.Column<int>(type: "integer", nullable: true),
                    seconds = table.Column<int>(type: "integer", nullable: true),
                    metres = table.Column<decimal>(type: "numeric(9,1)", precision: 9, scale: 1, nullable: true),
                    calories = table.Column<int>(type: "integer", nullable: true),
                    done_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_workout_sets", x => x.id);
                    table.ForeignKey(
                        name: "FK_workout_sets_workout_sessions_session_id",
                        column: x => x.session_id,
                        principalTable: "workout_sessions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_workout_sessions_user_id_local_date",
                table: "workout_sessions",
                columns: new[] { "user_id", "local_date" });

            migrationBuilder.CreateIndex(
                name: "IX_workout_sets_session_id_position",
                table: "workout_sets",
                columns: new[] { "session_id", "position" });

            migrationBuilder.CreateIndex(
                name: "IX_workout_sets_user_id_exercise_id",
                table: "workout_sets",
                columns: new[] { "user_id", "exercise_id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "workout_sets");

            migrationBuilder.DropTable(
                name: "workout_sessions");
        }
    }
}
