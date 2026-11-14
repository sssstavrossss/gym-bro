import { inflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
}

function decodePng(buf: Buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const parts: Buffer[] = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    offset += 4;
    const type = buf.toString("ascii", offset, offset + 4);
    offset += 4;
    const data = buf.subarray(offset, offset + length);
    offset += length + 4;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") parts.push(data);
    else if (type === "IEND") break;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const rows: Buffer[] = [];
  let cursor = 0;
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x];
      const upLeft = x >= channels ? prev[x - channels] : 0;
      const value = raw[cursor + x];
      if (filter === 1) row[x] = (value + left) & 255;
      else if (filter === 2) row[x] = (value + up) & 255;
      else if (filter === 3) row[x] = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const pa = Math.abs(estimate - left);
        const pb = Math.abs(estimate - up);
        const pc = Math.abs(estimate - upLeft);
        const nearest = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        row[x] = (value + nearest) & 255;
      } else row[x] = value;
    }
    cursor += stride;
    rows.push(Buffer.from(row));
    row.copy(prev);
  }
  return { width, height, channels, rows };
}

/** Lowest painted chevron pixel to the macro card, versus the gap under that card. */
async function paintedGap(page: Page) {
  const box = await page.evaluate(() => {
    const svg = document.querySelector(".chev")!.getBoundingClientRect();
    const stage = document.querySelector(".homeweek .stage")!.getBoundingClientRect();
    const grip = document.querySelector(".grip")!.getBoundingClientRect();
    const grab = document.querySelector(".grab")!.getBoundingClientRect();
    const macros = document.querySelector("main.today .macros")!.getBoundingClientRect();
    const prompt = document.querySelector("main.today .prompt")!.getBoundingClientRect();
    const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number);
    return {
      x: svg.left - 4,
      y: svg.top,
      w: svg.width + 8,
      h: macros.top - svg.top,
      macrosTop: macros.top,
      svgTop: svg.top,
      block: prompt.top - macros.bottom,
      gripBelow: grip.top - stage.bottom,
      grabH: grab.height,
      dpr: window.devicePixelRatio,
      bg,
    };
  });
  const png = await page.screenshot({
    clip: { x: Math.max(0, box.x), y: box.y, width: box.w, height: Math.max(1, box.h) },
  });
  const image = decodePng(png);
  const [br, bg, bb] = box.bg;
  let last = -1;
  for (let y = 0; y < image.height; y += 1) {
    const row = image.rows[y];
    for (let x = 0; x < image.width; x += 1) {
      const i = x * image.channels;
      if (Math.max(Math.abs(row[i] - br), Math.abs(row[i + 1] - bg), Math.abs(row[i + 2] - bb)) > 28) {
        last = y;
        break;
      }
    }
  }
  const inkBottom = box.svgTop + (last + 1) / box.dpr;
  return { painted: box.macrosTop - inkBottom, block: box.block, gripBelow: box.gripBelow, grabH: box.grabH };
}

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

test("the painted chevron sits one block gap above the macro card", async ({ page }) => {
  const oid = `e2e-gap-${Date.now()}-${test.info().project.name}`;
  const when = await clock(page);
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
  expect((await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  })).ok()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    localStorage.removeItem("gymbro-home-week-open");
    document.documentElement.classList.add("demo-statusbar");
  }, oid);
  await page.goto("/today");
  await page.evaluate(() => document.documentElement.classList.add("demo-statusbar"));
  await expect(page.locator("main.today .prompt")).toBeVisible();

  const closed = await paintedGap(page);
  expect(closed.grabH).toBeGreaterThanOrEqual(44);
  expect(closed.gripBelow).toBeGreaterThanOrEqual(10.5);
  expect(closed.gripBelow).toBeLessThanOrEqual(11.5);
  expect(Math.abs(closed.painted - closed.block)).toBeLessThanOrEqual(0.5);

  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/tmp/gap-after-collapsed.png" });
  }

  await page.getByRole("button", { name: "Show the last 4 weeks" }).click();
  await expect.poll(async () => page.locator(".homeweek .stage").evaluate((node) => (node as HTMLElement).style.height)).toBe("auto");
  const open = await paintedGap(page);
  expect(open.grabH).toBeGreaterThanOrEqual(44);
  expect(open.gripBelow).toBeGreaterThanOrEqual(10.5);
  expect(Math.abs(open.painted - open.block)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(open.painted - closed.painted)).toBeLessThanOrEqual(0.5);

  if (test.info().project.name === "chromium") {
    await page.screenshot({ path: "/tmp/gap-after-expanded.png" });
  }
});
