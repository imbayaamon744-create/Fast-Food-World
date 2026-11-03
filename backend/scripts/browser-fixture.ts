// Test-only static host. Playwright intercepts API requests; no database is started.
import { randomBytes } from "node:crypto";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import type { Database } from "../server/db.js";
const config = readConfig({
  NODE_ENV: "test", APP_ORIGIN: "http://127.0.0.1:4173",
  DATABASE_URL: "postgresql://example.invalid/browser-tests?sslmode=verify-full",
  SESSION_SECRET: randomBytes(48).toString("hex"), TRACKING_SECRET: randomBytes(48).toString("hex"),
});
const db = { $queryRaw: async () => [{ hits: 1, expiresAt: new Date(Date.now() + 60000) }] } as unknown as Database;
const { app, close } = await createApp(db, config);
const server = app.listen(4173, "127.0.0.1", () => console.log("Browser fixture ready; API responses are intercepted by tests."));
const stop = () => server.close(() => { void close().then(() => process.exit(0)); });
process.on("SIGTERM", stop); process.on("SIGINT", stop);
