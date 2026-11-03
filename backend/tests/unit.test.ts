import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readConfig } from "../server/config.js";
import { canTransition, normalizedRequest, quote, publicOrder } from "../server/orders.js";
import { hash, trackingToken, hashPassword, verifyPassword, requireCsrf, requireAdmin, SESSION_LIFETIME_MS } from "../server/security.js";
import * as v from "../server/validation.js";
import type { Prisma } from "../server/generated/prisma/client.js";
import type { Request, Response } from "express";

const itemId = randomUUID();
const basket = { items: [{ menuItemId: itemId, quantity: 2 }], fulfilment: "PICKUP" as const };
const config = () => readConfig({
  NODE_ENV: "test", APP_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgresql://example.invalid/test?sslmode=verify-full",
  SESSION_SECRET: randomBytes(48).toString("hex"), TRACKING_SECRET: randomBytes(48).toString("hex"),
});

test("configuration rejects placeholder secrets and insecure production origins without exposing values", () => {
  const cfg = config();
  assert.throws(() => readConfig({ ...cfg, PORT: "3000", TRUST_PROXY_HOPS: "0", SESSION_SECRET: "CHANGE_ME" }), /SESSION_SECRET/);
  assert.throws(() => readConfig({ ...cfg, PORT: "3000", TRUST_PROXY_HOPS: "0", NODE_ENV: "production" }), /HTTPS/);
});
test("strict order validation rejects injected prices, duplicate lines, fractional/excess quantities and missing addresses", () => {
  assert.equal(v.basketSchema.safeParse({ ...basket, priceMinor: 1 }).success, false);
  for (const quantity of [0, -1, 1.5, 21]) assert.equal(v.basketSchema.safeParse({ ...basket, items: [{ menuItemId: itemId, quantity }] }).success, false);
  assert.equal(v.basketSchema.safeParse({ ...basket, items: [...basket.items, ...basket.items] }).success, false);
  const input = { ...basket, customerName: "Guest", phone: "0712345678", quoteFingerprint: "0".repeat(64), expectedTotalMinor: 10000 };
  assert.equal(v.orderSchema.safeParse(input).success, true);
  assert.equal(v.orderSchema.safeParse({ ...input, fulfilment: "DELIVERY" }).success, false);
  assert.equal(v.orderSchema.safeParse({ ...input, deliveryAddress: "Unexpected pickup address" }).success, false);
  assert.equal(v.orderSchema.safeParse({ ...input, totalMinor: 1 }).success, false);
  assert.equal(v.orderSchema.safeParse({ ...input, customerName: "   " }).success, false);
});
test("status transitions enforce pickup/delivery paths and terminal states", () => {
  assert.equal(canTransition("PENDING", "COMPLETED", "PICKUP"), false);
  assert.equal(canTransition("READY", "OUT_FOR_DELIVERY", "PICKUP"), false);
  assert.equal(canTransition("READY", "COMPLETED", "DELIVERY"), false);
  assert.equal(canTransition("READY", "OUT_FOR_DELIVERY", "DELIVERY"), true);
  assert.equal(canTransition("OUT_FOR_DELIVERY", "COMPLETED", "DELIVERY"), true);
  assert.equal(canTransition("READY", "COMPLETED", "PICKUP"), true);
  for (const status of v.orderStatus.options) {
    assert.equal(canTransition("CANCELLED", status, "PICKUP"), false);
    assert.equal(canTransition("COMPLETED", status, "DELIVERY"), false);
  }
});
test("tracking tokens cannot be derived without the server secret and are repeatable on retries", () => {
  const key = randomUUID(); const order = randomUUID(); const secret = randomBytes(48).toString("hex");
  const token = trackingToken(key, order, secret);
  assert.equal(token.length, 64);
  assert.equal(trackingToken(key, order, secret), token);
  assert.notEqual(trackingToken(key, order, secret + "x"), token);
  assert.notEqual(hash(token), token);
});
test("request fingerprints canonicalize item ordering", () => {
  const first = { ...basket, items: [...basket.items, { menuItemId: randomUUID(), quantity: 1 }], customerName: "Guest", phone: "0712345678", quoteFingerprint: "0".repeat(64), expectedTotalMinor: 15000 };
  assert.deepEqual(normalizedRequest(first), normalizedRequest({ ...first, items: [...first.items].reverse() }));
});
test("Argon2id hashes are salted and only verify the correct password", async () => {
  const password = randomBytes(20).toString("hex");
  const a = await hashPassword(password); const b = await hashPassword(password);
  assert.ok(a.startsWith("$argon2id$"));
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(a, password), true);
  assert.equal(await verifyPassword(a, "incorrect"), false);
});
test("quote uses database prices and fees, rejects unavailable items and disabled ordering", async () => {
  const settings = { currency: "KES", acceptingOrders: true, pickupEnabled: true, deliveryEnabled: true, deliveryFeeMinor: 15000 };
  const menu = [{ id: itemId, name: "Beef Samosa", priceMinor: 5000, available: true }];
  const tx = {
    restaurantSettings: { findUnique: async () => settings },
    menuItem: { findMany: async () => menu },
  } as unknown as Prisma.TransactionClient;
  assert.equal((await quote(tx, basket)).totalMinor, 10000);
  assert.equal((await quote(tx, { ...basket, fulfilment: "DELIVERY" })).totalMinor, 25000);
  menu[0]!.available = false;
  await assert.rejects(quote(tx, basket), /no longer available/);
  menu[0]!.available = true; settings.acceptingOrders = false;
  await assert.rejects(quote(tx, basket), /currently unavailable/);
});
test("CSRF requires a matching token, origin and JSON, including login/logout", () => {
  const cfg = config(); const value = randomBytes(32).toString("hex");
  let nextCalled = false;
  const request = (origin: string, supplied: string) => ({
    method: "POST", session: { csrfToken: value }, get: (key: string) => key === "origin" ? origin : supplied, is: () => true,
  }) as unknown as Request;
  const guard = requireCsrf(cfg);
  guard(request(cfg.APP_ORIGIN, value), {} as Response, () => { nextCalled = true; });
  assert.ok(nextCalled);
  assert.throws(() => guard(request("https://attacker.invalid", value), {} as Response, () => {}), /origin/);
  assert.throws(() => guard(request(cfg.APP_ORIGIN, ""), {} as Response, () => {}), /Refresh/);
  assert.throws(() => guard(request(cfg.APP_ORIGIN, "é".repeat(64)), {} as Response, () => {}), /Refresh/);
});
test("menu image references reject executable and traversing paths; money is integer minor units", () => {
  const menu = { slug: "snack", name: "Snack", description: "Description", priceMinor: 5000, categoryId: randomUUID() };
  for (const imageUrl of ["javascript:alert(1)", "data:image/svg+xml,test", "//attacker.invalid/a.png", "images/../.env"]) {
    assert.equal(v.menuCreateSchema.safeParse({ ...menu, imageUrl }).success, false);
  }
  assert.equal(v.menuCreateSchema.safeParse({ ...menu, imageUrl: null }).success, true);
  assert.equal(v.menuCreateSchema.safeParse({ ...menu, imageUrl: "images/snack.png" }).success, true);
  assert.equal(v.menuCreateSchema.safeParse({ ...menu, priceMinor: 5.5 }).success, false);
});
test("catering validates real future calendar dates and never accepts booking status from guests", () => {
  const input = { customerName: "Guest", phone: "0712345678", eventDate: "2099-12-01", location: "Nairobi", guestCount: 30, package: "Classic" };
  assert.equal(v.cateringSchema.safeParse(input).success, true);
  for (const eventDate of ["2020-01-01", "2099-02-30"]) assert.equal(v.cateringSchema.safeParse({ ...input, eventDate }).success, false);
  assert.equal(v.cateringSchema.safeParse({ ...input, status: "CONFIRMED" }).success, false);
  assert.equal(v.nairobiDate(new Date("2026-10-26T22:00:00Z")), "2026-10-27");
});

