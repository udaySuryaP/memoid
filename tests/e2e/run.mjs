import { spawn, spawnSync } from "node:child_process";
import { cp } from "node:fs/promises";

await cp("apps/web/.next/static", "apps/web/.next/standalone/apps/web/.next/static", {
  recursive: true,
});

if (process.env.STAGE10D_E2E === "1") {
  const seeded = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "tests/e2e/seed-stage10d.ts"],
    { env: process.env, stdio: "inherit" },
  );
  if (seeded.status !== 0) process.exit(seeded.status ?? 1);
}

const server = spawn(process.execPath, ["apps/web/.next/standalone/apps/web/server.js"], {
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: "3000" },
  stdio: "inherit",
});

async function waitForServer() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:3000/foundation");
      if (response.ok) return;
    } catch {
      // The bounded readiness loop retries until the production server is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the foundation specimen server");
}

let exitCode;
try {
  await waitForServer();
  const args = ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)];
  const runner = spawn(process.execPath, args, {
    stdio: "inherit",
  });
  exitCode = await new Promise((resolve) => runner.once("exit", (code) => resolve(code ?? 1)));
} finally {
  server.kill();
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

process.exit(exitCode);
