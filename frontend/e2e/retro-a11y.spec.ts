import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { appendFileSync } from "node:fs";

const reportPath = "/tmp/gymbro-axe.jsonl";

async function check(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  appendFileSync(reportPath, JSON.stringify({
    name,
    url: page.url(),
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => n.target),
    })),
  }) + "\n");
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

async function signInAs(page: Page, oid: string) {
  await page.addInitScript((id) => {
    sessionStorage.setItem("gymbro-e2e", "1");
    sessionStorage.setItem("gymbro-e2e-oid", id);
  }, oid);
}

test("setup, profile, weight sheet, and placeholders", async ({ page }, info) => {
  const oid = `axe-${info.project.name}-${Date.now()}`;
  await signInAs(page, oid);
  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "Set up" })).toBeVisible();
  await check(page, `${info.project.name} setup`);

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
  await expect(page.locator("[data-field=kcal]")).toHaveText("2218");
  await check(page, `${info.project.name} profile`);

  await page.getByRole("button", { name: "Customise" }).click();
  await expect(page.getByText("More carbs means less protein or fat.")).toBeVisible();
  await check(page, `${info.project.name} customise`);

  await page.getByRole("button", { name: /Trend not ready/ }).click();
  await expect(page.getByRole("dialog", { name: "Log weight" })).toBeVisible();
  await check(page, `${info.project.name} weight sheet`);
  await page.keyboard.press("Escape");

  for (const path of ["/today", "/log", "/progress"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await check(page, `${info.project.name} ${path}`);
  }
});
