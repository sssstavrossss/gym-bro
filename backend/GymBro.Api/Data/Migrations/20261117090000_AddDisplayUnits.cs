using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// Display units (kg or lb, cm or ft and in) and a second decimal on stored kilograms,
    /// so a weight typed in pounds comes back as typed. Widening the numeric columns keeps every value.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261117090000_AddDisplayUnits")]
    public partial class AddDisplayUnits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "weight_unit",
                table: "profiles",
                type: "character varying(4)",
                maxLength: 4,
                nullable: false,
                defaultValue: "kg");

            migrationBuilder.AddColumn<string>(
                name: "height_unit",
                table: "profiles",
                type: "character varying(4)",
                maxLength: 4,
                nullable: false,
                defaultValue: "cm");

            migrationBuilder.AlterColumn<decimal>(
                name: "kg",
                table: "weigh_ins",
                type: "numeric(5,2)",
                precision: 5,
                scale: 2,
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "numeric(5,1)",
                oldPrecision: 5,
                oldScale: 1);

            migrationBuilder.AlterColumn<decimal>(
                name: "goal_weight_kg",
                table: "profiles",
                type: "numeric(5,2)",
                precision: 5,
                scale: 2,
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "numeric(5,1)",
                oldPrecision: 5,
                oldScale: 1);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "weight_unit", table: "profiles");
            migrationBuilder.DropColumn(name: "height_unit", table: "profiles");

            migrationBuilder.AlterColumn<decimal>(
                name: "kg",
                table: "weigh_ins",
                type: "numeric(5,1)",
                precision: 5,
                scale: 1,
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "numeric(5,2)",
                oldPrecision: 5,
                oldScale: 2);

            migrationBuilder.AlterColumn<decimal>(
                name: "goal_weight_kg",
                table: "profiles",
                type: "numeric(5,1)",
                precision: 5,
                scale: 1,
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "numeric(5,2)",
                oldPrecision: 5,
                oldScale: 2);
        }
    }
}
