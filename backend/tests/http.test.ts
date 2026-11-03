import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import type { Database } from "../server/db.js";

// No database is used in these boundary tests. Only the rate limiter's query is stubbed.
// Durable sessions, transactions and real queries are covered by integration.test.ts.
const db = { $queryRaw: async () => [{ hits: 1, expiresAt: new Date(Date.now() + 60000) }] } as unknown as Database;
const config = readConfig({
  NODE_ENV: "test", APP_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgresql://example.invalid/test?sslmode=verify-full",
  SESSION_SECRET: randomBytes(48).toString("hex"), TRACKING_SECRET: randomBytes(48).toString("hex"),
});
const { app, close } = await createApp(db, config);
after(close);

test("static allowlist preserves the existing frontend and blocks secrets and backend source", async () => {
  for (const file of ["/", "/story.html", "/contact.html", "/menu.html", "/menu.js", "/landing.js", "/order.html", "/order.js", "/order.css", "/track.html", "/track.js", "/api-client.js", "/order-core.js", "/catering.html", "/shared.js", "/admin.html", "/admin.js", "/admin.css", "/images/background.png"]) {
    await request(app).get(file).expect(200);
  }
  const page = await request(app).get("/order.html");
  assert.match(page.text, /<script src="order\.js" type="module"><\/script>/);
  for (const file of ["/.env", "/.env.example", "/package.json", "/backend/server/config.ts", "/backend/prisma/schema.prisma", "/.git/config", "/images/../.env", "/images/%2e%2e/.env"]) {
    await request(app).get(file).expect(404);
  }
});
test("admin data requires authentication and all mutations require CSRF and exact origin", async () => {
  for (const path of ["/api/admin/session", "/api/admin/orders", "/api/admin/orders/summary", "/api/admin/categories", "/api/admin/menu", "/api/admin/catering"]) {
    await request(app).get(path).expect(401);
  }
  for (const path of ["/api/admin/login", "/api/admin/logout", "/api/orders", "/api/catering"]) {
    await request(app).post(path).set("Origin", config.APP_ORIGIN).send({}).expect(403);
    await request(app).post(path).set("Origin", "https://attacker.invalid").send({}).expect(403);
  }
});
test("malformed and oversized JSON receive safe errors with security headers", async () => {
  const invalid = await request(app).post("/api/orders").set("Content-Type", "application/json").send("{").expect(400);
  assert.equal(invalid.body.error.code, "INVALID_JSON");
  await request(app).post("/api/orders").send({ notes: "x".repeat(40000) }).expect(413);
  const response = await request(app).get("/api/admin/orders");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.ok(response.headers["content-security-policy"]);
  assert.equal(response.headers["x-powered-by"], undefined);
});
