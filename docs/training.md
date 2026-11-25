# Training: design record

Gym Bro adds training next to nutrition. This file holds the decisions, the rules and the data model. It is updated as each part is agreed or ships. The README describes behaviour once it ships, and DESIGN.md holds the UI rules.

Status: **phase 1, building**.

Shipped so far:
- The exercise library API: `GET /api/exercises` and `/api/exercises/{id}`, with 884 exercises (free-exercise-db plus our 8 stations), each with a `measure`. See *Exercise library* in the README.

Next: the photos, then the Train tab with the library, then the how-to sheet and the muscle map.

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

  v1 logs straight sets and supersets.
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
