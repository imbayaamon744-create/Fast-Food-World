import path from "node:path";
import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import helmet from "helmet";
import { ZodError } from "zod";
import { Prisma } from "./generated/prisma/client.js";
import type { Database } from "./db.js";
import { databaseSchema } from "./db.js";
import type { Config } from "./config.js";
import { HttpError } from "./errors.js";
import * as v from "./validation.js";
import { hash, hashPassword, verifyPassword, requireAdmin, requireCsrf, rateLimit, token, SESSION_LIFETIME_MS } from "./security.js";
import { canTransitionCatering } from "./catering.js";
import { quote, createOrder, trackOrder, changeStatus, recoverOrder } from "./orders.js";

export async function createApp(db: Database, config: Config, root = path.resolve(process.cwd(), "frontend")) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.use((_req, res, next) => { res.locals.requestId = randomUUID(); res.setHeader("X-Request-Id", res.locals.requestId); next(); });
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
      imgSrc: ["'self'", "https:"], frameSrc: ["https://www.google.com"],
      connectSrc: ["'self'"], formAction: ["'self'"], objectSrc: ["'none'"],
      upgradeInsecureRequests: config.NODE_ENV === "production" ? [] : null,
    } },
    referrerPolicy: { policy: "no-referrer" },
    strictTransportSecurity: config.NODE_ENV === "production" ? undefined : false,
  }));
  app.get("/healthz", (_req, res) => { res.json({ status: "ok" }); });
  app.use("/api", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  app.get("/api/health", async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "connected" });
  });
  app.use("/api", rateLimit(db, config, "api", 300, 60_000));
  app.use("/api", express.json({ limit: "32kb" }));

  const schemaName = databaseSchema(config.DATABASE_URL);
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 });
  pool.on("error", () => console.error("Session database pool error"));
  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    pool, schemaName, tableName: "sessions", createTableIfMissing: false,
    pruneSessionInterval: 15 * 60, errorLog: () => console.error("Session store error"),
  });
  const cookieName = config.NODE_ENV === "production" ? "__Host-restaurant.sid" : "restaurant.sid";
  app.use("/api", session({
    name: cookieName, store, secret: config.SESSION_SECRET, resave: false, saveUninitialized: false, rolling: false,
    cookie: { httpOnly: true, secure: config.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 30 * 60_000 },
  }));
  app.get("/api/csrf", (req, res) => {
    req.session.csrfToken ??= token();
    res.json({ csrfToken: req.session.csrfToken });
  });
  app.use("/api", requireCsrf(config));

  app.get("/api/menu", async (req, res) => {
    const query = v.menuQuery.parse(req.query);
    const items = await db.menuItem.findMany({
      where: {
        ...(query.category ? { category: { slug: query.category } } : {}),
        ...(query.available ? { available: query.available === "true" } : {}),
        ...(query.search ? { OR: [
          { name: { contains: query.search, mode: "insensitive" as const } },
          { description: { contains: query.search, mode: "insensitive" as const } },
        ] } : {}),
      },
      include: { category: true }, orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    });
    res.json({ currency: "KES", items });
  });
  app.get("/api/categories", async (_req, res) => {
    res.json({ categories: await db.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }) });
  });
  app.get("/api/settings", async (_req, res) => {
    const settings = await db.restaurantSettings.findUnique({ where: { id: "restaurant" } });
    if (!settings) throw new HttpError(503, "NOT_CONFIGURED", "Restaurant setup is incomplete");
    res.json({ settings });
  });
  app.post("/api/orders/quote", rateLimit(db, config, "quote", 60, 60_000), async (req, res) => {
    const input = v.basketSchema.parse(req.body);
    const result = await db.$transaction(tx => quote(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    res.json({ quote: result });
  });
  app.post("/api/orders", rateLimit(db, config, "orders", 20, 15 * 60_000), async (req, res) => {
    const input = v.orderSchema.parse(req.body);
    const key = v.id.parse(req.get("idempotency-key"));
    const result = await createOrder(db, input, key, config.TRACKING_SECRET);
    res.status(result.replayed ? 200 : 201).json(result);
  });
  app.post("/api/orders/recover", rateLimit(db, config, "recovery", 30, 15 * 60_000), async (req, res) => {
    v.emptySchema.parse(req.body);
    res.json(await recoverOrder(db, v.id.parse(req.get("idempotency-key")), config.TRACKING_SECRET));
  });
  app.post("/api/orders/track", rateLimit(db, config, "tracking", 60, 15 * 60_000), async (req, res) => {
    const { token: privateToken } = v.trackingSchema.parse(req.body);
    res.json({ order: await trackOrder(db, privateToken) });
  });
  app.post("/api/catering", rateLimit(db, config, "catering", 10, 60 * 60_000), async (req, res) => {
    const input = v.cateringSchema.parse(req.body);
    const idempotencyHash = hash(v.id.parse(req.get("idempotency-key")));
    const requestHash = hash(JSON.stringify(input));
    let request = await db.cateringRequest.findUnique({ where: { idempotencyHash } });
    let replayed = Boolean(request);
    if (!request) {
      try {
        request = await db.cateringRequest.create({ data: { ...input, eventDate: new Date(input.eventDate + "T00:00:00.000Z"), idempotencyHash, requestHash, status: "PENDING" } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
        request = await db.cateringRequest.findUniqueOrThrow({ where: { idempotencyHash } });
        replayed = true;
      }
    }
    if (request.requestHash !== requestHash) throw new HttpError(409, "IDEMPOTENCY_CONFLICT", "This submission key was already used for different details");
    res.status(replayed ? 200 : 201).json({
      request: { id: request.id, status: request.status, createdAt: request.createdAt },
      message: "Your catering request has been received. Submitting a catering request does not confirm a booking. It stays pending until an administrator explicitly confirms or declines it after discussing availability, menu and price.",
      replayed,
    });
  });

  const dummyHash = await hashPassword(token());
  app.post("/api/admin/login",
    rateLimit(db, config, "login-ip", 10, 15 * 60_000),
    rateLimit(db, config, "login-account", 10, 15 * 60_000, true),
    async (req, res) => {
      const input = v.loginSchema.parse(req.body);
      const admin = await db.admin.findUnique({ where: { email: input.email } });
      const valid = await verifyPassword(admin?.passwordHash ?? dummyHash, input.password);
      if (!valid || !admin?.active) throw new HttpError(401, "INVALID_LOGIN", "Email or password is incorrect");
      await new Promise<void>((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
      req.session.adminId = admin.id;
      req.session.authenticatedAt = Date.now();
      req.session.csrfToken = token();
      req.session.cookie.maxAge = SESSION_LIFETIME_MS;
      await new Promise<void>((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
      res.json({ admin: { id: admin.id, email: admin.email }, csrfToken: req.session.csrfToken });
    });
  // Logout also permits clearing an expired or disabled administrator session.
  app.post("/api/admin/logout", async (req, res) => {
    await new Promise<void>((resolve, reject) => req.session.destroy(err => err ? reject(err) : resolve()));
    res.clearCookie(cookieName, { path: "/", httpOnly: true, sameSite: "strict", secure: config.NODE_ENV === "production" });
    res.status(204).end();
  });
  app.use("/api/admin", requireAdmin(db));
  app.get("/api/admin/session", (_req, res) => { res.json({ admin: res.locals.admin }); });
  app.get("/api/admin/orders/summary", async (_req, res) => {
    const groups = await db.order.groupBy({ by: ["status"], _count: { _all: true }, _sum: { totalMinor: true } });
    res.json({ groups: groups.map(group => ({ status: group.status, count: group._count._all, totalMinor: group._sum.totalMinor ?? 0 })) });
  });
  app.get("/api/admin/categories", async (_req, res) => {
    res.json({ categories: await db.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }) });
  });
  app.get("/api/admin/orders", async (req, res) => {
    const { page, pageSize, status } = v.orderListSchema.parse(req.query);
    const where = status ? { status } : {};
    const [orders, total] = await db.$transaction([
      db.order.findMany({ where, include: { items: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      db.order.count({ where }),
    ]);
    res.json({ orders: orders.map(({ idempotencyHash: _key, requestHash: _request, trackingTokenHash: _tracking, ...order }) => order), page, pageSize, total });
  });
  app.get("/api/admin/orders/:id", async (req, res) => {
    const order = await db.order.findUnique({ where: { id: v.id.parse(req.params.id) }, include: { items: true, history: { orderBy: { createdAt: "asc" } } } });
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
    const { idempotencyHash: _key, requestHash: _request, trackingTokenHash: _tracking, ...details } = order;
    res.json({ order: details });
  });
  app.patch("/api/admin/orders/:id/status", async (req, res) => {
    const input = v.statusSchema.parse(req.body);
    const order = await changeStatus(db, v.id.parse(req.params.id), input.expectedStatus, input.status, res.locals.admin.id, input.reason);
    const { idempotencyHash: _key, requestHash: _request, trackingTokenHash: _tracking, ...details } = order;
    res.json({ order: details });
  });
  app.get("/api/admin/menu", async (_req, res) => {
    res.json({ items: await db.menuItem.findMany({ include: { category: true }, orderBy: { name: "asc" } }) });
  });
  app.post("/api/admin/menu", async (req, res) => {
    res.status(201).json({ item: await db.menuItem.create({ data: v.menuCreateSchema.parse(req.body) }) });
  });
  app.patch("/api/admin/menu/:id", async (req, res) => {
    res.json({ item: await db.menuItem.update({ where: { id: v.id.parse(req.params.id) }, data: v.menuUpdateSchema.parse(req.body) }) });
  });
  app.post("/api/admin/categories", async (req, res) => {
    res.status(201).json({ category: await db.category.create({ data: v.categorySchema.parse(req.body) }) });
  });
  app.patch("/api/admin/categories/:id", async (req, res) => {
    res.json({ category: await db.category.update({ where: { id: v.id.parse(req.params.id) }, data: v.categoryUpdateSchema.parse(req.body) }) });
  });
  app.patch("/api/admin/settings", async (req, res) => {
    res.json({ settings: await db.restaurantSettings.update({ where: { id: "restaurant" }, data: v.settingsSchema.parse(req.body) }) });
  });
  app.get("/api/admin/catering", async (req, res) => {
    const { page, pageSize, status } = v.cateringListSchema.parse(req.query);
    const where = status ? { status } : {};
    const [requests, total] = await db.$transaction([
      db.cateringRequest.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      db.cateringRequest.count({ where }),
    ]);
    res.json({ requests: requests.map(({ idempotencyHash: _key, requestHash: _request, ...item }) => item), page, pageSize, total });
  });
  app.patch("/api/admin/catering/:id", async (req, res) => {
    const id = v.id.parse(req.params.id);
    const { status, expectedStatus, adminNotes, quoteMinor } = v.cateringUpdateSchema.parse(req.body);
    const allowed = canTransitionCatering(expectedStatus, status);
    if (!allowed) throw new HttpError(409, "INVALID_TRANSITION", "This request status change is not allowed");
    const result = await db.cateringRequest.updateMany({ where: { id, status: expectedStatus }, data: { status, adminNotes, quoteMinor } });
    if (result.count !== 1) throw new HttpError(409, "STALE_REQUEST", "Request changed or does not exist; refresh and try again");
    res.json({ request: { id, status, adminNotes, quoteMinor } });
  });

  // Serve an explicit allowlist, never the repository root (which contains .env and source).
  const publicFiles = ["index.html", "story.html", "contact.html", "menu.html", "menu.js", "order.html", "catering.html", "app.css", "order.css", "catering.css", "order.js", "catering.js", "order-core.js", "api-client.js", "track.html", "track.js", "shared.js", "landing.js", "admin.html", "admin.js", "admin.css", "local-help.js"];
  app.get("/", (_req, res) => { res.sendFile(path.join(root, "index.html")); });
  for (const file of publicFiles) app.get("/" + file, (_req, res) => {
    if (file.startsWith("admin.")) res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(root, file));
  });
  app.use("/images", express.static(path.join(root, "images"), { dotfiles: "deny", index: false, redirect: false }));
  app.use((_req, _res, next) => next(new HttpError(404, "NOT_FOUND", "Resource not found")));
  const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    if (res.headersSent) return _next(err);
    if (err instanceof ZodError) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Check the submitted fields", fields: err.issues.map(i => ({ path: i.path.join("."), message: i.message })) } }); return;
    }
    if (err instanceof HttpError) { res.status(err.status).json({ error: { code: err.code, message: err.message } }); return; }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      const errors: Record<string, [number, string, string]> = {
        P2002: [409, "CONFLICT", "A record with this value already exists"],
        P2003: [400, "INVALID_REFERENCE", "The referenced record does not exist"],
        P2025: [404, "NOT_FOUND", "Record not found"],
        P2034: [409, "CONCURRENT_UPDATE", "Data changed; retry your request"],
      };
      const mapped = errors[err.code];
      if (mapped) { res.status(mapped[0]).json({ error: { code: mapped[1], message: mapped[2] } }); return; }
    }
    if (typeof err === "object" && err !== null && "type" in err) {
      if (err.type === "entity.parse.failed") { res.status(400).json({ error: { code: "INVALID_JSON", message: "Send valid JSON" } }); return; }
      if (err.type === "entity.too.large") { res.status(413).json({ error: { code: "BODY_TOO_LARGE", message: "Request is too large" } }); return; }
    }
    // Log only a correlation ID and error class; no submitted bodies, URLs, tokens or credentials.
    console.error("Request failed", { requestId: res.locals.requestId, error: err instanceof Error ? err.name : "UnknownError" });
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed", requestId: res.locals.requestId } });
  };
  app.use(errorHandler);
  return { app, close: async () => { store.close(); await pool.end(); } };
}