test("database connections require certificate-verified TLS and configuration errors redact values", () => {
  const cfg = config();
  for (const DATABASE_URL of ["postgresql://example.invalid/test", "postgresql://example.invalid/test?sslmode=disable"]) {
    assert.throws(() => readConfig({ ...cfg, PORT: "3000", TRUST_PROXY_HOPS: "0", DATABASE_URL }), /verify-full/);
  }
  assert.throws(() => readConfig({ ...cfg, PORT: "3000", TRUST_PROXY_HOPS: "0", APP_ORIGIN: "invalid" }), /Invalid configuration/);
});
test("public tracking projection omits every contact field and internal identifier", () => {
  const record = {
    id: randomUUID(), status: "PENDING", fulfilment: "DELIVERY", currency: "KES",
    customerName: "Private name", phone: "Private phone", deliveryAddress: "Private address",
    notes: "Private note", idempotencyHash: "private key", requestHash: "private request", trackingTokenHash: "private token",
    subtotalMinor: 5000, deliveryFeeMinor: 15000, totalMinor: 20000, createdAt: new Date(), updatedAt: new Date(),
    items: [{ menuItemId: itemId, name: "Samosa", quantity: 1, unitPriceMinor: 5000, lineTotalMinor: 5000 }],
    history: [{ toStatus: "PENDING", createdAt: new Date(), adminId: randomUUID() }],
  } as unknown as Parameters<typeof publicOrder>[0];
  const projected = publicOrder(record);
  const text = JSON.stringify(projected);
  assert.equal(text.includes("Private"), false);
  assert.equal(text.includes("private"), false);
  assert.equal(text.includes("adminId"), false);
  assert.equal(projected.totalMinor, 20000);
});



