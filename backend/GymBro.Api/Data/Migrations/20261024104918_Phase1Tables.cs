using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class Phase1Tables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "day_status",
                columns: table => new
                {
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    local_date = table.Column<DateOnly>(type: "date", nullable: false),
                    complete = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_day_status", x => new { x.user_id, x.local_date });
                    table.ForeignKey(
                        name: "FK_day_status_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "object_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "entry_groups",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_entry_groups", x => x.id);
                    table.ForeignKey(
                        name: "FK_entry_groups_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "object_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "food_source_credits",
                columns: table => new
                {
                    source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    citation = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    imported_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    food_count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_food_source_credits", x => x.source);
                });

            migrationBuilder.CreateTable(
                name: "foods",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    source_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    barcode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    basis = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    kcal_per_100 = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    protein_per_100 = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    fat_per_100 = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    carbs_per_100 = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    serving_quantity = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                    serving_label = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    piece_quantity = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                    piece_label = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    retired_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_foods", x => x.id);
                    table.CheckConstraint("ck_foods_catalog_owner", "source = 'custom' OR user_id IS NULL");
                    table.CheckConstraint("ck_foods_custom_owner", "source <> 'custom' OR user_id IS NOT NULL");
                    table.ForeignKey(
                        name: "FK_foods_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "object_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "profiles",
                columns: table => new
                {
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    sex = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    birth_year = table.Column<int>(type: "integer", nullable: false),
                    height_cm = table.Column<decimal>(type: "numeric(5,1)", precision: 5, scale: 1, nullable: false),
                    activity = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    goal = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    rate_kg_per_week = table.Column<decimal>(type: "numeric(3,2)", precision: 3, scale: 2, nullable: true),
                    goal_weight_kg = table.Column<decimal>(type: "numeric(5,1)", precision: 5, scale: 1, nullable: false),
                    protein_setting = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    protein_grams_per_kg = table.Column<decimal>(type: "numeric(3,1)", precision: 3, scale: 1, nullable: false),
                    fat_setting = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    fat_percent = table.Column<decimal>(type: "numeric(4,1)", precision: 4, scale: 1, nullable: false),
                    time_zone = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_profiles", x => x.user_id);
                    table.ForeignKey(
                        name: "FK_profiles_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "object_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "target_history",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    effective_date = table.Column<DateOnly>(type: "date", nullable: false),
                    bmr = table.Column<int>(type: "integer", nullable: false),
                    tdee = table.Column<int>(type: "integer", nullable: false),
                    kcal = table.Column<int>(type: "integer", nullable: false),
                    protein_grams = table.Column<int>(type: "integer", nullable: false),
                    fat_grams = table.Column<int>(type: "integer", nullable: false),
                    carb_grams = table.Column<int>(type: "integer", nullable: false),
                    floor_applied = table.Column<bool>(type: "boolean", nullable: false),
                    reason = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    weight_kg = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_target_history", x => x.id);
                    table.ForeignKey(
                        name: "FK_target_history_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "object_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "weigh_ins",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    local_date = table.Column<DateOnly>(type: "date", nullable: false),
                    kg = table.Column<decimal>(type: "numeric(5,1)", precision: 5, scale: 1, nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_weigh_ins", x => x.id);
                    table.ForeignKey(
                        name: "FK_weigh_ins_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "object_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "log_entries",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    local_date = table.Column<DateOnly>(type: "date", nullable: false),
                    logged_at = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    time_zone = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    group_id = table.Column<Guid>(type: "uuid", nullable: true),
                    food_id = table.Column<Guid>(type: "uuid", nullable: true),
                    source = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    source_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    grams = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                    name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    amount = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    unit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    kcal = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    protein = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    fat = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    carbs = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    idempotency_key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_log_entries", x => x.id);
                    table.ForeignKey(
                        name: "FK_log_entries_entry_groups_group_id",
                        column: x => x.group_id,
                        principalTable: "entry_groups",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_log_entries_foods_food_id",
                        column: x => x.food_id,
                        principalTable: "foods",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_log_entries_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "object_id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_entry_groups_user_id",
                table: "entry_groups",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_foods_barcode",
                table: "foods",
                column: "barcode");

            migrationBuilder.CreateIndex(
                name: "IX_foods_source_source_id",
                table: "foods",
                columns: new[] { "source", "source_id" },
                unique: true,
                filter: "user_id IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_foods_user_id_source_source_id",
                table: "foods",
                columns: new[] { "user_id", "source", "source_id" },
                unique: true,
                filter: "user_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_log_entries_food_id",
                table: "log_entries",
                column: "food_id");

            migrationBuilder.CreateIndex(
                name: "IX_log_entries_group_id",
                table: "log_entries",
                column: "group_id");

            migrationBuilder.CreateIndex(
                name: "IX_log_entries_user_id_idempotency_key",
                table: "log_entries",
                columns: new[] { "user_id", "idempotency_key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_log_entries_user_id_local_date",
                table: "log_entries",
                columns: new[] { "user_id", "local_date" });

            migrationBuilder.CreateIndex(
                name: "ix_target_history_user_date",
                table: "target_history",
                columns: new[] { "user_id", "effective_date", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ux_target_history_weekly",
                table: "target_history",
                columns: new[] { "user_id", "effective_date" },
                unique: true,
                filter: "reason = 'weekly_recalculation'");

            migrationBuilder.CreateIndex(
                name: "IX_weigh_ins_user_id_local_date",
                table: "weigh_ins",
                columns: new[] { "user_id", "local_date" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "day_status");

            migrationBuilder.DropTable(
                name: "food_source_credits");

            migrationBuilder.DropTable(
                name: "log_entries");

            migrationBuilder.DropTable(
                name: "profiles");

            migrationBuilder.DropTable(
                name: "target_history");

            migrationBuilder.DropTable(
                name: "weigh_ins");

            migrationBuilder.DropTable(
                name: "entry_groups");

            migrationBuilder.DropTable(
                name: "foods");
        }
    }
}
