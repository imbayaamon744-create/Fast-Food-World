import "dotenv/config";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";

async function run(args: string[], env: NodeJS.ProcessEnv, showOutput = true) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: showOutput ? "inherit" : "pipe", windowsHide: true });
    // Migration output may identify the hosted database. Never relay it into test logs.
    if (!showOutput) { child.stdout?.resume(); child.stderr?.resume(); }
    child.on("error", () => reject(new Error("Could not start a test subprocess")));
    child.on("exit", code => code === 0 ? resolve() : reject(new Error("Test subprocess failed (" + code + ")")));
  });
}
async function main() {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw || raw.includes("CHANGE_ME")) throw new Error("Hosted integration tests NOT RUN: set TEST_DATABASE_URL in .env to a separate empty hosted test database.");
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.searchParams.get("sslmode") !== "verify-full") {
    throw new Error("TEST_DATABASE_URL must use PostgreSQL with sslmode=verify-full.");
  }
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("CHANGE_ME")) {
    const main = new URL(process.env.DATABASE_URL);
    if (main.hostname.toLowerCase() === url.hostname.toLowerCase() && (main.port || "5432") === (url.port || "5432") && main.pathname === url.pathname) {
      throw new Error("Use a different database or hosted branch for TEST_DATABASE_URL, not your restaurant database.");
    }
  }
  // Only this random schema is created and dropped. No reset, truncate or shared-schema deletion.
  const schema = "restaurant_test_" + randomBytes(8).toString("hex");
  if (!/^restaurant_test_[a-f0-9]{16}$/.test(schema)) throw new Error("Invalid test schema");
  const pool = new pg.Pool({ connectionString: raw, max: 1, connectionTimeoutMillis: 10000 });
  let created = false;
  try {
    await pool.query('CREATE SCHEMA "' + schema + '"');
    created = true;
    url.searchParams.set("schema", schema);
    const env = {
      ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test",
      APP_ORIGIN: "http://localhost:3000", TEST_SCHEMA: schema,
      SESSION_SECRET: randomBytes(48).toString("hex"), TRACKING_SECRET: randomBytes(48).toString("hex"),
    };
    await run(["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "backend/prisma.config.ts"], env, false);
    await run(["--import", "tsx", "--test", "--test-concurrency=1", "backend/tests/integration.test.ts"], env);
  } finally {
    try { if (created) await pool.query('DROP SCHEMA "' + schema + '" CASCADE');
    } finally { await pool.end(); }
  }
}
main().catch(error => {
  const message = error instanceof Error ? error.message : "";
  console.error(/^(Hosted integration|TEST_DATABASE_URL|Use a different|Invalid test|Test subprocess|Could not start)/.test(message)
    ? message : "Hosted integration tests failed; check the test connection, TLS and schema permissions. No credentials were logged.");
  process.exitCode = 1;
});
