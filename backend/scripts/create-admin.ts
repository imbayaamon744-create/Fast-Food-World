import "dotenv/config";
import { emitKeypressEvents, type Key } from "node:readline";
import { createDatabase } from "../server/db.js";
import { hashPassword } from "../server/security.js";
import { email, password } from "../server/validation.js";

async function hiddenInput(prompt: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run this command in an interactive terminal; passwords are never accepted in command arguments.");
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (cancel: boolean) => {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(wasRaw ?? false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (cancel) reject(new Error("Cancelled.")); else resolve(value);
    };
    const onKey = (text: string, key: Key) => {
      if (key.ctrl && key.name === "c") return finish(true);
      if (key.name === "return" || key.name === "enter") return finish(false);
      if (key.name === "backspace") { value = Array.from(value).slice(0, -1).join(""); return; }
      if (!key.ctrl && !key.meta && text && !text.includes("\u001b")) value += text;
    };
    process.stdin.on("keypress", onKey);
  });
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--email") throw new Error("Usage: npm run admin:create -- --email owner@example.com");
  const address = email.safeParse(args[1]);
  if (!address.success) throw new Error("Enter a valid administrator email.");
  const url = process.env.DATABASE_URL;
  if (!url || url.includes("CHANGE_ME")) throw new Error("Set your hosted DATABASE_URL in .env first.");
  const secret = await hiddenInput("Password (12–128 characters, hidden): ");
  if (!password.safeParse(secret).success) throw new Error("Use a password with 12–128 characters.");
  if (secret !== await hiddenInput("Confirm password (hidden): ")) throw new Error("Passwords did not match.");
  const db = createDatabase(url);
  try {
    if (await db.admin.findUnique({ where: { email: address.data } })) throw new Error("An administrator with this email already exists; no account was changed.");
    await db.admin.create({ data: { email: address.data, passwordHash: await hashPassword(secret) } });
    console.log("Administrator created. There is no public registration endpoint.");
  } finally { await db.$disconnect(); }
}
main().catch(error => {
  const safe = error instanceof Error && !("code" in error) && !error.name.startsWith("Prisma");
  console.error(safe ? error.message : "Admin creation failed. Check migrations and hosted database access.");
  process.exitCode = 1;
});
