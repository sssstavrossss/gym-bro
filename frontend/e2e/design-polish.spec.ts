import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const widths = [390, 820, 1440] as const;

function headers(oid: string): Record<string, string> {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    const day = (offset: number) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      return format.format(date);
    };
    return { zone, today: day(0), yesterday: day(-1), ago: day(-29), ago9: day(-9) };
  });
}

async function sign(page: Page, oid: string) {
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
}

async function putProfile(request: APIRequestContext, oid: string, zone: string) {
  const response = await request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male",
      birthYear: 1990,
      heightCm: 180,
      activity: "moderate",
      goal: "lose",
      rateKgPerWeek: 0.5,
      goalWeightKg: 70,
      proteinSetting: "normal",
      proteinGramsPerKg: 2,
      fatSetting: "normal",
      fatPercent: 25,
      timeZone: zone,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function putWeighIn(request: APIRequestContext, oid: string, date: string, kg: number, zone: string, confirm = false) {
  const response = await request.put(`/api/weigh-ins/${date}`, {
    headers: headers(oid),
    data: { kg, timeZone: zone, confirm },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function seedPastWeighIn(request: APIRequestContext, oid: string, date: string, kg: number) {
  const created = await request.get("/api/me", { headers: headers(oid) });
  expect(created.ok(), await created.text()).toBeTruthy();
  execFileSync("psql", [
    "-h", "127.0.0.1",
    "-U", "gymbro",
    "-d", "gymbro",
    "-v", "ON_ERROR_STOP=1",
    "-c",
    `insert into weigh_ins (id, user_id, local_date, kg, updated_at) values (gen_random_uuid(), '${oid}', '${date}', ${kg.toFixed(1)}, now());`,
  ], { env: { ...process.env, PGPASSWORD: "gymbro" } });
}

async function openToday(page: Page, oid: string, width: number) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await sign(page, oid);
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
}

async function ax5(page: Page) {
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "53px";
    window.dispatchEvent(new Event("resize"));
  });
}

function intersects(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test("tokens, sex control, starting-weight hint, profile dot, and tab labels", async ({ page }) => {
  const oid = `e2e-polish-sex-${Date.now()}`;
  await sign(page, oid);
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/setup");
    await expect(page.getByRole("heading", { name: "Set up" })).toBeVisible();
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const sample = document.createElement("span");
      sample.className = "c2";
      document.body.append(sample);
      const secondary = getComputedStyle(sample).color;
      sample.className = "c3";
      const tertiary = getComputedStyle(sample).color;
      sample.remove();
      return {
        secondaryToken: style.getPropertyValue("--text-secondary").trim(),
        tertiaryToken: style.getPropertyValue("--text-tertiary").trim(),
        borderStrong: style.getPropertyValue("--color-border-strong").trim(),
        secondary,
        tertiary,
      };
    });
    expect(tokens.secondaryToken).toBe("#b3b3ba");
    expect(tokens.tertiaryToken).toBe("#9c9ca4");
    expect(tokens.borderStrong).toBe("#737379");
    expect(tokens.secondary).toBe("rgb(179, 179, 186)");
    expect(tokens.tertiary).toBe("rgb(156, 156, 164)");

    const sex = page.getByRole("radiogroup", { name: "Sex" });
    const male = sex.getByRole("radio", { name: "Male", exact: true });
    const female = sex.getByRole("radio", { name: "Female", exact: true });
    await male.scrollIntoViewIfNeeded();
    for (const option of [male, female]) {
      const box = await option.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await male.focus();
    await page.keyboard.press("ArrowRight");
    await expect(female).toBeFocused();
    await expect(female).toHaveAttribute("aria-checked", "true");
    await expect(male).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press(" ");
    await expect(female).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Until you have 2 weigh-ins within 7 days, the trend shows a small grey dot: it's less accurate. Weigh in 2+ times a week, ideally each morning.")).toBeVisible();
    const dot = page.locator(".hint .odot");
    await expect(dot).toBeVisible();
    await expect(dot).toHaveCSS("background-color", "rgb(179, 179, 186)");
  }

  const birthYear = String(new Date().getFullYear() - 36);
  await page.getByRole("radio", { name: "Male", exact: true }).click();
  await page.getByRole("textbox", { name: "Birth year" }).fill(birthYear);
  await page.getByRole("textbox", { name: "Height in centimetres" }).fill("180");
  await page.getByRole("button", { name: "Activity" }).click();
  await page.getByRole("button", { name: "Moderate" }).click();
  await page.getByRole("radio", { name: "Lose" }).click();
  await page.getByRole("button", { name: "0.5" }).click();
  await page.getByRole("textbox", { name: "Goal weight in kilograms" }).fill("80");
  await page.getByRole("textbox", { name: "Starting weight in kilograms" }).fill("83.6");
  await page.getByRole("button", { name: "Save and see targets" }).click();
  await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();

  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const row = page.getByRole("button", { name: /trend · low accuracy/i });
    await expect(row).toBeVisible();
    const marker = row.locator(".accdot.static .d");
    await expect(marker).toBeVisible();
    await expect(marker).toHaveCSS("background-color", "rgb(179, 179, 186)");
    await expect(row.locator("button")).toHaveCount(0);
    const profileSex = page.getByRole("radiogroup", { name: "Sex" });
    for (const name of ["Male", "Female"]) {
      const box = await profileSex.getByRole("radio", { name, exact: true }).boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    if (width >= 1024) {
      await expect(page.locator("nav.tabbar")).toHaveCount(0);
      continue;
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
      window.dispatchEvent(new Event("resize"));
    });
    const before = await page.locator("nav.tabbar .tab .t-capn").evaluateAll((nodes) => nodes.map((node) => ({
      font: getComputedStyle(node).fontSize,
      box: node.getBoundingClientRect().toJSON(),
    })));
    expect(before).toHaveLength(4);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "53px";
      window.dispatchEvent(new Event("resize"));
    });
    const after = await page.locator("nav.tabbar .tab .t-capn").evaluateAll((nodes) => nodes.map((node) => ({
      font: getComputedStyle(node).fontSize,
      box: node.getBoundingClientRect().toJSON(),
    })));
    expect(after.map((label) => label.font)).toEqual(before.map((label) => label.font));
    for (let index = 0; index < after.length; index += 1) {
      for (let other = index + 1; other < after.length; other += 1) {
        expect(intersects(after[index].box, after[other].box)).toBe(false);
      }
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
      window.dispatchEvent(new Event("resize"));
    });
  }
});

