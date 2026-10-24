import { expect, test } from "@playwright/test";

const widths = [
  { width: 390, height: 844, nav: "tabs" },
  { width: 820, height: 900, nav: "tabs" },
  { width: 1440, height: 900, nav: "sidebar" },
] as const;

for (const layout of widths) {
  test(`first run and profile at ${layout.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    const oid = `e2e-${layout.width}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await page.addInitScript((id) => {
      sessionStorage.setItem("gymbro-e2e", "1");
      sessionStorage.setItem("gymbro-e2e-oid", id);
    }, oid);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Set up" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your targets" })).toHaveCount(0);

    const birthYear = String(new Date().getFullYear() - 36);
    await page.getByRole("tab", { name: "Male", exact: true }).click();
    await page.getByRole("textbox", { name: "Birth year" }).fill(birthYear);
    await page.getByRole("textbox", { name: "Height in centimetres" }).fill("180");
    await page.getByRole("button", { name: "Activity" }).click();
    await page.getByRole("button", { name: "Moderate" }).click();
    await page.getByRole("tab", { name: "Lose" }).click();
    await page.getByRole("button", { name: "0.5" }).click();
    await page.getByRole("textbox", { name: "Goal weight in kilograms" }).fill("80");
    await page.getByRole("textbox", { name: "First weigh-in in kilograms" }).fill("83,6");
    await page.getByRole("button", { name: "Save and see targets" }).click();

    await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();
    await expect(page.locator("[data-field=bmr]")).toHaveText("1786");
    await expect(page.locator("[data-field=tdee]")).toHaveText("2768");
    await expect(page.locator("[data-field=kcal]")).toHaveText("2218");
    await expect(page.locator("[data-field=protein]")).toHaveText("167");
    await expect(page.locator("[data-field=fat]")).toHaveText("62");
    await expect(page.locator("[data-field=carbs]")).toHaveText("249");
    const weightButton = page.getByRole("button", { name: /Trend not ready/ });
    await expect(weightButton).toBeVisible();
    await expect(weightButton).not.toContainText("83.6");
    const health = await page.request.get("http://127.0.0.1:8100/api/health");
    expect(health.ok()).toBeTruthy();
    const headers = health.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    const csp = headers["content-security-policy"] ?? "";
    expect(csp).toContain("frame-src 'self' https://*.ciamlogin.com");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("https://*.ciamlogin.com");
    expect(csp).not.toContain("unsafe-eval");
    await expect(page.getByText("Matvaretabellen 2026. Mattilsynet. www.matvaretabellen.no")).toBeVisible();
    await expect(page.getByText("More carbs means less protein or fat.")).toHaveCount(0);

    if (layout.nav === "tabs") {
      await expect(page.locator("nav.tabbar")).toBeVisible();
      await expect(page.locator("aside.side")).toHaveCount(0);
    } else {
      await expect(page.locator("aside.side")).toBeVisible();
      const box = await page.locator("aside.side").boundingBox();
      expect(box?.width).toBeCloseTo(240, 0);
      await expect(page.locator("nav.tabbar")).toHaveCount(0);
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    expect(overflow).toBe(true);

    if (layout.width !== 390) return;

    await page.getByRole("button", { name: "Customise" }).click();
    await expect(page.getByText("More carbs means less protein or fat.")).toBeVisible();
    await page.getByRole("group", { name: "Protein" }).getByRole("button", { name: "More" }).click();
    await expect(page.locator("[data-field=protein]")).toHaveText("201");
    await page.getByRole("button", { name: "1.0" }).click();
    await expect(page.locator("[data-field=kcal]")).toHaveText("1786");
    await expect(page.locator("[data-floor=true]")).toBeVisible();

    await page.route("**/api/profile", (route) => {
      if (route.request().method() === "PUT") return route.abort();
      return route.continue();
    });
    const height = page.getByRole("textbox", { name: "Height in centimetres" });
    await height.fill("181,5");
    await height.blur();
    await expect(page.getByText("Server unreachable, try again.")).toBeVisible();
    await expect(height).toHaveValue("181,5");
    await page.getByRole("tab", { name: "Gain", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Gain", exact: true })).toHaveAttribute("aria-selected", "true");
  });
}
