using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// Additive. Trigram indexes over the catalogue's folded names and phrases, so a misspelt search word can be
    /// matched to a word the catalogue has (see <c>FoodSpelling</c>). <c>food_fold</c> drops accents and the Nordic
    /// letters (<c>kjøttdeig</c> is <c>kjottdeig</c>); it is immutable so an index can use it. Search phrases grow
    /// to 300 characters, the length of a name, for a table's name written another way.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261128090000_AddFoodSpelling")]
    public partial class AddFoodSpelling : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "phrase",
                table: "food_aliases",
                type: "character varying(300)",
                maxLength: 300,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(80)",
                oldMaxLength: 80);

            migrationBuilder.AlterColumn<string>(
                name: "normalized",
                table: "food_aliases",
                type: "character varying(300)",
                maxLength: 300,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(80)",
                oldMaxLength: 80);

            migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
            migrationBuilder.Sql("""
                CREATE FUNCTION food_fold(text) RETURNS text
                LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
                AS $$ SELECT translate(replace(replace($1, 'æ', 'ae'), 'ß', 'ss'),
                    'øåäöüéèêëáàâãíìîïóòôõúùûñçý',
                    'oaaoueeeeaaaaiiiioooouuuncy') $$;
                """);
            migrationBuilder.Sql("""
                CREATE INDEX ix_foods_spelling_name ON foods USING gin (food_fold(search_name) gin_trgm_ops)
                WHERE retired_at IS NULL AND user_id IS NULL;
                """);
            migrationBuilder.Sql("""
                CREATE INDEX ix_foods_spelling_name_en ON foods USING gin (food_fold(search_name_en) gin_trgm_ops)
                WHERE retired_at IS NULL AND user_id IS NULL;
                """);
            migrationBuilder.Sql("""
                CREATE INDEX ix_food_aliases_spelling ON food_aliases USING gin (food_fold(normalized) gin_trgm_ops);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_food_aliases_spelling;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_foods_spelling_name_en;");
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_foods_spelling_name;");
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS food_fold(text);");

            // A table's name written another way is longer than the old column; the next import writes it again.
            migrationBuilder.Sql("DELETE FROM food_aliases WHERE length(phrase) > 80 OR length(normalized) > 80;");
            migrationBuilder.AlterColumn<string>(
                name: "normalized",
                table: "food_aliases",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(300)",
                oldMaxLength: 300);

            migrationBuilder.AlterColumn<string>(
                name: "phrase",
                table: "food_aliases",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(300)",
                oldMaxLength: 300);
        }
    }
}