test("day kilograms, autosized input, 1 kg axis, and the typo confirmation", async ({ page }) => {
  const oid = `e2e-polish-sheet-${Date.now()}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.yesterday, 80, when.zone);
  await putWeighIn(page.request, oid, when.today, 84, when.zone, true);
  await putProfile(page.request, oid, when.zone);
  for (const width of widths) {
    await openToday(page, oid, width);
    await page.getByRole("button", { name: /Open weight|Log weight/ }).first().click();
    await expect(page.getByRole("heading", { name: "Log weight" })).toBeVisible();
    await page.getByRole("button", { name: "Weigh-in day" }).click();
    const labels = await page.getByRole("listbox", { name: "Weigh-in day" }).getByRole("option").allTextContents();
    expect(labels.some((label) => label.includes("80.0"))).toBe(true);
    expect(labels.some((label) => label.includes("84.0"))).toBe(true);
    await page.getByRole("button", { name: "Weigh-in day" }).click();
    const field = page.getByRole("textbox", { name: "Weight in kilograms" });
    const sized = await field.evaluate((input) => {
      const box = input.getBoundingClientRect();
      const label = input.closest("label")!.getBoundingClientRect();
      return { width: box.width, height: box.height, label: label.width };
    });
    expect(sized.height).toBeGreaterThanOrEqual(44);
    expect(sized.width).toBeLessThan(sized.label * 0.75);
    const sheet = page.getByRole("dialog", { name: "Log weight" });
    await expect(sheet.locator(".ymark").first()).toBeVisible();
    const marks = await sheet.locator(".ymark").evaluateAll((nodes) => nodes.map((node) => Number((node as HTMLElement).dataset.kg)));
    expect(marks.length).toBeGreaterThan(1);
    const sorted = [...marks].sort((a, b) => b - a);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index - 1] - sorted[index]).toBeCloseTo(1, 5);
    }
    if (width === 820) {
      const boxes = await sheet.locator(".ymark").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
      for (let index = 0; index < boxes.length; index += 1) {
        for (let other = index + 1; other < boxes.length; other += 1) {
          expect(intersects(boxes[index], boxes[other])).toBe(false);
        }
      }
    }
    await field.fill("38.6");
    await page.getByRole("button", { name: "Save weight" }).click();
    const guard = page.getByRole("alertdialog");
    await expect(guard.getByRole("button", { name: "Yes, save 38.6 kg", exact: true })).toBeVisible();
    await expect(guard).toHaveCSS("border-top-color", "rgb(115, 115, 121)");
    await page.getByRole("button", { name: "Fix it" }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
});

test("sparkline, trend explanation, and fresh-start borders", async ({ page }) => {
  const oid = `e2e-polish-fresh-${Date.now()}`;
  const when = await clock(page);
  await seedPastWeighIn(page.request, oid, when.ago, 80);
  await putProfile(page.request, oid, when.zone);
  await putWeighIn(page.request, oid, when.today, 90, when.zone, true);
  for (const width of widths) {
    await openToday(page, oid, width);
    const card = page.locator(".fs");
    await expect(card).toBeVisible();
    await expect(card).toHaveCSS("border-top-color", "rgb(115, 115, 121)");
    const info = page.getByRole("button", { name: "What is the trend?" });
    await expect(info).toBeVisible();
    const hit = await info.boundingBox();
    expect(hit?.width).toBeGreaterThanOrEqual(44);
    expect(hit?.height).toBeGreaterThanOrEqual(44);
    const note = page.getByRole("note");
    await expect(note).toBeHidden();
    await info.click();
    await expect(note).toBeVisible();
    await expect(note).toContainText("smooths out day-to-day swings");
    await expect(page.getByRole("dialog", { name: "Log weight" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(note).toBeHidden();
    if (width < 600) {
      const spark = page.locator(".wcard svg.spark");
      await expect(spark).toBeVisible();
      const box = await spark.boundingBox();
      expect(box?.width).toBeCloseTo(132, 0);
      expect(await spark.locator("circle").count()).toBeGreaterThan(0);
    } else {
      await expect(page.locator(".wbig .wchart")).toBeVisible();
    }
    await page.getByRole("button", { name: /Open weight|Log weight/ }).first().click();
    await expect(page.getByRole("heading", { name: "Log weight" })).toBeVisible();
    const fresh = page.locator(".fresh");
    await expect(fresh).toBeVisible();
    await expect(fresh).toHaveCSS("border-top-style", "dashed");
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
});

test("only weigh-in offers Edit, and one reading labels its own kilogram", async ({ page }) => {
  const oid = `e2e-polish-only-${Date.now()}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, 83.6, when.zone);
  await putProfile(page.request, oid, when.zone);
  for (const width of widths) {
    await openToday(page, oid, width);
    await page.getByRole("button", { name: /Open weight|Log weight/ }).first().click();
    const sheet = page.getByRole("dialog", { name: "Log weight" });
    await expect(sheet.getByText("Today's weigh-in is 83.6 kg · saving replaces it")).toBeVisible();
    const line = sheet.getByText("This is your only weigh-in, so it can't be deleted.");
    await expect(line).toBeVisible();
    const edit = sheet.getByRole("button", { name: "Edit your only weigh-in" });
    const editBox = await edit.boundingBox();
    expect(editBox?.width).toBeGreaterThanOrEqual(44);
    expect(editBox?.height).toBeGreaterThanOrEqual(44);
    const lineBox = await line.boundingBox();
    expect(lineBox?.height).toBeLessThan(44);
    await expect(sheet.locator(".ymark", { hasText: "83.6" })).toBeVisible();
    await edit.click();
    const field = sheet.getByRole("textbox", { name: "Weight in kilograms" });
    await expect(field).toBeFocused();
    const selectedAll = await field.evaluate((input: HTMLInputElement) => (
      input.value.length > 0 && input.selectionStart === 0 && input.selectionEnd === input.value.length
    ));
    expect(selectedAll).toBe(true);
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
});

