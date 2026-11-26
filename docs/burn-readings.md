# Burn readings

The next way Recalculate measures the burn. It's built and tested here but not used yet: PR 2 switches Recalculate over, PR 3 shows each weigh-in's reading in Log weight, and PR 4 adds the rare-weigher nudge. The code is `backend/GymBro.Api/Nutrition/BurnReadings.cs`.

## Why

Today Recalculate fits a straight line through the weigh-ins since the last update and compares it with the average intake (`AdaptiveTarget`, `BurnEstimate`). That has three problems:

- **It ignores when food was eaten.** A big Sunday right before a Monday weigh-in counts the same as a big Tuesday, so a bloated Monday can pull the burn down by hundreds of kcal.
- **It needs 3 weigh-ins over 6 days since the last update.** Someone who weighs in only on Mondays is blocked every other week.
- **Big swings.** One measured update moved a real burn by 378 kcal (+15.6%) in one go.

## How it works

**A rolling window.** Every Recalculate reads the last 28 days of weigh-ins and food, not only the days since the last update. With fewer than 4 weigh-ins in 28 days it reads 56 days (sparse). With fewer than 2 in 56 days the burn isn't measured (rare). The window never reaches back before the settling week after setup or a fresh start.

**Weight minus food.** Each weigh-in becomes "weight minus everything eaten since the window's first weigh-in, in kg (7,700 kcal a kg)". With a steady burn those points fall on a straight line whose slope is minus the burn. That's a least-squares fit like today's, except the food is in it, so a big day is counted as food, not mistaken for a slower burn.

**How much each weigh-in counts.**
- Each weigh-in is assumed to be within ±0.5 kg of the body's real weight.
- A weigh-in the morning after a big day (over 130% of target) gets an extra ±0.8 kg. If most weigh-ins follow a big day, that's a habit (a weekly feast, then the weekly weigh-in): the bloat is about the same each time and cancels, so none of them is marked down.
- Unlogged days are filled with the window's average logged day, and each one adds ±600 kcal of doubt to the next weigh-in.
- Recent weigh-ins count more: weight halves every 14 days of age.
- With under half the window's days logged, the burn isn't measured.

**Readings.** Between each pair of weigh-ins a reading says what the current burn predicted (expected weight), what the scale said, the burn the change implies, the share of days logged, and whether it's sure (at least 70% of its days logged, and no odd big day before it).

**The step.**
- The burn moves toward the window's result by how sure each is (a Kalman step). The current burn's spread grows 60 kcal a week while it goes unmeasured.
- The window overlaps the last one, so its spread is widened by how few of its days are new: with weekly updates of a 28-day window, by 28/7. Re-reading the same weeks doesn't make the burn surer each time.
- The step is capped at 5% of the current burn (3% when sparse). A capped step stays unsure by at least half of what it left over, so the next step can keep going. The next update reads most of the same days again, so nothing is lost.

## Simulation

`backend/GymBro.Api.Tests/BurnSimulation.cs` runs synthetic people whose real burn is known, recalculating every Monday for 12 weeks, 200 times per scenario, through today's maths and through the readings.

- **Body model:** food beyond the burn becomes tissue at 7,700 kcal a kg, and the burn falls 22 kcal a day per kg lost. A big day leaves water and food on the scale (0.6 kg per 1,000 kcal over target, halving each day). The scale wobbles ±0.25 kg.
- **Eating:** people eat to their target, which follows the burn.
- **Under-loggers:** the burn worth learning is the one in logged calories, which is lower.

kcal off from the real burn (mean), now → new:

| Scenario | Off by, week 4 (now → new) | Week 8 | Week 12 | Average move a Monday | Biggest move | Mondays measured |
|---|---|---|---|---|---|---|
| Daily, steady, burn +12% | 82 → 94 | 50 → 23 | 44 → 24 | 75 → 36 | 658 → 146 | 100 % → 98 % |
| 3 a week, steady, burn +12% | 111 → 111 | 62 → 24 | 49 → 25 | 72 → 36 | 511 → 149 | 100 % → 100 % |
| Weekly, steady, burn +12% | 190 → 158 | 59 → 35 | 31 → 26 | 34 → 33 | 395 → 147 | 45 % → 100 % |
| Weekly, Sunday feast, burn +12% | 177 → 152 | 59 → 35 | 33 → 29 | 33 → 31 | 375 → 146 | 45 % → 100 % |
| Weekly, Sunday feast, burn −10% | 168 → 148 | 112 → 77 | 96 → 65 | 36 → 34 | 421 → 137 | 45 % → 100 % |
| Daily, Sunday feast, burn as formula | 84 → 71 | 104 → 42 | 106 → 46 | 64 → 28 | 701 → 142 | 100 % → 98 % |
| Every 2 weeks, steady, burn +12% | 299 → 236 | 74 → 69 | 44 → 28 | 24 → 23 | 422 → 88 | 18 % → 82 % |
| Daily, logs 80%, misses 10% of days | 85 → 97 | 42 → 32 | 43 → 35 | 65 → 40 | 921 → 145 | 67 % → 98 % |
| Weekly, misses 25% of days | 187 → 159 | 61 → 36 | 37 → 26 | 33 → 32 | 434 → 147 | 45 % → 99 % |
| Daily, steady, burn as formula | 67 → 51 | 46 → 23 | 44 → 26 | 69 → 27 | 594 → 145 | 100 % → 98 % |

**Results:**
- By week 8 the readings are closer in almost every case, and by week 12 in all of them. The biggest single move drops from 400–900 kcal to about 145, and the average Monday move is smaller or the same.
- Weekly weighers get a measured burn every Monday instead of every other one.
- Early on (week 4) the 5% cap makes the new maths a little slower when the formula is far off. That's the price of never jumping.

The test `In_simulation_the_rolling_readings_move_less_and_are_as_close_or_closer_by_week_twelve` keeps it that way. Run it with `BURN_SIM_REPORT=<file>` to write this table.
