# Training: design record

Gym Bro adds training next to nutrition. This file holds the decisions, the rules and the data model. It is updated as each part is agreed or ships. The README describes behaviour once it ships, and DESIGN.md holds the UI rules.

Status: **phase 6, building**.

Shipped so far:
- The exercise library API: `GET /api/exercises` and `/api/exercises/{id}`, with 884 exercises (free-exercise-db plus our 8 stations), each with a `measure`. See *Exercise library* in the README.
- Exercise photos: made in the Docker build from the pinned commit, served from `/exercise-photos/f00c92c/<id>/<n>.webp`. The API names the folder, which is where a native app would point at its own copies.

- The Train tab in Log's place, with the exercise library (search, area chips) and the how-to sheet (photos, muscles, steps, Watch a demo). See *Screens* in the README.
- The muscle map: our own front and back SVG (`lib/muscleMap.ts`, `MuscleMap.vue`), in the how-to sheet beside Main and Helping. This week and Progress reuse it later.

Phase 1 is done. Phase 2 (log a free workout), shipped so far:
- The workouts API: `PUT/GET/DELETE /api/workouts/{id}`, `GET /api/workouts?from=&to=` and `GET /api/workouts/previous`, with the session and set tables below. The app makes each workout's id, so an offline workout sends safely later. See *Workouts* in the README.

- Logging a workout in the app: Start or Resume on Train, the workout sheet with add exercise, the set table with last time and hints, the app keypad, the rest timer, Finish and the summary. A workout in progress and finished ones waiting to send live on the phone. See *Logging a workout* in the README.

- History on Train, editing and deleting past workouts (with Undo), logging a workout afterwards, and Start workout / Log workout as extra + fan buttons (off the fan until added). See *Logging a workout* in the README.

