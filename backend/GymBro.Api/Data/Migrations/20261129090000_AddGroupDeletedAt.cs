using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// Additive. Deleting a saved group now sets <c>deleted_at</c> instead of removing the row, so the toast's Undo
    /// can bring it back (<c>POST /api/groups/{id}/restore</c>). Groups deleted before this were removed for good.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261129090000_AddGroupDeletedAt")]
    public partial class AddGroupDeletedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "deleted_at",
                table: "entry_groups",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DELETE FROM entry_groups WHERE deleted_at IS NOT NULL;");
            migrationBuilder.DropColumn(name: "deleted_at", table: "entry_groups");
        }
    }
}
