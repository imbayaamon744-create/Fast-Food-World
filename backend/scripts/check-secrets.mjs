import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = args => execFileSync("git", args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean);
const tracked = new Set(git(["ls-files", "-z"]));
const files = new Set([...tracked, ...git(["ls-files", "--others", "--exclude-standard", "-z"])]);
const findings = new Set();
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /(?:sk-[a-zA-Z0-9_-]{24,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{20,})/,
  /postgres(?:ql)?:\/\/[^\s/:]+:([^\s@]+)@/,
  /["']?(?:SESSION_SECRET|TRACKING_SECRET|API_KEY|ACCESS_TOKEN|CLIENT_SECRET)["']?\s*[:=]\s*["']([^"'\r\n]{8,})["']/,
  /^(?:SESSION_SECRET|TRACKING_SECRET|API_KEY|ACCESS_TOKEN|CLIENT_SECRET)\s*=\s*([^\r\n]+)/m,
];
for (const file of files) {
  const secretFile = /(^|\/)(?:\.envrc|\.env(?:\..*)?|[^/]+\.env(?:\..*)?)$/.test(file) || /\.(?:key|pem|p12|pfx)$/.test(file);
  if (tracked.has(file) && secretFile && !file.endsWith(".env.example")) findings.add(file + ": tracked secret-bearing file");
  for (const source of tracked.has(file) ? ["index", "working tree"] : ["working tree"]) {
    let content;
    try {
      content = source === "index"
        ? execFileSync("git", ["show", ":" + file], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
        : readFileSync(file);
    } catch { continue; }
    if (content.includes(0)) continue;
    for (const pattern of patterns) {
      const regex = new RegExp(pattern.source, pattern.multiline ? "gm" : "g");
      for (const match of content.toString("utf8").matchAll(regex)) {
        const value = match[1] ?? match[0];
        if (/CHANGE_ME|process\.env|randomBytes|randomUUID/.test(value)) continue;
        findings.add(file + " (" + source + "): possible secret; inspect locally");
      }
    }
  }
}
if (findings.size) {
  console.error([...findings].join("\n")); process.exitCode = 1;
} else {
  console.log("No secret-file or common credential-pattern findings in Git's index, tracked working files and non-ignored new files.");
  console.log("Pattern checks are not a guarantee; review staged diffs before any future commit.");
}