test("closed weigh-in day shows the day, and kilograms only in the open list", async ({ page }) => {
  const oid = `e2e-polish-day-${Date.now()}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.yesterday, 80, when.zone);
  await putWeighIn(page.request, oid, when.today, 84, when.zone, true);
  await putProfile(page.request, oid, when.zone);
  for (const width of widths) {
    await openToday(page, oid, width);
    await page.getByRole("button", { name: /Open weight|Log weight/ }).first().click();
    const sheet = page.getByRole("dialog", { name: "Log weight" });
    const face = sheet.locator(".dayface");
    await expect(face).toHaveText(/^Today,/);
    expect(await face.innerText()).not.toMatch(/·|\d+\.\d/);
    const fit = await face.evaluate((node) => {
      const chevron = node.parentElement?.querySelector(".daychev");
      const gap = chevron instanceof HTMLElement
        ? chevron.offsetLeft - (node.offsetLeft + node.offsetWidth)
        : -1;
      return { scroll: node.scrollWidth, client: node.clientWidth, gap };
    });
    expect(fit.scroll).toBeLessThanOrEqual(fit.client + 1);
    expect(fit.gap).toBeGreaterThanOrEqual(2);
    await sheet.getByRole("button", { name: "Weigh-in day" }).click();
    const options = sheet.getByRole("listbox", { name: "Weigh-in day" }).getByRole("option");
    await expect(options).toHaveCount(8);
    const texts = await options.allTextContents();
    expect(texts.some((text) => text.includes("84.0"))).toBe(true);
    expect(texts.some((text) => text.includes("80.0"))).toBe(true);
    expect(texts.join("\n")).toContain("Yesterday");
    await page.keyboard.press("Escape");
    await expect(sheet.getByRole("heading", { name: "Log weight" })).toBeVisible();
    await expect(sheet.getByRole("listbox")).toHaveCount(0);
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
});

test("no weigh-ins in the last 7 days holds the trend where it was", async ({ page }) => {
  const oid = `e2e-polish-zero7-${Date.now()}`;
  const when = await clock(page);
  await seedPastWeighIn(page.request, oid, when.ago9, 83.6);
  await putProfile(page.request, oid, when.zone);
  for (const width of widths) {
    await openToday(page, oid, width);
    await page.getByRole("button", { name: /Low accuracy/ }).first().click();
    const sheet = page.getByRole("dialog", { name: "Trend accuracy" });
    await expect(sheet.getByText(
      "No weigh-ins in the last 7 days (last one 9 days ago), so the trend is held where it was then.",
    )).toBeVisible();
    await expect(sheet.getByText("Trend 83.6 kg")).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
});

test("profile values and sex labels stay whole at AX5", async ({ page }) => {
  const oid = `e2e-polish-ax5-profile-${Date.now()}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, 83.6, when.zone);
  await putProfile(page.request, oid, when.zone);
  await openToday(page, oid, 390);
  await page.getByRole("link", { name: "Profile" }).click();
  await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();
  await ax5(page);
  const female = page.getByRole("radio", { name: "Female", exact: true });
  await expect(female).toHaveText("Female");
  const femaleFit = await female.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
  expect(femaleFit.scroll).toBeLessThanOrEqual(femaleFit.client + 1);
  for (const name of ["Female", "Male"]) {
    const box = await page.getByRole("radio", { name, exact: true }).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  const clipped = await page.locator("main.screen").evaluate((root) => {
    const bad: string[] = [];
    for (const node of root.querySelectorAll("input, button, span, p, h1, h2, label")) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.closest(".sr-only") || node.classList.contains("sr-only")) continue;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (node.clientWidth < 2) continue;
      const overflow = node.scrollWidth > node.clientWidth + 1;
      const ellipsis = style.textOverflow === "ellipsis" && overflow;
      if (overflow || ellipsis) {
        const value = node instanceof HTMLInputElement ? node.value : node.innerText;
        bad.push(`${node.tagName} ${(value || node.getAttribute("aria-label") || "").replace(/\s+/g, " ").slice(0, 60)}`);
      }
    }
    return bad;
  });
  expect(clipped).toEqual([]);
});

