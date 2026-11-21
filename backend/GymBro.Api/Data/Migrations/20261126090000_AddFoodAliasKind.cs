using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// Where a search phrase came from: our lexicon, a food table's own keyword, or a table keyword shared by many
    /// foods (a category, which finds foods but does not rank them). Existing phrases are all lexicon phrases.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261126090000_AddFoodAliasKind")]
    public partial class AddFoodAliasKind : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "kind",
                table: "food_aliases",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "lexicon");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DELETE FROM food_aliases WHERE kind <> 'lexicon';");
            migrationBuilder.DropColumn(name: "kind", table: "food_aliases");
        }
    }
}
