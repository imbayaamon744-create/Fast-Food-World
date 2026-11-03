import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import type { RequestHandler } from "express";
import type { Database } from "./db.js";
import type { Config } from "./config.js";
import { HttpError } from "./errors.js";

declare module "express-session" {
  interface SessionData { adminId?: string; authenticatedAt?: number; csrfToken?: string; }
}
export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export const trackingToken = (key: string, orderId: string, secret: string) =>
  createHmac("sha256", secret).update("order:" + orderId + ":" + key).digest("hex");
export const hashPassword = (value: string) => argon2.hash(value, {
  type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1,
});
export const verifyPassword = (encoded: string, value: string) => argon2.verify(encoded, value);

export const requireCsrf = (config: Config): RequestHandler => (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("origin") !== config.APP_ORIGIN) throw new HttpError(403, "ORIGIN_REJECTED", "Request origin is not allowed");
  const supplied = req.get("x-csrf-token") ?? "";
  const expected = req.session.csrfToken ?? "";
  if (!expected || !/^[a-f0-9]{64}$/.test(supplied) || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    throw new HttpError(403, "CSRF_REJECTED", "Refresh your session and try again");
  }
  if (!req.is("application/json")) throw new HttpError(415, "JSON_REQUIRED", "Send application/json");
  next();
};

export const requireAdmin = (db: Database): RequestHandler => async (req, res, next) => {
  if (!req.session.adminId || !req.session.authenticatedAt || Date.now() - req.session.authenticatedAt >= SESSION_LIFETIME_MS) {
    throw new HttpError(401, "UNAUTHENTICATED", "Sign in as an administrator");
  }
  const admin = await db.admin.findUnique({ where: { id: req.session.adminId }, select: { id: true, email: true, active: true } });
  if (!admin?.active) throw new HttpError(401, "UNAUTHENTICATED", "Sign in as an administrator");
  res.locals.admin = { id: admin.id, email: admin.email };
  next();
};

// Atomic, database-backed fixed windows: shared across server processes and restarts.
// Only keyed HMACs of IP/account identifiers are stored. No raw IP or email in buckets.
export function rateLimit(db: Database, config: Config, scope: string, max: number, windowMs: number, account = false): RequestHandler {
  return async (req, res, next) => {
    const identity = account ? String(req.body?.email ?? "").trim().toLowerCase() : (req.ip ?? "unknown");
    const key = createHmac("sha256", config.SESSION_SECRET).update(scope + ":" + identity).digest("hex");
    const rows = await db.$queryRaw<Array<{ hits: number; expiresAt: Date }>>`
      INSERT INTO "RateLimitBucket" ("key", "hits", "expiresAt")
      VALUES (${key}, 1, NOW() + ${windowMs} * INTERVAL '1 millisecond')
      ON CONFLICT ("key") DO UPDATE SET
        "hits" = CASE WHEN "RateLimitBucket"."expiresAt" <= NOW() THEN 1 ELSE "RateLimitBucket"."hits" + 1 END,
        "expiresAt" = CASE WHEN "RateLimitBucket"."expiresAt" <= NOW() THEN NOW() + ${windowMs} * INTERVAL '1 millisecond' ELSE "RateLimitBucket"."expiresAt" END
      RETURNING "hits", "expiresAt"
    `;
    const row = rows[0]!;
    if (row.hits > max) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000)));
      throw new HttpError(429, "RATE_LIMITED", "Too many requests; try again later");
    }
    next();
  };
}

