using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class FoundationsHardening : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Keeps deployed Phase 1 rows. Same-day target_history rows collapse onto
            // the latest one (created_at, then id) and reasons are the distinct values
            // in the order they first appeared. Cross-user food and group references
            // are cleared so the new keys can be added.
            //
            // The foreign keys use ON DELETE SET NULL of only the nullable column.
            // The EF model records NO ACTION, because food_owner_key and user_id are
            // not nullable. A later migrations add compares the model to the snapshot
            // and will not rewrite this SQL.
            migrationBuilder.Sql(
                """
                ALTER TABLE log_entries DROP CONSTRAINT "FK_log_entries_entry_groups_group_id";
                ALTER TABLE log_entries DROP CONSTRAINT "FK_log_entries_foods_food_id";

                DROP INDEX ix_target_history_user_date;
                DROP INDEX ux_target_history_weekly;
                DROP INDEX "IX_log_entries_food_id";
                DROP INDEX "IX_log_entries_group_id";

                ALTER TABLE target_history ADD COLUMN reasons text[];

                WITH ordered_reasons AS (
                    SELECT user_id, effective_date, reason,
                           MIN(created_at) AS first_at,
                           MIN(id) AS first_id
                    FROM target_history
                    GROUP BY user_id, effective_date, reason
                ),
                survivors AS (
                    SELECT DISTINCT ON (user_id, effective_date)
                           id, user_id, effective_date
                    FROM target_history
                    ORDER BY user_id, effective_date, created_at DESC, id DESC
                ),
                merged AS (
                    SELECT s.id,
                           ARRAY(
                               SELECT o.reason
                               FROM ordered_reasons AS o
                               WHERE o.user_id = s.user_id
                                 AND o.effective_date = s.effective_date
                               ORDER BY o.first_at, o.first_id
                           ) AS reasons
                    FROM survivors AS s
                )
                UPDATE target_history AS t
                SET reasons = m.reasons
                FROM merged AS m
                WHERE t.id = m.id;

                DELETE FROM target_history AS t
                WHERE t.reasons IS NULL;

                ALTER TABLE target_history DROP COLUMN reason;
                ALTER TABLE target_history ALTER COLUMN reasons SET NOT NULL;

                CREATE UNIQUE INDEX ux_target_history_user_date
                    ON target_history (user_id, effective_date);

                ALTER TABLE log_entries
                    ADD COLUMN food_owner_key character varying(64) NOT NULL DEFAULT '';
                ALTER TABLE log_entries ALTER COLUMN food_owner_key DROP DEFAULT;

                ALTER TABLE foods
                    ADD COLUMN nutrient_basis character varying(16) NOT NULL DEFAULT 'per_100';
                ALTER TABLE foods ALTER COLUMN nutrient_basis DROP DEFAULT;

                ALTER TABLE foods
                    ADD COLUMN owner_key character varying(64)
                    GENERATED ALWAYS AS (COALESCE(user_id, '')) STORED;

                UPDATE log_entries AS e
                SET food_owner_key = f.owner_key
                FROM foods AS f
                WHERE e.food_id = f.id
                  AND (f.user_id IS NULL OR f.user_id = e.user_id);

                UPDATE log_entries AS e
                SET food_id = NULL,
                    food_owner_key = ''
                WHERE e.food_id IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1
                      FROM foods AS f
                      WHERE f.id = e.food_id
                        AND (f.user_id IS NULL OR f.user_id = e.user_id)
                  );

                UPDATE log_entries AS e
                SET group_id = NULL
                WHERE e.group_id IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1
                      FROM entry_groups AS g
                      WHERE g.id = e.group_id
                        AND g.user_id = e.user_id
                  );

                ALTER TABLE foods
                    ADD CONSTRAINT ux_foods_owner_key_id UNIQUE (owner_key, id);
                ALTER TABLE entry_groups
                    ADD CONSTRAINT ux_entry_groups_user_id UNIQUE (user_id, id);

                CREATE INDEX "IX_log_entries_food_owner_key_food_id"
                    ON log_entries (food_owner_key, food_id);
                CREATE INDEX "IX_log_entries_user_id_group_id"
                    ON log_entries (user_id, group_id);

                ALTER TABLE log_entries
                    ADD CONSTRAINT ck_log_entries_food_owner
                    CHECK (food_owner_key = '' OR food_owner_key = user_id);
                ALTER TABLE foods
                    ADD CONSTRAINT ck_foods_nutrient_basis
                    CHECK ((nutrient_basis = 'per_100' AND basis IN ('g', 'ml'))
                        OR (nutrient_basis = 'per_serving' AND basis = 'serving'
                            AND serving_quantity IS NULL AND piece_quantity IS NULL));

                ALTER TABLE log_entries
                    ADD CONSTRAINT fk_log_entries_food_owner
                    FOREIGN KEY (food_owner_key, food_id)
                    REFERENCES foods (owner_key, id)
                    ON DELETE SET NULL (food_id);
                ALTER TABLE log_entries
                    ADD CONSTRAINT fk_log_entries_group_owner
                    FOREIGN KEY (user_id, group_id)
                    REFERENCES entry_groups (user_id, id)
                    ON DELETE SET NULL (group_id);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_log_entries_food_owner",
                table: "log_entries");

            migrationBuilder.DropForeignKey(
                name: "fk_log_entries_group_owner",
                table: "log_entries");

            migrationBuilder.DropIndex(
                name: "ux_target_history_user_date",
                table: "target_history");

            migrationBuilder.DropIndex(
                name: "IX_log_entries_food_owner_key_food_id",
                table: "log_entries");

            migrationBuilder.DropIndex(
                name: "IX_log_entries_user_id_group_id",
                table: "log_entries");

            migrationBuilder.DropCheckConstraint(
                name: "ck_log_entries_food_owner",
                table: "log_entries");

            migrationBuilder.DropUniqueConstraint(
                name: "ux_foods_owner_key_id",
                table: "foods");

            migrationBuilder.DropCheckConstraint(
                name: "ck_foods_nutrient_basis",
                table: "foods");

            migrationBuilder.DropUniqueConstraint(
                name: "ux_entry_groups_user_id",
                table: "entry_groups");

            migrationBuilder.DropColumn(
                name: "owner_key",
                table: "foods");

            migrationBuilder.DropColumn(
                name: "food_owner_key",
                table: "log_entries");

            migrationBuilder.DropColumn(
                name: "nutrient_basis",
                table: "foods");

            // Lossy: merged rows stay merged, and only the last reason is kept.
            migrationBuilder.AddColumn<string>(
                name: "reason",
                table: "target_history",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.Sql(
                """
                UPDATE target_history
                SET reason = reasons[cardinality(reasons)];
                """);

            migrationBuilder.DropColumn(
                name: "reasons",
                table: "target_history");

            migrationBuilder.AlterColumn<string>(
                name: "reason",
                table: "target_history",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32,
                oldNullable: true);

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
                name: "IX_log_entries_food_id",
                table: "log_entries",
                column: "food_id");

            migrationBuilder.CreateIndex(
                name: "IX_log_entries_group_id",
                table: "log_entries",
                column: "group_id");

            migrationBuilder.AddForeignKey(
                name: "FK_log_entries_entry_groups_group_id",
                table: "log_entries",
                column: "group_id",
                principalTable: "entry_groups",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_log_entries_foods_food_id",
                table: "log_entries",
                column: "food_id",
                principalTable: "foods",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }
    }
}
