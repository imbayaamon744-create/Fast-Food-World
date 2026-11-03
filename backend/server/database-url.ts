import { z } from "zod";

export const databaseUrl = z.string().refine(value => {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol) &&
      Boolean(url.hostname) && !value.includes("CHANGE_ME") &&
      ["verify-full", "require"].includes(url.searchParams.get("sslmode") ?? "");
  } catch { return false; }
}, "Use a hosted PostgreSQL URL with sslmode=require or verify-full and no placeholders");