test("closed day label stays visible at AX5, and the open list meets contrast", async ({ page }) => {
  const oid = `e2e-polish-ax5-day-${Date.now()}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.yesterday, 80, when.zone);
  await putWeighIn(page.request, oid, when.today, 84, when.zone, true);
  await putProfile(page.request, oid, when.zone);
  for (const width of widths) {
    await openToday(page, oid, width);
    await ax5(page);
    await page.getByRole("button", { name: /Open weight|Log weight/ }).first().click();
    const sheet = page.getByRole("dialog", { name: "Log weight" });
    const face = sheet.locator(".dayface");
    await expect.poll(async () => face.evaluate((node) => {
      const text = (node.textContent || "").trim();
      const box = node.getBoundingClientRect();
      return text.length > 0 && box.width > 12 && node.scrollWidth <= node.clientWidth + 1;
    })).toBe(true);
    await sheet.getByRole("button", { name: "Weigh-in day" }).click();
    const selected = sheet.locator(".dayopt[aria-selected='true']");
    await expect(selected.locator("svg")).toBeVisible();
    await expect(selected).not.toHaveCSS("background-color", "rgb(58, 58, 64)");
    const violations = await new AxeBuilder({ page })
      .include(".daymenu")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(violations.violations.filter((item) => item.id === "color-contrast")).toEqual([]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
});

test("trend info stays clear of the weight label at AX5", async ({ page }) => {
  const oid = `e2e-polish-ax5-today-${Date.now()}`;
  const when = await clock(page);
  await putWeighIn(page.request, oid, when.today, 83.6, when.zone);
  await putProfile(page.request, oid, when.zone);
  await openToday(page, oid, 390);
  await ax5(page);
  const label = page.locator(".wcard .trendline .t-cap");
  const info = page.getByRole("button", { name: "What is the trend?" });
  await expect(label).toBeVisible();
  await expect(info).toBeVisible();
  const labelBox = await label.boundingBox();
  const infoBox = await info.boundingBox();
  expect(labelBox && infoBox && intersects(labelBox, infoBox)).toBe(false);
  expect(infoBox?.width).toBeGreaterThanOrEqual(44);
  expect(infoBox?.height).toBeGreaterThanOrEqual(44);
});
