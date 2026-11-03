import "dotenv/config";
import { readConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { createApp } from "./app.js";

async function main() {
  let config: ReturnType<typeof readConfig>;
  try { config = readConfig(); }
  catch (error) {
    console.error("Ordering cannot start yet. Edit the ignored .env in this project: set your hosted DATABASE_URL and keep the generated SESSION_SECRET/TRACKING_SECRET. Do not use .env.example as the live configuration.");
    throw error;
  }
  const db = createDatabase(config.DATABASE_URL);
  let runtime: Awaited<ReturnType<typeof createApp>>;
  try {
    await db.$connect();
    await db.$queryRaw`SELECT 1`;
    runtime = await createApp(db, config);
  } catch (error) {
    await db.$disconnect();
    throw error;
  }
  const server = runtime.app.listen(config.PORT, config.HOST, () => {
    console.log("Restaurant server listening at " + config.APP_ORIGIN);
  });
  const prune = setInterval(() => {
    db.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => console.error("Rate limit cleanup failed"));
  }, 15 * 60_000);
  prune.unref();
  let stopping = false;
  const shutdown = (exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    clearInterval(prune);
    server.close(() => {
      void runtime.close().then(() => db.$disconnect())
        .then(() => process.exit(exitCode), () => process.exit(1));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  server.on("error", () => { console.error("Server could not listen on the configured host/port."); shutdown(1); });
  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());
}
main().catch(error => {
  console.error(error instanceof Error && error.message.startsWith("Invalid configuration:") ? error.message : "Server failed to start. Check hosted database access and configuration.");
  process.exitCode = 1;
});
