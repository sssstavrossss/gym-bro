// S8 Part A acceptance checks for the trend maths. Usage: node scripts/unit-trend.mjs
import { build } from "esbuild";
const out = await build({ entryPoints: [new URL("../src/lib/trend.ts", import.meta.url).pathname], bundle: true, format: "esm", write: false, platform: "node" });
const m = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const sd = await build({ entryPoints: [new URL("../src/data/seed.ts", import.meta.url).pathname], bundle: true, format: "esm", write: false, platform: "node" });
const s = await import("data:text/javascript;base64," + Buffer.from(sd.outputFiles[0].text).toString("base64"));
let fail = 0; const ok = (c, msg) => { console.log(c ? "PASS" : "FAIL", msg); if (!c) fail++; };
const f2 = (n) => n.toFixed(2);
const W = s.seedWeights(), T = "2026-10-24";
ok(f2(m.trendAsOf(W, T)) === "83.60", "daily 36-day dataset → trend 83.60");
const two = { "2026-10-23": 80, "2026-10-24": 90 };
ok(f2(m.trendAsOf(two, T)) === "81.00" && m.trendStatus(two, T).state === "normal", "80 then 90 consecutive → 81.00, no dot");
const one = { "2026-10-10": 80, "2026-10-24": 81 };
ok(m.trendStatus(one, T).state === "low_accuracy" && m.trendStatus(one, T).reasons.includes("few_weigh_ins"), "one weigh-in in the last 7 days → low accuracy");
ok(m.trendStatus({ [T]: 84 }, T).state === "low_accuracy" && m.trendAsOf({ [T]: 84 }, T) === 84, "setup weigh-in only → trend = that weight, low accuracy");
const g = { "2026-10-01": 80, "2026-10-04": 83 }, gs = m.trendSeries(g, "2026-10-04").series;
ok([gs["2026-10-02"], gs["2026-10-03"], gs["2026-10-04"]].map(f2).join(" ") === "80.10 80.29 80.56", "3-day gap → 80.10, 80.29, 80.56");
const g28 = { "2026-09-26": 80, "2026-10-24": 84 }, g29 = { "2026-09-25": 80, "2026-10-24": 84 };
ok(m.trendAsOf(g28, T) !== 84 && m.trendStatus(g28, T).state !== "fresh_start", "28-day gap interpolated (no reset)");
ok(m.trendAsOf(g29, T) === 84 && m.trendStatus(g29, T).state === "fresh_start" && m.trendStatus(g29, T).freshGapDays === 29, "29-day gap → fresh start, trend = new weigh-in");
ok(m.typoCheck(W, T, 38.6).ask && !m.typoCheck(W, T, 86.5).ask && m.typoCheck(W, T, 86.7).ask, "typo guard: 38.6 asks, 86.5 saves, 86.7 asks");
ok(!m.typoCheck({}, T, 38.6).ask, "typo guard not applied to the first weigh-in");
const del = { ...W }; delete del["2026-10-15"]; const never = Object.fromEntries(Object.entries(W).filter(([d]) => d !== "2026-10-15"));
ok(m.trendAsOf(del, T) === m.trendAsOf(never, T), "deleting a weigh-in = never entered");
const back = { "2026-10-01": 80, "2026-10-10": 82 }, back2 = { ...back, "2026-10-05": 79 };
ok(m.trendAsOf(back, T) !== m.trendAsOf(back2, T), "a back-dated weigh-in inside a gap changes today's trend");
// ---- decision 35 ----
const at = (n) => { const d = new Date(2026, 9, 24 + n, 12); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const g15 = { [at(-15)]: 83.6 }, g70 = { [at(-70)]: 83.6 };
ok(m.typoLimit(g15, T) === 5 && !m.typoCheck(g15, T, 88.5).ask && m.typoCheck(g15, T, 88.7).ask, "35.1a 15-day gap: limit 5 kg, 88.5 saves, 88.7 asks");
ok(m.typoLimit(g70, T) === 10 && !m.typoCheck(g70, T, 93.5).ask && m.typoCheck(g70, T, 93.7).ask, "35.1b 70-day gap: capped at 10 kg, 93.5 saves, 93.7 asks");
ok(m.typoLimit(W, T) === 3 && !m.typoCheck(W, T, 86.5).ask && m.typoCheck(W, T, 86.7).ask, "35.1c no gap: 3 kg (86.5 saves, 86.7 asks)");
{ const b = { [at(-2)]: 83.6, [T]: 90 }; const c = m.typoCheck(b, at(-1), 87);
  ok(c.ask && c.ref.toFixed(2) === "83.60" && c.limit === 3, "35.6a back-dated entry judged against the day before its date (83.60), not today's trend"); }
{ const e = {}; for (let i = 0; i <= 20; i++) e[at(-34 + i)] = 70; e[at(-14)] = 74; e[at(0)] = 70; delete e[at(-15)]; for (let i = -28; i < -14; i++) delete e[at(i)];
  const c = m.typoCheck(e, at(-14), 75.1); ok(c.limit === 5 && c.ask && !m.typoCheck(e, at(-14), 74.9).ask, "35.6b editing an older entry uses the gap before its date (14 days → 5 kg)"); }
ok(m.entryDates(T).length === 8 && m.entryDates(T).at(-1) === "2026-10-17" && m.inEntryWindow(T, "2026-10-17") && !m.inEntryWindow(T, "2026-10-16") && !m.inEntryWindow(T, "2026-10-25"), "35.11 day list today … today − 7 (8 days); today − 8 and tomorrow outside");
ok(m.weighInsIn7({ [at(-6)]: 80, [T]: 80 }, T) === 2 && m.weighInsIn7({ [at(-7)]: 80, [T]: 80 }, T) === 1, "low accuracy counts today − 6 … today (same as the server's WindowDays = 7)");
{ const z = { [at(-9)]: 82 }; const st = m.trendStatus(z, T); ok(st.n7 === 0 && st.reasons.includes("few_weigh_ins") && m.trendAsOf(z, T) === 82, "35.3 last weigh-in 9 days ago: 0 in 7 days, trend held where it was then"); }
const f = await build({ entryPoints: [new URL("../src/lib/format.ts", import.meta.url).pathname], bundle: true, format: "esm", write: false, platform: "node" });
const fm = await import("data:text/javascript;base64," + Buffer.from(f.outputFiles[0].text).toString("base64"));
ok(fm.kg(83.25) === "83.3" && fm.kg(83.15) === "83.2" && fm.kg(83.6) === "83.6" && fm.kg(83.45) === "83.5", "kg rounds half away from zero (83.25 → 83.3, 83.15 → 83.2)");
process.exitCode = fail ? 1 : 0;
