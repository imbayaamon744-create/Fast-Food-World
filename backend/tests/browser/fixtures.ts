import { randomBytes, randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { quote } from "../../server/orders.js";
import { basketSchema, orderSchema } from "../../server/validation.js";
import type { Prisma } from "../../server/generated/prisma/client.js";

export const beef = "10000000-0000-4000-8000-000000000001";
export const bhajias = "10000000-0000-4000-8000-000000000002";
export async function mockApi(page: Page) {
  const state = {
    menu: [
      { id: beef, name: "Beef Samosa", description: "Spiced beef samosa", priceMinor: 5000, available: true, category: { name: "Signature Samosas" } },
      { id: bhajias, name: "Crispy Potato Bhajias", description: "Spiced potatoes", priceMinor: 10000, available: true, category: { name: "Snacks & Treats" } },
    ],
    settings: { currency: "KES", deliveryFeeMinor: 15000, acceptingOrders: true, pickupEnabled: true, deliveryEnabled: true },
    orders: new Map<string, { payload: any; result: any }>(),
    attempts: [] as Array<{ key: string; body: any }>,
    recoveries: 0, tracking: 0, menuFailure: false, quoteFailure: false,
    failNext: "" as "" | "lost" | "network" | "server",
    csrf: randomBytes(32).toString("hex"), csrfExpired: false,
  };
  const tx = {
    restaurantSettings: { findUnique: async () => state.settings },
    menuItem: { findMany: async () => state.menu },
  } as unknown as Prisma.TransactionClient;
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const send = (status: number, data: object) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    const fail = (status: number, code: string, message: string) => send(status, { error: { code, message } });
    if (path === "/api/csrf") return send(200, { csrfToken: state.csrf });
    if (path === "/api/menu") return state.menuFailure ? fail(503, "UNAVAILABLE", "Menu unavailable.") : send(200, { items: state.menu, currency: "KES" });
    if (path === "/api/settings") return send(200, { settings: state.settings });
    if (request.headers()["x-csrf-token"] !== state.csrf || state.csrfExpired) {
      state.csrfExpired = false; state.csrf = randomBytes(32).toString("hex");
      return fail(403, "CSRF_REJECTED", "Refresh your session.");
    }
    const body = request.postDataJSON();
    if (path === "/api/orders/quote") {
      if (state.quoteFailure) return fail(500, "INTERNAL_ERROR", "Quote temporarily unavailable.");
      try { return send(200, { quote: await quote(tx, basketSchema.parse(body)) }); }
      catch (error: any) { return fail(error.status ?? 400, error.code ?? "VALIDATION_ERROR", error.message); }
    }
    if (path === "/api/orders/recover") {
      state.recoveries++;
      const found = state.orders.get(request.headers()["idempotency-key"]!);
      return found ? send(200, { ...found.result, replayed: true }) : fail(404, "SUBMISSION_NOT_FOUND", "No stored order found yet.");
    }
    if (path === "/api/orders/track") {
      state.tracking++;
      const found = Array.from(state.orders.values()).find(o => o.result.trackingToken === body.token);
      return found ? send(200, { order: found.result.order }) : fail(404, "ORDER_NOT_FOUND", "Order not found.");
    }
    if (path === "/api/orders") {
      const key = request.headers()["idempotency-key"]!;
      state.attempts.push({ key, body });
      if (state.failNext === "network") { state.failNext = ""; return route.abort("failed"); }
      if (state.failNext === "server") { state.failNext = ""; return fail(500, "INTERNAL_ERROR", "Could not save the order."); }
      const existing = state.orders.get(key);
      if (existing) return JSON.stringify(existing.payload) === JSON.stringify(body)
        ? send(200, { ...existing.result, replayed: true })
        : fail(409, "IDEMPOTENCY_CONFLICT", "Submission already used.");
      try {
        const input = orderSchema.parse(body), priced = await quote(tx, input);
        if (input.expectedTotalMinor !== priced.totalMinor || input.quoteFingerprint !== priced.quoteFingerprint) return fail(409, "PRICE_CHANGED", "Prices or menu details changed. Review again.");
        const result = {
          order: { id: randomUUID(), status: "ACCEPTED", fulfilment: input.fulfilment, currency: "KES",
            items: priced.items, subtotalMinor: priced.subtotalMinor, deliveryFeeMinor: priced.deliveryFeeMinor,
            totalMinor: priced.totalMinor, history: [{ toStatus: "ACCEPTED", status: "ACCEPTED", createdAt: new Date().toISOString() }] },
          trackingToken: randomBytes(32).toString("hex"), replayed: false,
        };
        state.orders.set(key, { payload: body, result });
        if (state.failNext === "lost") { state.failNext = ""; return route.abort("failed"); }
        return send(201, result);
      } catch (error: any) { return fail(error.status ?? 400, error.code ?? "VALIDATION_ERROR", error.message); }
    }
    return fail(404, "NOT_FOUND", "Unknown test endpoint.");
  });
  return state;
}
export async function add(page: Page, id: string, quantity = 1) {
  await page.locator("#menu-item").selectOption(id);
  await page.locator("#item-quantity").fill(String(quantity));
  await page.getByRole("button", { name: "Add to basket", exact: true }).click();
}
export async function details(page: Page, delivery = false) {
  await page.getByLabel("Your name", { exact: true }).fill("Guest Tester");
  await page.getByLabel("Phone number", { exact: true }).fill("0712345678");
  if (delivery) {
    await page.locator("#fulfilment").selectOption("DELIVERY");
    await page.getByLabel("Delivery address", { exact: true }).fill("42 Test Road, Nairobi");
  }
}
