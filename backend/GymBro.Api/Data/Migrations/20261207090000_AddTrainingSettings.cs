using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GymBro.Api.Data.Migrations
{
    /// <summary>
    /// Additive. Your training on the profile: time, experience, equipment, areas to go easy on, warm-up and
    /// cool-down, which every new plan starts from. All null until first saved; a plan saved after this fills them.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20261207090000_AddTrainingSettings")]
    public partial class AddTrainingSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(name: "training_minutes", table: "profiles", type: "integer", nullable: true);
            migrationBuilder.AddColumn<string>(name: "training_experience", table: "profiles", type: "text", nullable: true);
            migrationBuilder.AddColumn<string[]>(name: "training_equipment", table: "profiles", type: "text[]", nullable: true);
            migrationBuilder.AddColumn<string[]>(name: "training_go_easy", table: "profiles", type: "text[]", nullable: true);
            migrationBuilder.AddColumn<bool>(name: "training_warm_up", table: "profiles", type: "boolean", nullable: true);
            migrationBuilder.AddColumn<bool>(name: "training_cool_down", table: "profiles", type: "boolean", nullable: true);

            // Someone with a plan already answered these: keep them, so their next plan starts from the same.
            migrationBuilder.Sql("""
                UPDATE profiles p
                SET training_minutes = t.minutes, training_experience = t.experience, training_equipment = t.equipment,
                    training_go_easy = t.go_easy, training_warm_up = t.warm_up, training_cool_down = t.cool_down
                FROM training_plans t
                WHERE t.user_id = p.user_id;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var column in new[] { "training_minutes", "training_experience", "training_equipment", "training_go_easy", "training_warm_up", "training_cool_down" })
            {
                migrationBuilder.DropColumn(name: column, table: "profiles");
            }
        }
    }
}
