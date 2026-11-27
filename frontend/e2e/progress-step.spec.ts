import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

function shift(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function clock(page: Page) {
  return page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { zone, today };
  });
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("the progress card steps a range back and forth, and a new range starts at now", async ({ page }) => {
  const oid = `e2e-progress-step-${Date.now()}-${test.info().project.name}`;
  await page.goto("/");
  const when = await clock(page);
  // Weigh-ins 7 and 2 days ago: the week before this one holds the earliest, so ‹ stops after one step.
  // (Food can't be logged before setup and a new weigh-in goes back at most 7 days.)
  for (const [ago, kg] of [[7, 84.0], [2, 83.6]]) {
    const saved = await page.request.put(`/api/weigh-ins/${shift(when.today, -ago)}`, { headers: headers(oid), data: { kg, timeZone: when.zone } });
    expect(saved.ok(), await saved.text()).toBeTruthy();
  }
  const profile = await page.request.put("/api/profile", {
    headers: headers(oid),
    data: {
      sex: "male", birthYear: 1990, heightCm: 180, activity: "moderate", goal: "lose",
      rateKgPerWeek: 0.5, goalWeightKg: 80, proteinSetting: "normal", proteinGramsPerKg: 2,
      fatSetting: "normal", fatPercent: 25, timeZone: when.zone,
    },
  });
  expect(profile.ok(), await profile.text()).toBeTruthy();
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
    localStorage.setItem("gymbro-home-range", "7d");
  }, oid);

  await page.goto("/today");
  const progress = page.getByRole("region", { name: "Progress", exact: true });
  const earlier = progress.getByRole("button", { name: "Earlier 7 days" });
  const later = progress.getByRole("button", { name: "Later 7 days" });
  const period = progress.locator("[data-range-period]");
  await expect(earlier).toBeEnabled();
  await expect(later).toBeDisabled();
  await expect(period).toBeDisabled();
  const now = await period.innerText();

  // 44px hits around 16px icons, inside the card head.
  for (const arrow of [earlier, later]) {
    const box = (await arrow.boundingBox())!;
    expect(Math.round(box.width)).toBe(44);
    expect(Math.round(box.height)).toBe(44);
  }

  await earlier.click();
  await expect(period).not.toHaveText(now);
  await expect(period).toHaveClass(/moved/);
  await expect(period).toHaveAttribute("aria-label", /Back to now/);
  await expect(later).toBeEnabled();
  // This week holds the first weigh-in, so there is nothing earlier.
  await expect(earlier).toBeDisabled();

  await later.click();
  await expect(period).toHaveText(now);
  await expect(later).toBeDisabled();
  // The dates bring it back to now too.
  await earlier.click();
  await expect(period).toHaveClass(/moved/);
  await period.click();
  await expect(period).toHaveText(now);
  await expect(later).toBeDisabled();

  // A new range starts at now and isn't stepped.
  await earlier.click();
  await expect(later).toBeEnabled();
  await progress.getByRole("radio", { name: "30d", exact: true }).click();
  await expect(progress.getByRole("button", { name: "Later 30 days" })).toBeDisabled();
  await expect(progress.locator("[data-range-period]")).not.toHaveClass(/moved/);
  // And All has no arrows: it already scrolls.
  await progress.getByRole("radio", { name: "All", exact: true }).click();
  await expect(progress.locator("[data-range-step]")).toHaveCount(0);

  // Stepping isn't kept across a reload; the range is.
  await progress.getByRole("radio", { name: "7d", exact: true }).click();
  await earlier.click();
  await expect(later).toBeEnabled();
  await page.reload();
  await expect(progress.getByRole("radio", { name: "7d", exact: true })).toBeChecked();
  await expect(later).toBeDisabled();
  await expect(period).toHaveText(now);
});
