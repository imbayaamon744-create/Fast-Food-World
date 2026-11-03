import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { mockApi, add, details, beef, bhajias } from "./fixtures.js";

test("multiple items, editable quantities, delivery review, double click and private tracking", async ({ page }, info) => {
  const api = await mockApi(page);
  await page.goto("/order.html");
  await expect(page.locator("#address-field")).toBeHidden();
  await add(page, beef, 2); await add(page, bhajias);
  const quantity = page.getByRole("spinbutton", { name: "Quantity for Beef Samosa", exact: true });
  await quantity.fill("21"); await quantity.press("Tab");
  expect(await quantity.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  await quantity.fill("3"); await quantity.press("Tab");
  await details(page, true);
  await expect(page.locator("#delivery-address")).toHaveAttribute("required", "");
  await page.locator("#order-notes").fill("Please ring the bell.");
  await page.getByRole("button", { name: "Review my order", exact: true }).click();
  await expect(page.locator("#order-review")).toBeVisible();
  await expect(page.locator("#review-total")).toContainText("400.00");
  await expect(page.locator("#review-delivery")).toContainText("150.00");
  await expect(page.locator("#review-details")).toContainText("Guest Tester");
  await expect(page.locator("#review-details")).toContainText("42 Test Road, Nairobi");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir(".local/screenshots", { recursive: true });
  await page.screenshot({ path: ".local/screenshots/order-review-" + info.project.name + ".png", fullPage: true });
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("restaurant.basket.v1")!));
  expect(persisted).toEqual([{ menuItemId: beef, quantity: 3 }, { menuItemId: bhajias, quantity: 1 }]);
  await page.locator("#place-order").evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.locator("#order-confirmation")).toBeVisible();
  expect(api.attempts).toHaveLength(1); expect(api.orders.size).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("restaurant.basket.v1")!))).toEqual([]);
  const token = [...api.orders.values()][0]!.result.trackingToken;
  const urls: string[] = []; page.on("request", req => urls.push(req.url()));
  await page.locator("#tracking-link").click();
  await expect(page.locator("#tracking-result")).toBeVisible();
  await expect(page.locator("#tracking-total")).toContainText("400.00");
  await expect(page.locator("body")).not.toContainText("Guest Tester");
  await expect(page.locator("body")).not.toContainText("0712345678");
  await expect(page.locator("body")).not.toContainText("42 Test Road");
  expect(urls.every(url => !url.includes(token))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".local/screenshots/order-tracking-" + info.project.name + ".png", fullPage: true });
});

test("restored baskets discard saved prices/contact data and reconcile current availability", async ({ page }) => {
  const api = await mockApi(page);
  api.menu[1]!.available = false;
  await page.addInitScript(({ beef, bhajias }) => {
    localStorage.setItem("restaurant.basket.v1", JSON.stringify([
      { menuItemId: beef, quantity: 2, priceMinor: 1, customerName: "Should not persist" },
      { menuItemId: bhajias, quantity: 1 },
    ]));
  }, { beef, bhajias });
  await page.goto("/order.html");
  await expect(page.locator("#cart-items")).toContainText("Unavailable");
  await expect(page.locator("#cart-items")).toContainText("50.00");
  await expect(page.locator("#customer-name")).toHaveValue("");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("restaurant.basket.v1")!));
  expect(stored[0]).toEqual({ menuItemId: beef, quantity: 2 });
  await page.getByRole("button", { name: "Remove Crispy Potato Bhajias from basket" }).click();
  await page.getByRole("button", { name: "Keep item", exact: true }).click();
  await expect(page.locator("#cart-items")).toContainText("Crispy Potato");
  await page.getByRole("button", { name: "Remove Crispy Potato Bhajias from basket" }).click();
  await page.getByRole("button", { name: "Remove item", exact: true }).click();
  await expect(page.locator("#cart-items")).not.toContainText("Crispy Potato");
  api.menu[0]!.priceMinor = 6000;
  await page.getByRole("button", { name: "Refresh menu & availability" }).click();
  await expect(page.locator("#subtotal")).toContainText("120.00");
});

test("basket persistence across reload contains only IDs/quantities and pickup hides the address", async ({ page }) => {
  await mockApi(page);
  await page.goto("/order.html"); await add(page, beef, 2); await details(page, true);
  await page.locator("#fulfilment").selectOption("PICKUP");
  await expect(page.locator("#address-field")).toBeHidden();
  expect(await page.locator("#delivery-address").evaluate((el: HTMLInputElement) => el.required)).toBe(false);
  await page.reload();
  await expect(page.locator("#item-count")).toContainText("2 items");
  await expect(page.locator("#subtotal")).toContainText("100.00");
  const storage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  expect(Object.keys(storage)).toEqual(["restaurant.basket.v1"]);
  expect(JSON.stringify(storage)).not.toContain("Guest Tester");
  await details(page);
  await page.getByRole("button", { name: "Review my order", exact: true }).click();
  await expect(page.locator("#review-delivery")).toContainText("0.00");
  await expect(page.locator("#review-details")).not.toContainText("42 Test Road");
});

