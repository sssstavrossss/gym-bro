using System.Security.Claims;
using GymBro.Api.Auth;
using GymBro.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace GymBro.Api.Users;

public sealed class UserDirectory(AppDbContext db, TimeProvider clock)
{
    public async Task<UserResponse> UpsertAsync(ClaimsPrincipal principal, CancellationToken cancellationToken)
    {
        var objectId = ClaimsReader.ObjectId(principal);
        if (string.IsNullOrWhiteSpace(objectId))
        {
            throw new InvalidOperationException("Access token is missing an oid claim.");
        }

        // Two requests can arrive together the first time we see someone.
        // The second insert hits the primary key; detach and update instead.
        for (var attempt = 1; attempt <= 2; attempt++)
        {
            var now = clock.GetUtcNow();
            var user = await db.Users.FirstOrDefaultAsync(row => row.ObjectId == objectId, cancellationToken);
            if (user is null)
            {
                user = new AppUser
                {
                    ObjectId = objectId,
                    DisplayName = ClaimsReader.DisplayName(principal),
                    Email = ClaimsReader.Email(principal),
                    FirstSeenAt = now,
                    LastSeenAt = now,
                };
                db.Users.Add(user);
            }
            else
            {
                var name = ClaimsReader.DisplayName(principal);
                var email = ClaimsReader.Email(principal);
                if (!string.IsNullOrWhiteSpace(name))
                {
                    user.DisplayName = name;
                }

                if (!string.IsNullOrWhiteSpace(email))
                {
                    user.Email = email;
                }

                user.LastSeenAt = now;
            }

            try
            {
                await db.SaveChangesAsync(cancellationToken);
                return UserResponse.From(user);
            }
            catch (DbUpdateException) when (attempt == 1)
            {
                foreach (var entry in db.ChangeTracker.Entries().ToList())
                {
                    entry.State = EntityState.Detached;
                }
            }
        }

        throw new InvalidOperationException("Could not save the signed-in user.");
    }
}