Phase 2 is done. Phase 3 (plan generator, sequence and calendar, Home card), shipped so far:
- The plans API and the generator: `GET/PUT/DELETE /api/plan` and `POST /api/plan/preview`, the core exercise table (`Training/CoreExercises.cs`: about 70 well-known lifts, each with the kit it needs and the areas it loads hardest), and workouts that carry their plan workout and place in the sequence. See *Training plans* in the README.
- The New plan / Edit plan sheet (questions, Before you start, a live preview, Change split, End plan) and the Plan card on Train. See *The plan on Train* in the README.
- Up next on the Plan card: Start (the workout prefilled with this week's sets, targets and rest), Skip with Undo, the block's week and reps in reserve. See *Where the plan is* in the README.
- The calendar: Up next's day and the rest of the week's plan workouts on your training days, projected from today. See *The calendar* in the README.
- The training card on Today: Start today's plan workout, done or skipped with what's next, a rest day with Train anyway, or Resume while one runs; a Training switch in Home sections. See *Today's training card* in the README.

Phase 3 is done. Phase 4 (suggestions and PRs; Progress rebuilt), shipped so far:
- Load suggestions in the workout sheet: up a step, hold, or ease off about 10% after two misses, from the last two workouts; half steps on a bar or stack when easing in or when a step is over 10%; "pick a weight that leaves about 3 reps" the first time. See *Load suggestions* in the README.

- New bests: estimated max (Epley with RIR) per exercise, the best so far from the API, "New best" on the card once a ticked set beats it, and in the summary. See *New bests* in the README.

- Strength on Progress: a Body / Strength switch; workouts, sets and lifts up in the range, and each lift's estimated max with its change and a small line. See *Strength on Progress* in the README.
- Sets per muscle this week on Progress → Strength: the body map by target, each muscle's sets (main in full, helping as half) against the plan's weekly volume, and the big muscles not worked yet. See *This week* in the README.

Phase 4 is done. Phase 5 (swaps, warm-ups, plate maths, build or edit your own plan), shipped:
- Swap an exercise in a workout: the same movement first (the generator's alternatives), then the same main muscle, then the library; within the plan's equipment and go-easy areas. Unticked sets move, ticked ones stay. See *Swap* in the README.
- Warm-ups: + Warm-up on a weight exercise adds a ramp filled in towards the working weight (40/60/80% for a compound, the empty bar first on a barbell; 50% for isolation). See *Warm-ups* in the README.
- Plate maths: a barbell lift shows the plates a side for the set you're on (25 to 1.25 kg on a 20 kg bar). See *Plates* in the README.

- Edit a plan workout by hand: swap for good, add, remove and reorder exercises, and change sets, reps or hold, and rest. Saving keeps the workout's place; remaking the plan from its answers drops the edits, and Edit plan says so. Stored in the plan's workouts JSON with `edited`, no migration. See *Edit a plan workout* in the README.

- Build your own plan: a Your own split with one empty workout a day, filled and renamed in the plan workout editor; Add exercises instead of Start while one is empty; changing days keeps what you built and says what it drops. See *Build your own* in the README.

Phase 5 is done. Next: phase 6, other kinds of training.

Phase 6 (circuits, EMOM, AMRAP, for time, Hyrox and kettlebell plans, cardio, "describe a workout"), shipped so far:
- Supersets and circuits in a workout: join an exercise to the one before; they open together and rest comes after each round. Saved as a shared `block`, no migration. See *Supersets and circuits* in the README.
- EMOM, AMRAP and for time: a superset or circuit can be done on the clock, with Start, Round done and Stop, and keeps its score (AMRAP rounds + reps, EMOM rounds of the planned, for time the time). Saved as `workout_sessions.blocks` (migration `20261205090000_AddTimedBlocks`). See *EMOM, AMRAP and for time* in the README.
- Cardio: runs, walks, rides, rows and swims log distance and time with a pace in each sport's unit, start with one set, and add up to a distance in the summary and history. A workout's kind comes from its exercises (cardio, hybrid, mobility, strength). Swim and Walk joined the library. No migration. See *Cardio* in the README.
- Hyrox plans: a `hyrox` goal and split. Strength days come between station circuits done for time (Stations A and B, a 1 km run and four stations at shorter distances) and run intervals (1 km or 500 m repeats). Stand-ins cover missing kit and areas to go easy on, and rounds fit the minutes and experience. Plan exercises gained `metres`, `superset` and `format`, and the plan editor keeps them. No migration. See *Hyrox* in the README.

## Decisions (agreed 2026-11-25)

1. **Tabs.** Today · **Train** · + · **Progress** · Profile. Train replaces Log: it holds the sequence, the calendar, the plan, the exercise library and history. Progress gets rebuilt around strength and body, and keeps nutrition's charts as pages. Home gains a training card, and more training data where it helps.
2. **Schedule is a pure sequence.** A plan is an order of workouts (A → B → C → D → A…). Next is always the first one not done or skipped. Training on any day takes it. A missed day changes nothing. Skip marks a session skipped and moves on.
   - The weekdays you pick only **project** dates, for the calendar and later for reminders. They never lock a session to a day, and the projection moves when you train off-pattern.
3. **Plan setup asks for:**
   - goal: muscle, strength, general fitness, and later hybrid or Hyrox;
   - weekdays: the count is days per week;
   - minutes per workout: 10–120, in steps of 5;
   - experience: new, some, or experienced;
   - equipment.

   The split follows from the days and can be changed. Muscle priorities come later. Equipment presets can be combined (e.g. Dumbbells + Kettlebells). Hybrid/Hyrox isn't offered until phase 6 (not shown greyed out either). There are no starting-strength questions; the first session of an exercise asks for a weight that leaves about 3 reps, and the app learns from there.
4. **RIR** (reps in reserve) is logged per set. It's pre-filled with the target and can be switched off, but is never required.
5. **Exercise library.** All of free-exercise-db (public domain, 876 exercises, with photos), plus our own Hyrox and conditioning stations.
   - A `core` flag marks the well-known lifts. The generator picks from those, and they get our own short cues (Set up / Do / Avoid).
   - Other exercises keep their original text until their cues are written.
   - "Watch a demo" opens a YouTube search; no video is hosted.
   - Before going public, check where free-exercise-db's photos came from.
6. **Nutrition is unchanged.** Workouts don't change the calorie target. The weekly recalculation already learns real burn from intake and weight change.
7. **The + fan** gains "Start workout" and "Log a workout". New actions start in "Not in the fan".
8. **Health and easing in.** Plan setup has a short "Before you start" section in our own words (not PAR-Q+ text):
   - A heart question ("has a doctor told you about a heart condition, or do you get chest pain, faintness or dizziness when active?"). A yes shows a calm note to check with a doctor before starting. The answer is **not stored**.
   - "Go easy on": shoulders, elbows, wrists, lower back, hips, knees, ankles. This is stored, because the generator uses it. It avoids or limits the exercises that load those areas hardest, using a joint-stress tag on core exercises, and turns on Ease in.
   - **Ease in**: the first 2 weeks start further from failure (RIR 4, then 3) with half-size load steps. It's on by default for New and for anyone who picks a go-easy area, and can be turned on by anyone.
   - One line: "Training suggestions, not medical advice."
9. **Small PRs.** Each step ships on its own, with a merge and deploy in between.
10. **Muscle map.** Our own front/back SVG, reused in the how-to sheet, This week and Progress.
11. **Docs.** This file is the record. The README covers behaviour as it ships, and CODEMAP is updated as we go.

## Rules (proposed)

- **Suggestions are fixed rules, not AI.** Claude may later parse "describe a workout" and explain a suggestion. It never sets loads.
- **Double progression with RIR.** Each exercise has a rep range (compounds about 6–10, isolation about 10–15) and an RIR target.
  - When every working set reaches the top of the range at or under the target effort, the next session adds the smallest load step.
  - Missing the bottom of the range holds the load, or eases it after a second miss.
  - Steps are capped, so a jump is never more than one plate step, or about 5–10%.
- **First time on an exercise:** "pick a weight that leaves about 3 reps". The logged set becomes the baseline.
- **Ease in** (when on): weeks 1–2 use RIR 4 then 3, and half load steps.
- **Block:** about 5 weeks with RIR stepping from 3 to 1, then a lighter week (half the sets, RIR 4). Then it repeats, optionally rotating some exercises.
- **Volume:** working sets per muscle per week, about 8–10 for new, 10–14 for some experience, and 14–18 for experienced, spread over at least 2 days a week where the split allows.
- **Session time:** sets × (work + rest) + changeovers.
  - Under about 20 minutes, the generator uses supersets or a circuit of 2–3 exercises.
  - Over about 90 minutes, it adds exercises rather than sets.
- **Sequence and weeks.** The next workout is the one after the latest done or skipped plan workout (by `sequencePosition`). A block's week counts passes through the sequence, not calendar weeks: one week is as many plan workouts as days a week, so a missed day doesn't move the block on.
- **Short sessions** take fewer exercises and at most 2 sets each for now. Supersets and circuits come with phase 6.
- **Estimated max:** Epley with RIR, kg × (1 + (reps + RIR) / 30).

## Data model (proposed)

Designed so other kinds of training need no migration later.

- **Exercise:**
  - id, name, aliases, muscles (primary, secondary), equipment, level, mechanic and force, `core`, photos, cues, source and licence;
  - `measure`: weight × reps, reps, time, distance + time, weight × distance (carries, sleds) or calories (ergs);
  - optional per-user custom exercises.
- **Plan:** goal, weekdays, minutes, experience, equipment, split, block length, start date. It holds **plan workouts** (A, B, …) in sequence order. Each one has **blocks** of exercises with sets, rep range, RIR target and rest.
- **Block format:**
  - straight sets;
  - superset or circuit (rounds);
  - EMOM (minutes);
  - AMRAP (time cap; score is rounds + reps);
  - for time (score is time).

  v1 logs straight sets and supersets. A session keeps its timed blocks' format and score (`blocks`), by block number.
- **Session** (a workout done, or one being done):
  - `kind` (strength, cardio, hybrid, mobility, sport);
  - date, start, end;
  - the plan workout it came from, if any;
  - its sequence position;
  - status (done, skipped);
  - notes.
- **Set:** session, exercise, block, order, type (warm-up, working, drop). The measured fields are nullable: reps, kg, RIR, seconds, metres, calories. Plus done-at.
- Everything is scoped by the caller's `oid`. Sessions are logged offline-first and synced like the rest of the app.

## Phases

1. Tabs, data model, exercise library (browse, search, how-to).
2. Log a free workout: rest timer, summary, history, edit past.
3. Plan generator, sequence and calendar, Home card.
4. Suggestions and PRs; Progress rebuilt with estimated max per lift and sets per muscle.
5. Swaps, warm-ups, plate maths, build or edit your own plan.
6. Other kinds of training: circuits, EMOM, AMRAP, for time, Hyrox and kettlebell plans, cardio; "describe a workout".

## Research notes

- **MacroFactor Workouts.**
  - Rule-based progression from rep range, RIR target and results, with no generative AI.
  - Days are an ordered sequence; rest days are days with no exercises.
  - Rest defaults: 3:00 for lower-body compounds, 1:30 for upper-body isolation.
  - Logging is a set table with previous, kg, reps and ✓; RIR runs 0–6+, optional but encouraged.
  - Swaps, warm-ups and notes sit behind one action bar.
  - About 600 demo videos.
  - Cardio arrived later as running, cycling, swimming and air bike entries.
  - A reviewer found some week-2 load jumps of about 20% too large, which is why steps are capped here.
- **Peers.** Strong records only. Hevy logs and adds a social layer. Fitbod generates every session from recovery: the most automated, and the least predictable.
- **Libraries.**
  - free-exercise-db: Unlicense.
  - wger: data is CC-BY-SA, with attribution per entry, and share-alike.
  - ExerciseDB: AGPL code, and no licence stated for its data or media.
