import { spawnSync } from "node:child_process";
const files = ["api-client.js", "order-core.js", "shared.js", "landing.js", "menu.js", "order.js", "track.js", "admin.js", "catering.js", "local-help.js"];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", `frontend/${file}`], { stdio: "inherit", windowsHide: true });
  if (result.error || result.status !== 0) process.exit(1);
}
console.log("Frontend JavaScript syntax checked (10 modules; no browser or tests run).");
