import { execSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const PORT = process.env.PORT || "3000";
const windows = process.platform === "win32";
const host = process.env.HOST || (windows ? "127.0.0.1" : "0.0.0.0");
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

function listeningPids(port) {
  if (!windows) return [];
  let out = "";
  try {
    out = execSync("netstat -ano", { encoding: "utf8" });
  } catch {
    return [];
  }
  const pids = new Set();
  const needle = `:${port}`;
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes("LISTENING") || !line.includes(needle)) continue;
    const parts = line.trim().split(/\s+/);
    const local = parts[1] ?? "";
    if (!local.endsWith(needle) && !local.includes(`[::]:${port}`)) continue;
    const pid = parts.at(-1);
    if (pid && pid !== "0" && pid !== String(process.pid)) pids.add(pid);
  }
  return [...pids];
}

function freePort(port) {
  for (const pid of listeningPids(port)) {
    try {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
      console.log(`已结束占用 ${port} 端口的进程 PID ${pid}`);
    } catch {
      // already gone
    }
  }
}

if (windows) freePort(PORT);

const child = spawn(
  process.execPath,
  [nextBin, "dev", "--turbopack", "--hostname", host, "--port", String(PORT)],
  { stdio: "inherit", env: process.env, windowsHide: false },
);

function stop() {
  if (!child.pid || child.killed) return;
  try {
    if (windows) execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "ignore" });
    else child.kill("SIGTERM");
  } catch {
    // already gone
  }
}

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
child.on("exit", (code) => process.exit(code ?? 0));

console.log(`打开 http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${PORT}`);