test("empty basket and unavailable initial menu expose accessible recovery", async ({ page }) => {
  const api = await mockApi(page); api.menuFailure = true;
  await page.goto("/order.html");
  await expect(page.getByRole("alert")).toContainText("Menu unavailable");
  await expect(page.getByRole("button", { name: "Add to basket", exact: true })).toBeDisabled();
  api.menuFailure = false;
  await page.getByRole("button", { name: "Refresh menu & availability" }).click();
  await expect(page.getByRole("button", { name: "Add to basket", exact: true })).toBeEnabled();
  // Supply valid details so native validation permits the empty-basket handler to run.
  await details(page);
  await page.getByRole("button", { name: "Review my order", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Add at least one item");
  expect(api.orders.size).toBe(0);
});

test("offsetting line-price changes require another explicit review despite unchanged total", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/order.html"); await add(page, beef, 2); await add(page, bhajias); await details(page);
  await page.getByRole("button", { name: "Review my order", exact: true }).click();
  await expect(page.locator("#order-review")).toBeVisible();
  api.menu[0]!.priceMinor += 500; api.menu[1]!.priceMinor -= 1000;
  await page.locator("#place-order").click();
  await expect(page.getByRole("alert")).toContainText("review again");
  await expect(page.locator("#order-builder")).toBeVisible();
  await expect(page.locator("#customer-name")).toHaveValue("Guest Tester");
  expect(api.orders.size).toBe(0);
  await page.getByRole("button", { name: "Review my order", exact: true }).click();
  await expect(page.locator("#review-items")).toContainText("55.00");
  await expect(page.locator("#review-total")).toContainText("200.00");
  await page.locator("#place-order").click();
  await expect(page.locator("#order-confirmation")).toBeVisible();
  expect(api.orders.size).toBe(1);
});

test("product becoming unavailable after review keeps the basket and blocks submission", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/order.html"); await add(page, beef); await details(page);
  await page.getByRole("button", { name: "Review my order", exact: true }).click();
  await expect(page.locator("#order-review")).toBeVisible();
  api.menu[0]!.available = false;
  await page.locator("#place-order").click();
  await expect(page.getByRole("alert")).toContainText("no longer available");
  await expect(page.locator("#cart-items")).toContainText("Unavailable");
  expect(api.orders.size).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("restaurant.basket.v1")!))).toHaveLength(1);
});

test("lost success response retries the same key and payload without clearing prematurely", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/order.html"); await add(page, beef); await details(page);
  await page.getByRole("button", { name: "Review my order", exact: true }).click();
  api.failNext = "lost";
  await page.locator("#place-order").click();
  await expect(page.getByRole("alert")).toContainText("not confirmed");
  await expect(page.locator("#order-confirmation")).toBeHidden();
  await expect(page.locator("#edit-order")).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("restaurant.basket.v1")!))).toHaveLength(1);
  await page.getByRole("button", { name: "Retry submission", exact: true }).click();
  await expect(page.locator("#order-confirmation")).toBeVisible();
  expect(api.orders.size).toBe(1);
  expect(api.attempts).toHaveLength(2);
  expect(api.attempts[1]).toEqual(api.attempts[0]);
});

test("reload after a lost response recovers a private receipt without storing customer details", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/order.html"); await add(page, beef); await details(page, true);
  await page.getByRole("button", { name: "Review my order", exact: true }).click();
  api.failNext = "lost"; await page.locator("#place-order").click();
  await expect(page.getByRole("alert")).toContainText("not confirmed");
  const session = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
  expect(Object.keys(session)).toEqual(["restaurant.submission.v1"]);
  expect(JSON.stringify(session)).not.toContain("Guest Tester");
  page.on("dialog", dialog => void dialog.accept());
  await page.reload();
  await expect(page.locator("#order-confirmation")).toBeVisible();
  expect(api.attempts).toHaveLength(1); expect(api.recoveries).toBe(1);
  expect(api.orders.size).toBe(1);
  await page.reload();
  await expect(page.locator("#order-confirmation")).toBeVisible();
});

test("quote/network/server errors retain details, then a retry succeeds", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/order.html"); await add(page, beef); await details(page);
  api.quoteFailure = true;
  await page.getByRole("button", { name: "Review my order", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Quote temporarily unavailable");
  await expect(page.locator("#customer-name")).toHaveValue("Guest Tester");
  api.quoteFailure = false;
  await page.getByRole("button", { name: "Review my order", exact: true }).click();
  api.failNext = "server"; await page.locator("#place-order").click();
  await expect(page.getByRole("alert")).toContainText("not confirmed");
  expect(api.orders.size).toBe(0);
  api.failNext = "network";
  await page.getByRole("button", { name: "Retry submission", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("could not reach");
  await page.getByRole("button", { name: "Retry submission", exact: true }).click();
  await expect(page.locator("#order-confirmation")).toBeVisible();
  expect(new Set(api.attempts.map(a => a.key)).size).toBe(1);
});

test("expired CSRF refreshes safely, and invalid tracking links disclose no order", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/order.html"); await add(page, beef); await details(page);
  await page.getByRole("button", { name: "Review my order", exact: true }).click();
  await expect(page.locator("#order-review")).toBeVisible();
  api.csrfExpired = true; await page.locator("#place-order").click();
  await expect(page.locator("#order-confirmation")).toBeVisible();
  expect(api.orders.size).toBe(1);
  await page.goto("/track.html#invalid");
  await expect(page.locator("#tracking-message")).toContainText("complete private tracking link");
  await expect(page.locator("#tracking-result")).toBeHidden();
  await page.goto("/track.html#" + "0".repeat(64));
  await expect(page.locator("#tracking-error")).toContainText("not found");
  await expect(page.locator("#tracking-result")).toBeHidden();
});
