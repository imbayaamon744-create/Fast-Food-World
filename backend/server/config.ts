import { z } from "zod";
import { databaseUrl } from "./database-url.js";

const secret = z.string().min(64).refine(v => !v.includes("CHANGE_ME"), "Generate a fresh random secret");
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url().refine(v => {
    let url: URL; try { url = new URL(v); } catch { return false; }
    return ["http:", "https:"].includes(url.protocol) && url.origin === v;
  }, "Use an exact HTTP(S) origin without a trailing slash"),
  DATABASE_URL: databaseUrl,
  SESSION_SECRET: secret,
  TRACKING_SECRET: secret,
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
}).superRefine((v, ctx) => {
  if (v.SESSION_SECRET === v.TRACKING_SECRET) ctx.addIssue({ code: "custom", path: ["TRACKING_SECRET"], message: "Secrets must be different" });
  if (v.NODE_ENV === "production" && !v.APP_ORIGIN.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["APP_ORIGIN"], message: "Production requires HTTPS" });
});
export type Config = z.infer<typeof envSchema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    // Do not print environment values (including database credentials).
    throw new Error("Invalid configuration: " + result.error.issues.map(i => i.path.join(".") + ": " + i.message).join("; "));
  }
  return result.data;
}


