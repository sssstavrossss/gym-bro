using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// Additive. A workout's blocks done on the clock (EMOM, AMRAP, for time) with their scores, as JSON keyed by
    /// the sets' block. Existing workouts get "[]".
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261205090000_AddTimedBlocks")]
    public partial class AddTimedBlocks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "blocks", table: "workout_sessions", type: "jsonb", nullable: false, defaultValueSql: "'[]'::jsonb");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "blocks", table: "workout_sessions");
        }
    }
}
