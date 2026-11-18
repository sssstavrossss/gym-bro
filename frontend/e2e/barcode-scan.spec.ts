import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

function headers(oid: string) {
  return { "X-Test-Oid": oid, "X-Test-Name": "Test User", "Content-Type": "application/json" };
}

// The app registers a service worker (for push). In WebKit, a page it controls bypasses
// page.route, so the stubbed Open Food Facts answer below would never arrive.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });

/** A fictional EAN-13 (prefix 2 is for in-store codes) with its check digit, unique per run and browser. */
function fictionalEan(): string {
  const body = "2" + String(Date.now() * 10 + Math.floor(Math.random() * 10)).slice(-11);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[11 - i]) * (i % 2 === 0 ? 3 : 1);
  return body + ((10 - (sum % 10)) % 10);
}

async function signedIn(page: Page, label: string) {
  const oid = `e2e-scan-${label}-${Date.now()}-${test.info().project.name}`;
  await page.goto("/");
  const when = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return { zone, today: new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date()) };
  });
  expect((await page.request.put(`/api/weigh-ins/${when.today}`, { headers: headers(oid), data: { kg: 83.6, timeZone: when.zone } })).ok()).toBeTruthy();
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
  }, oid);
  return oid;
}

/**
 * Replaces the camera with a canvas that shows `code` as a real EAN-13 barcode, so the page runs its
 * actual decoder on it. With no code, the camera is refused, as when someone says no to the prompt.
 */
async function fakeCamera(page: Page, code: string | null) {
  await page.addInitScript((ean) => {
    const devices = navigator.mediaDevices ?? ({} as MediaDevices);
    Object.defineProperty(navigator, "mediaDevices", { value: devices, configurable: true });
    devices.getUserMedia = async () => {
      if (!ean) throw new DOMException("Camera refused", "NotAllowedError");
      const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
      const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
      const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
      const parity = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"][Number(ean[0])];
      let bits = "101";
      for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? L : G)[Number(ean[i])];
      bits += "01010";
      for (let i = 7; i <= 12; i++) bits += R[Number(ean[i])];
      bits += "101";
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const draw = () => {
        const g = canvas.getContext("2d")!;
        g.fillStyle = "#fff";
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.fillStyle = "#000";
        const module = 5;
        const left = (canvas.width - bits.length * module) / 2;
        for (let i = 0; i < bits.length; i++) if (bits[i] === "1") g.fillRect(left + i * module, 140, module, 200);
      };
      draw();
      window.setInterval(draw, 100);
      return canvas.captureStream(10);
    };
  }, code);
}

async function openScanner(page: Page) {
  await page.goto("/today");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: /Search or quick add/ }).click();
  const sheet = page.getByRole("dialog", { name: "Add food" });
  await sheet.getByRole("button", { name: "Scan a barcode" }).click();
  return page.getByRole("dialog", { name: "Scan barcode" });
}

test("the camera reads a barcode and opens that food on its amount", async ({ page }) => {
  const oid = await signedIn(page, "camera");
  const code = fictionalEan();
  const created = await page.request.post("/api/foods", {
    headers: headers(oid),
    data: { name: "Fictional scanned granola", barcode: code, kcalPer100: 450, proteinPer100: 10, fatPer100: 15, carbsPer100: 65, basis: "g", nutrientBasis: "per_100" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await fakeCamera(page, code);

  // The read can land before the scanner is even seen, so only the outcome is checked.
  const scanner = await openScanner(page);
  const sheet = page.getByRole("dialog").last();
  await expect(sheet.getByRole("heading", { name: "Fictional scanned granola" })).toBeVisible({ timeout: 15_000 });
  await expect(sheet.getByRole("button", { name: /^Add · \d+ kcal/ })).toBeVisible();
  await expect(scanner).toBeHidden();

  // Back goes to the search list, not the scanner, and the camera is let go.
  await sheet.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("dialog", { name: "Add food" }).getByRole("button", { name: "Scan a barcode" })).toBeVisible();
  expect(await page.evaluate(() => document.querySelector("video")?.srcObject ?? null)).toBeNull();
});

test("a typed code we don't know becomes a new food that keeps it, and the next scan finds it", async ({ page }) => {
  await signedIn(page, "typed");
  const code = fictionalEan();
  await fakeCamera(page, null);
  // Open Food Facts is outside the test. Answer for it once: nothing found.
  let stubbed = true;
  await page.route("**/api/foods/barcode/*", (route) => (stubbed
    ? route.fulfill({ json: { code, status: "not_found", food: null } })
    : route.continue()));

  const scanner = await openScanner(page);
  await expect(scanner.getByRole("heading", { name: "Scan barcode" })).toBeVisible();
  await expect(scanner.getByText("Camera access is off.", { exact: false })).toBeVisible();
  await scanner.getByRole("button", { name: "Type the number" }).click();
  const field = scanner.getByRole("textbox", { name: "Barcode number" });
  await expect(field).toBeFocused();
  await field.fill("1234");
  await scanner.getByRole("button", { name: "Look up" }).click();
  await expect(scanner.getByRole("alert")).toHaveText("A barcode is 8 to 14 digits.");

  await field.fill(`${code[0]} ${code.slice(1, 7)} ${code.slice(7)}`);
  await scanner.getByRole("button", { name: "Look up" }).click();
  await expect(scanner.getByText("Not in the food list or on Open Food Facts.")).toBeVisible();
  await expect(scanner.getByText(`${code[0]} ${code.slice(1, 7)} ${code.slice(7)}`)).toBeVisible();
  const axe = await new AxeBuilder({ page }).include("[data-scanner]").analyze();
  expect(axe.violations.filter((item) => item.impact === "serious" || item.impact === "critical").map((item) => item.id)).toEqual([]);
  await scanner.getByRole("button", { name: "Create food" }).click();

  const editor = page.getByRole("dialog", { name: "New food" });
  await expect(editor.getByRole("textbox", { name: /Barcode/ })).toHaveValue(code);
  await expect(editor.getByRole("radio", { name: "Per 100 g" })).toBeChecked();
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Fictional typed crispbread");
  await editor.getByRole("textbox", { name: /Calories/ }).fill("380");
  await editor.getByRole("button", { name: "Save food" }).click();
  await expect(page.getByRole("dialog").last().getByRole("heading", { name: "Fictional typed crispbread" })).toBeVisible();

  stubbed = false;
  await page.getByRole("dialog").last().getByRole("button", { name: "Back" }).click();
  const again = page.getByRole("dialog", { name: "Add food" });
  await again.getByRole("button", { name: "Scan a barcode" }).click();
  await page.getByRole("dialog", { name: "Scan barcode" }).getByRole("button", { name: "Type the number" }).click();
  await page.getByRole("dialog", { name: "Scan barcode" }).getByRole("textbox", { name: "Barcode number" }).fill(code);
  await page.getByRole("dialog", { name: "Scan barcode" }).getByRole("button", { name: "Look up" }).click();
  await expect(page.getByRole("dialog").last().getByRole("heading", { name: "Fictional typed crispbread" })).toBeVisible();
});
