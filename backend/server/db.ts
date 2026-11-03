import { databaseUrl } from "./database-url.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export function databaseSchema(connectionString: string) {
  if (!databaseUrl.safeParse(connectionString).success) throw new Error("Use a hosted PostgreSQL URL with sslmode=require or verify-full and no placeholders.");
  const schema = new URL(connectionString).searchParams.get("schema") ?? "public";
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema)) throw new Error("Invalid database schema name");
  return schema;
}
export function createDatabase(connectionString: string) {
  const schema = databaseSchema(connectionString);
  const url = new URL(connectionString);
  url.searchParams.set("options", (url.searchParams.get("options") ?? "") + " -c search_path=" + schema);
  return new PrismaClient({ adapter: new PrismaPg({
    connectionString: url.toString(), max: 10, connectionTimeoutMillis: 5000,
  }, { schema, onPoolError: () => console.error("Database pool error"), onConnectionError: () => console.error("Database connection error") }) });
}
export type Database = ReturnType<typeof createDatabase>;



