using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GymBro.Api.Foods;

/// <summary>
/// Writes the same folded text the search box builds. Postgres <c>lower()</c> and
/// <c>[:alnum:]</c> do not match that function for accents and combining marks.
/// </summary>
public sealed class FoodSearchTextInterceptor : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Stamp(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Stamp(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    public static void Stamp(DbContext? context)
    {
        if (context is null)
        {
            return;
        }

        foreach (var entry in context.ChangeTracker.Entries<Food>())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified))
            {
                continue;
            }

            entry.Property(food => food.SearchName).CurrentValue = FoodAliasCatalogue.Normalize(entry.Entity.Name);
            entry.Property(food => food.SearchNameEn).CurrentValue = FoodAliasCatalogue.Normalize(entry.Entity.NameEn);
            entry.Property(food => food.SearchBrand).CurrentValue = FoodAliasCatalogue.Normalize(entry.Entity.Brand);
        }
    }

    public static async Task BackfillAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var batch = await db.Foods
                .Where(food => food.SearchName == null || food.SearchNameEn == null)
                .OrderBy(food => food.Id)
                .Take(500)
                .ToListAsync(cancellationToken);
            if (batch.Count == 0)
            {
                return;
            }

            foreach (var food in batch)
            {
                food.SearchName = FoodAliasCatalogue.Normalize(food.Name);
                food.SearchNameEn = FoodAliasCatalogue.Normalize(food.NameEn);
            }

            await db.SaveChangesAsync(cancellationToken);
            db.ChangeTracker.Clear();
        }
    }
}
