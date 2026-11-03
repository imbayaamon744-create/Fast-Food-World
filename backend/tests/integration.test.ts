import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { createDatabase, databaseSchema } from "../server/db.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { hash, hashPassword } from "../server/security.js";
import { seed } from "../prisma/seed.js";

if (!/^restaurant_test_[a-f0-9]{16}$/.test(process.env.TEST_SCHEMA ?? "")) {
  throw new Error("Use npm run test:integration; do not run this file against a normal database.");
}
const config = readConfig();
if (databaseSchema(config.DATABASE_URL) !== process.env.TEST_SCHEMA) throw new Error("Test schema and database connection do not match.");
const db = createDatabase(config.DATABASE_URL);
const runtime = await createApp(db, config);
const guest = request.agent(runtime.app);
const admin = request.agent(runtime.app);
const adminPassword = randomBytes(20).toString("hex");
let guestCsrf = "";
let adminCsrf = "";
let adminId = "";
let samosaId = "";
let bhajiasId = "";
let pickupFingerprint = "";

const post = (client: typeof guest, path: string, csrf: string, body: object, key?: string) => {
  const call = client.post(path).set("Origin", config.APP_ORIGIN).set("X-CSRF-Token", csrf);
  if (key) call.set("Idempotency-Key", key);
  return call.send(body);
};
const patch = (path: string, body: object) => admin.patch(path).set("Origin", config.APP_ORIGIN).set("X-CSRF-Token", adminCsrf).send(body);
const pickup = () => ({
  customerName: "Integration Guest", phone: "0712345678", fulfilment: "PICKUP",
  items: [{ menuItemId: samosaId, quantity: 2 }, { menuItemId: bhajiasId, quantity: 1 }],
  quoteFingerprint: pickupFingerprint, expectedTotalMinor: 20000,
});
before(async () => {
  await seed(db);
  const owner = await db.admin.create({ data: { email: "integration@example.invalid", passwordHash: await hashPassword(adminPassword) } });
  adminId = owner.id;
  samosaId = (await db.menuItem.findUniqueOrThrow({ where: { slug: "beef-samosa" } })).id;
  bhajiasId = (await db.menuItem.findUniqueOrThrow({ where: { slug: "bhajias" } })).id;
  guestCsrf = (await guest.get("/api/csrf").expect(200)).body.csrfToken;
  pickupFingerprint = (await post(guest, "/api/orders/quote", guestCsrf, { items: pickup().items, fulfilment: "PICKUP" }).expect(200)).body.quote.quoteFingerprint;
  const beforeLogin = await admin.get("/api/csrf").expect(200);
  const response = await post(admin, "/api/admin/login", beforeLogin.body.csrfToken, { email: "integration@example.invalid", password: adminPassword }).expect(200);
  adminCsrf = response.body.csrfToken;
  assert.notEqual(adminCsrf, beforeLogin.body.csrfToken);
  assert.notEqual(response.headers["set-cookie"]?.[0], beforeLogin.headers["set-cookie"]?.[0]);
  assert.match(response.headers["set-cookie"]![0]!, /HttpOnly/);
  assert.match(response.headers["set-cookie"]![0]!, /SameSite=Strict/);
});
after(async () => { await runtime.close(); await db.$disconnect(); });