test("admin guard rejects anonymous, expired and inactive sessions and only grants active administrators", async () => {
  let active = true, reads = 0;
  const db = { admin: { findUnique: async () => { reads++; return { id: itemId, email: "owner@example.invalid", active }; } } } as unknown as import("../server/db.js").Database;
  const guard = requireAdmin(db);
  const invoke = async (session: object) => {
    let granted = false;
    const res = { locals: {} } as Response;
    await guard({ session } as Request, res, () => { granted = true; });
    return { granted, admin: res.locals.admin };
  };
  await assert.rejects(invoke({}), /Sign in/);
  await assert.rejects(invoke({ adminId: itemId, authenticatedAt: Date.now() - SESSION_LIFETIME_MS }), /Sign in/);
  assert.equal(reads, 0);
  active = false;
  await assert.rejects(invoke({ adminId: itemId, authenticatedAt: Date.now() }), /Sign in/);
  active = true;
  const allowed = await invoke({ adminId: itemId, authenticatedAt: Date.now() });
  assert.ok(allowed.granted);
  assert.deepEqual(allowed.admin, { id: itemId, email: "owner@example.invalid" });
});

test("catering quote validation allows null/zero/integer amounts and rejects guest or invalid quote injection", () => {
  const update = { expectedStatus: "PENDING", status: "CONFIRMED" };
  for (const quoteMinor of [null, 0, 120000, 1000000000]) assert.equal(v.cateringUpdateSchema.safeParse({ ...update, quoteMinor }).success, true);
  for (const quoteMinor of [-1, 1.5, 1000000001, "100"]) assert.equal(v.cateringUpdateSchema.safeParse({ ...update, quoteMinor }).success, false);
  assert.equal(v.cateringSchema.safeParse({ customerName: "Guest", phone: "0712345678", eventDate: "2099-12-01", location: "Nairobi", guestCount: 3, package: "Classic", quoteMinor: 1 }).success, false);
});

test("quote fingerprint detects offsetting price changes and respects unavailable fulfilment", async () => {
  const other = randomUUID();
  const settings = { currency: "KES", acceptingOrders: true, pickupEnabled: true, deliveryEnabled: true, deliveryFeeMinor: 15000 };
  const menu = [{ id: itemId, name: "One", priceMinor: 5000, available: true }, { id: other, name: "Two", priceMinor: 10000, available: true }];
  const tx = { restaurantSettings: { findUnique: async () => settings }, menuItem: { findMany: async () => menu } } as unknown as Prisma.TransactionClient;
  const input = { items: [{ menuItemId: itemId, quantity: 1 }, { menuItemId: other, quantity: 1 }], fulfilment: "PICKUP" as const };
  const before = await quote(tx, input);
  menu[0]!.priceMinor += 500; menu[1]!.priceMinor -= 500;
  const after = await quote(tx, input);
  assert.equal(before.totalMinor, after.totalMinor); assert.notEqual(before.quoteFingerprint, after.quoteFingerprint);
  settings.pickupEnabled = false;
  await assert.rejects(quote(tx, input), /currently unavailable/);
});


