import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] === "start" ? "start" : "dev";
const devVars = {};
try {
  for (const rawLine of readFileSync(path.join(root, ".dev.vars"), "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    devVars[key] = value;
  }
} catch {
  // PREPARAR_SERVIDOR.bat creates this file before the application starts.
}
const env = {
  ...devVars,
  ...process.env,
  WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || ".wrangler/wrangler.log",
};
const host = env.HOST || (env.LOCAL_AUTH_BYPASS === "true" ? "127.0.0.1" : "0.0.0.0");
const relay = spawn(process.execPath, [path.join(root, "tools", "local-smtp-relay.mjs")], {
  cwd: root,
  env,
  stdio: "inherit",
});
const appArgs = mode === "start"
  ? [path.join(root, "node_modules", "vite", "bin", "vite.js"), "preview", "--host", host, "--port", env.PORT || "30001"]
  : [path.join(root, "node_modules", "vinext", "dist", "cli.js"), "dev", "--host", host, "--port", env.PORT || "30001"];
const app = spawn(process.execPath, appArgs, {
  cwd: root,
  env,
  stdio: "inherit",
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  relay.kill();
  app.kill();
  process.exitCode = code;
}

app.on("exit", code => stop(code ?? 0));
app.on("error", () => stop(1));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