test("seed is repeatable and never overwrites owner changes; menu search/categories/availability are shared", async () => {
  assert.equal(await db.menuItem.count(), 19);
  await db.menuItem.update({ where: { id: bhajiasId }, data: { priceMinor: 10100 } });
  await seed(db);
  assert.equal((await db.menuItem.findUniqueOrThrow({ where: { id: bhajiasId } })).priceMinor, 10100);
  await db.menuItem.update({ where: { id: bhajiasId }, data: { priceMinor: 10000 } });
  const menu = await guest.get("/api/menu?search=BEEF&category=samosas&available=true").expect(200);
  assert.equal(menu.body.items.length, 1);
  assert.equal(menu.body.items[0].priceMinor, 5000);
  const categories = await guest.get("/api/categories").expect(200);
  assert.equal(categories.body.categories.length, 5);
  const settings = await guest.get("/api/settings").expect(200);
  assert.equal(settings.body.settings.deliveryFeeMinor, 15000);
  assert.equal(settings.body.settings.phone, null);
});
test("database-backed quotes, concurrent duplicate prevention, private tracking and immutable item snapshots", async () => {
  const body = pickup(); const key = randomUUID();
  const quoted = await post(guest, "/api/orders/quote", guestCsrf, { items: body.items, fulfilment: "DELIVERY" }).expect(200);
  assert.equal(quoted.body.quote.totalMinor, 35000);
  const results = await Promise.all([post(guest, "/api/orders", guestCsrf, body, key), post(guest, "/api/orders", guestCsrf, body, key)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
  assert.equal(results[0]!.body.order.id, results[1]!.body.order.id);
  assert.equal(results[0]!.body.trackingToken, results[1]!.body.trackingToken);
  assert.equal(await db.order.count({ where: { idempotencyHash: hash(key) } }), 1);
  const saved = await db.order.findUniqueOrThrow({ where: { id: results[0]!.body.order.id }, include: { items: true, history: true } });
  assert.equal(saved.items.length, 2);
  assert.equal(saved.history.length, 1);
  assert.equal(saved.status, "ACCEPTED");
  assert.equal(saved.history[0]!.toStatus, "ACCEPTED");
  assert.equal(saved.totalMinor, 20000);
  assert.equal(saved.trackingTokenHash, hash(results[0]!.body.trackingToken));
  assert.notEqual(saved.trackingTokenHash, results[0]!.body.trackingToken);
  const tracked = await post(guest, "/api/orders/track", guestCsrf, { token: results[0]!.body.trackingToken }).expect(200);
  for (const field of ["customerName", "phone", "deliveryAddress", "notes", "trackingTokenHash", "idempotencyHash"]) assert.equal(field in tracked.body.order, false);
  await post(guest, "/api/orders/track", guestCsrf, { token: randomBytes(32).toString("hex") }).expect(404);
  await guest.get("/api/orders/" + saved.id).expect(404);
  await post(guest, "/api/orders", guestCsrf, { ...body, customerName: "Changed" }, key).expect(409);
  await db.menuItem.update({ where: { id: samosaId }, data: { name: "Updated name", priceMinor: 6000, available: false } });
  const replay = await post(guest, "/api/orders", guestCsrf, body, key).expect(200);
  assert.equal(replay.body.order.items.find((i: { menuItemId: string }) => i.menuItemId === samosaId).name, "Beef Samosa");
  assert.equal(replay.body.order.totalMinor, 20000);
  await db.menuItem.update({ where: { id: samosaId }, data: { name: "Beef Samosa", priceMinor: 5000, available: true } });
});
test("stale totals, missing addresses, invalid input and unavailable items create no partial records", async () => {
  const beforeOrders = await db.order.count(); const beforeItems = await db.orderItem.count();
  await post(guest, "/api/orders", guestCsrf, { ...pickup(), expectedTotalMinor: 1 }, randomUUID()).expect(409);
  await post(guest, "/api/orders", guestCsrf, { ...pickup(), fulfilment: "DELIVERY" }, randomUUID()).expect(400);
  await post(guest, "/api/orders", guestCsrf, { ...pickup(), totalMinor: 1 }, randomUUID()).expect(400);
  await db.menuItem.update({ where: { id: bhajiasId }, data: { available: false } });
  await post(guest, "/api/orders", guestCsrf, pickup(), randomUUID()).expect(409);
  await db.menuItem.update({ where: { id: bhajiasId }, data: { available: true } });
  assert.equal(await db.order.count(), beforeOrders);
  assert.equal(await db.orderItem.count(), beforeItems);
});
test("an injected database failure rolls back order, lines and initial history together", async () => {
  // Restricted to the unique disposable test schema validated at module entry.
  await db.$executeRawUnsafe(`CREATE FUNCTION reject_test_history() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Intentional integration-test failure'; END; $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER reject_history BEFORE INSERT ON "OrderStatusHistory" FOR EACH ROW EXECUTE FUNCTION reject_test_history()');
  const counts = await Promise.all([db.order.count(), db.orderItem.count(), db.orderStatusHistory.count()]);
  try {
    await post(guest, "/api/orders", guestCsrf, pickup(), randomUUID()).expect(500);
    assert.deepEqual(await Promise.all([db.order.count(), db.orderItem.count(), db.orderStatusHistory.count()]), counts);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER reject_history ON "OrderStatusHistory"');
    await db.$executeRawUnsafe('DROP FUNCTION reject_test_history()');
  }
});
test("authorization, status transitions, concurrent admin edits and audit history", async () => {
  await guest.get("/api/admin/orders").expect(401);
  await guest.patch("/api/admin/settings").set("Origin", config.APP_ORIGIN).set("X-CSRF-Token", guestCsrf).send({ acceptingOrders: false }).expect(401);
  const created = await post(guest, "/api/orders", guestCsrf, pickup(), randomUUID()).expect(201);
  const id = created.body.order.id;
  await patch("/api/admin/orders/" + id + "/status", { expectedStatus: "ACCEPTED", status: "COMPLETED" }).expect(409);
  const changes = await Promise.all([
    patch("/api/admin/orders/" + id + "/status", { expectedStatus: "ACCEPTED", status: "PREPARING" }),
    patch("/api/admin/orders/" + id + "/status", { expectedStatus: "ACCEPTED", status: "CANCELLED", reason: "Customer requested cancellation" }),
  ]);
  assert.deepEqual(changes.map(r => r.status).sort(), [200, 409]);
  const history = await db.orderStatusHistory.findMany({ where: { orderId: id } });
  assert.equal(history.length, 2);
  assert.ok(history.some(h => h.adminId === adminId));
  const detail = await admin.get("/api/admin/orders/" + id).expect(200);
  assert.equal(detail.body.order.phone, "0712345678");
  assert.equal(detail.body.order.trackingTokenHash, undefined);
});
test("admin menu/settings updates affect quotes and preserve database constraints", async () => {
  await patch("/api/admin/menu/" + samosaId, { priceMinor: 5500 }).expect(200);
  const body = pickup();
  const quote = await post(guest, "/api/orders/quote", guestCsrf, { items: body.items, fulfilment: "PICKUP" }).expect(200);
  assert.equal(quote.body.quote.totalMinor, 21000);
  await patch("/api/admin/menu/" + samosaId, { priceMinor: -1 }).expect(400);
  await assert.rejects(db.menuItem.update({ where: { id: samosaId }, data: { priceMinor: -1 } }));
  await patch("/api/admin/menu/" + samosaId, { priceMinor: 5000 }).expect(200);
  await patch("/api/admin/settings", { deliveryEnabled: false }).expect(200);
  await post(guest, "/api/orders/quote", guestCsrf, { items: body.items, fulfilment: "DELIVERY" }).expect(409);
  await patch("/api/admin/settings", { deliveryEnabled: true }).expect(200);
});
test("catering requests stay pending until an authenticated admin decision; quotes and retries survive", async () => {
  const body = { customerName: "Catering Guest", phone: "0712345678", eventDate: "2099-12-01", location: "Nairobi", guestCount: 30, package: "Classic" };
  const key = randomUUID();
  const created = await post(guest, "/api/catering", guestCsrf, body, key).expect(201);
  assert.equal(created.body.request.status, "PENDING");
  assert.match(created.body.message, /does not confirm a booking/);
  await post(guest, "/api/catering", guestCsrf, body, key).expect(200);
  await post(guest, "/api/catering", guestCsrf, { ...body, guestCount: 40 }, key).expect(409);
  assert.equal(await db.cateringRequest.count({ where: { idempotencyHash: hash(key) } }), 1);
  await patch("/api/admin/catering/" + created.body.request.id, { expectedStatus: "PENDING", status: "PENDING", quoteMinor: 1234500 }).expect(200);
  await patch("/api/admin/catering/" + created.body.request.id, { expectedStatus: "PENDING", status: "CONFIRMED", adminNotes: "Discuss venue access", quoteMinor: 1234500 }).expect(200);
  const stored = await db.cateringRequest.findUniqueOrThrow({ where: { id: created.body.request.id } });
  assert.equal(stored.quoteMinor, 1234500); assert.equal(stored.adminNotes, "Discuss venue access");
  await patch("/api/admin/catering/" + stored.id, { expectedStatus: "PENDING", status: "DECLINED" }).expect(409);
  await patch("/api/admin/catering/" + stored.id, { expectedStatus: "CONFIRMED", status: "CONFIRMED", quoteMinor: null }).expect(200);
});
test("all admin management mutations reject a guest with a valid CSRF session", async () => {
  for (const [method, path, body] of [
    ["post", "/api/admin/menu", {}], ["post", "/api/admin/categories", {}],
    ["patch", "/api/admin/menu/" + samosaId, { available: false }],
    ["patch", "/api/admin/categories/" + randomUUID(), { name: "Changed" }],
    ["patch", "/api/admin/settings", { acceptingOrders: false }],
    ["patch", "/api/admin/orders/" + randomUUID() + "/status", { expectedStatus: "ACCEPTED", status: "PREPARING" }],
    ["patch", "/api/admin/catering/" + randomUUID(), { expectedStatus: "PENDING", status: "CONFIRMED" }],
  ] as const) {
    await guest[method](path).set("Origin", config.APP_ORIGIN).set("X-CSRF-Token", guestCsrf).send(body).expect(401);
  }
  await guest.get("/api/admin/orders/summary").expect(401);
  await guest.get("/api/admin/categories").expect(401);
  const summary = await admin.get("/api/admin/orders/summary").expect(200);
  assert.equal(summary.body.groups.reduce((sum: number, group: { count: number }) => sum + group.count, 0), await db.order.count());
});

test("PostgreSQL sessions survive app instances, expire, and are invalidated on logout or account disable", async () => {

  // Obtain an explicit new login cookie for a second application instance.
  const fresh = request.agent(runtime.app);
  const csrf = (await fresh.get("/api/csrf")).body.csrfToken;
  const login = await post(fresh, "/api/admin/login", csrf, { email: "integration@example.invalid", password: adminPassword }).expect(200);
  const cookie = login.headers["set-cookie"]![0]!.split(";")[0]!;
  const second = await createApp(db, config);
  try {
    await request(second.app).get("/api/admin/session").set("Cookie", cookie).expect(200);
    await db.admin.update({ where: { id: adminId }, data: { active: false } });
    await fresh.get("/api/admin/session").expect(401);
    await db.admin.update({ where: { id: adminId }, data: { active: true } });
    await post(fresh, "/api/admin/logout", login.body.csrfToken, {}).expect(204);
    await request(second.app).get("/api/admin/session").set("Cookie", cookie).expect(401);
  } finally { await second.close(); }
  // Server-side absolute timeout applies even if a cookie is replayed.
  await db.$executeRaw`UPDATE "sessions" SET "sess" = jsonb_set("sess"::jsonb, '{authenticatedAt}', '1'::jsonb)::json WHERE "sess"->>'adminId' = ${adminId}`;
  await admin.get("/api/admin/session").expect(401);
});
test("persistent rate limits reject repeated failed logins with a Retry-After header", async () => {
  // Last test: clear only buckets in this isolated test schema to make counts deterministic.
  await db.rateLimitBucket.deleteMany();
  const client = request.agent(runtime.app);
  const csrf = (await client.get("/api/csrf")).body.csrfToken;
  for (let attempt = 0; attempt < 10; attempt++) {
    await post(client, "/api/admin/login", csrf, { email: "missing@example.invalid", password: "incorrect" }).expect(401);
  }
  const limited = await post(client, "/api/admin/login", csrf, { email: "missing@example.invalid", password: "incorrect" }).expect(429);
  assert.ok(Number(limited.headers["retry-after"]) > 0);
});