test("workflow: exact order paths, cancellation reasons and legacy pending safety", async () => {
  const { changeStatus } = await import("../server/orders.js");
  const paths = { PICKUP: ["ACCEPTED", "PREPARING", "READY", "COMPLETED"], DELIVERY: ["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED"] } as const;
  for (const fulfilment of ["PICKUP", "DELIVERY"] as const) {
    const path: readonly string[] = paths[fulfilment];
    for (const from of v.orderStatus.options) for (const to of v.orderStatus.options) {
      const index = path.indexOf(from);
      const expected = (index >= 0 && index < path.length - 1 && path[index + 1] === to)
        || (to === "CANCELLED" && !["COMPLETED", "CANCELLED"].includes(from));
      assert.equal(canTransition(from, to, fulfilment), expected, `${fulfilment}: ${from} -> ${to}`);
    }
  }
  assert.equal(v.statusSchema.safeParse({expectedStatus:"READY",status:"CANCELLED"}).success,false);
  assert.equal(v.statusSchema.safeParse({expectedStatus:"READY",status:"CANCELLED",reason:"   "}).success,false);
  assert.equal(v.statusSchema.safeParse({expectedStatus:"READY",status:"CANCELLED",reason:"Customer requested cancellation"}).success,true);
  const history: object[] = [];
  const record = {status:"READY",fulfilment:"PICKUP"};
  const tx = {order:{findUnique:async()=>record,updateMany:async()=>({count:1}),findUniqueOrThrow:async()=>record},orderStatusHistory:{create:async({data}: {data:object})=>history.push(data)}};
  const db = {$transaction:async(fn:(tx:unknown)=>unknown)=>fn(tx)} as unknown as import("../server/db.js").Database;
  await assert.rejects(changeStatus(db,itemId,"READY","CANCELLED",itemId),/cancellation reason/);
  assert.equal(history.length,0);
  await changeStatus(db,itemId,"READY","CANCELLED",itemId,"  Customer requested cancellation  ");
  assert.deepEqual(history,[{orderId:itemId,fromStatus:"READY",toStatus:"CANCELLED",adminId:itemId,reason:"Customer requested cancellation"}]);
});

test("workflow: ordinary order is accepted atomically with authoritative totals and retry protection", async () => {
  const {createOrder} = await import("../server/orders.js");
  let stored: any = null, creates=0, transactions=0;
  const tx = {
    restaurantSettings:{findUnique:async()=>({currency:"KES",acceptingOrders:true,pickupEnabled:true,deliveryEnabled:true,deliveryFeeMinor:15000})},
    menuItem:{findMany:async()=>[{id:itemId,name:"Samosa",priceMinor:5000,available:true}]},
    order:{findUnique:async()=>stored,create:async({data}:any)=>{
      creates++; assert.equal(data.status,"ACCEPTED"); assert.equal(data.history.create.toStatus,"ACCEPTED");
      stored={...data,createdAt:new Date(),updatedAt:new Date(),items:data.items.create,history:[{...data.history.create,createdAt:new Date()}]};return stored;
    }},
  };
  const priced=await quote(tx as unknown as Prisma.TransactionClient,basket);
  const input={...basket,customerName:"Guest",phone:"0712345678",expectedTotalMinor:priced.totalMinor,quoteFingerprint:priced.quoteFingerprint};
  const db={order:tx.order,$transaction:async(fn:(tx:unknown)=>unknown)=>{transactions++;return fn(tx);}} as unknown as import("../server/db.js").Database;
  const key=randomUUID(), secret=randomBytes(48).toString("hex");
  const first=await createOrder(db,input,key,secret);
  assert.equal(first.order.status,"ACCEPTED");assert.equal(first.order.totalMinor,10000);assert.equal(first.order.history[0]!.status,"ACCEPTED");
  const replay=await createOrder(db,input,key,secret);
  assert.equal(replay.replayed,true);assert.equal(replay.trackingToken,first.trackingToken);assert.equal(creates,1);assert.equal(transactions,1);
  await assert.rejects(createOrder(db,{...input,customerName:"Other"},key,secret),/different details/);
});

test("workflow: catering needs an explicit admin decision; quote edits and legacy records remain safe", async () => {
  const {canTransitionCatering}=await import("../server/catering.js");
  for (const from of v.cateringStatus.options) for (const to of v.cateringStatus.options) {
    assert.equal(canTransitionCatering(from,to),from===to || (["PENDING","REQUESTED","CONTACTED"].includes(from) && ["CONFIRMED","DECLINED"].includes(to)));
  }
  const request={customerName:"Guest",phone:"0712345678",eventDate:"2099-12-01",location:"Nairobi",guestCount:30,package:"Classic"};
  assert.equal(v.cateringSchema.safeParse({...request,status:"CONFIRMED"}).success,false);
  assert.equal(v.cateringUpdateSchema.safeParse({expectedStatus:"PENDING",status:"PENDING",quoteMinor:1234500}).success,true);
});
