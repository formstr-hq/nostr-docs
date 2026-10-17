import { defineConfig, devices } from "@playwright/test";

/**
 * Config for the realtime + MCP integration demo (tests/e2e/realtime-mcp.spec.ts).
 *
 * Same local in-memory relay + Vite app as the base config, but with video
 * recording ON so the run is captured, and a longer timeout since it boots a real
 * MCP server over stdio mid-test.
 */
const RELAY_PORT = 7449;
const APP_PORT = 5181;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "realtime-mcp.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  outputDir: "test-results/realtime-mcp",
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    viewport: { width: 1280, height: 720 },
    video: { mode: "on", size: { width: 1280, height: 720 } },
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } },
    },
  ],
  webServer: [
    {
      command: "node tests/e2e/relay-server.cjs",
      port: RELAY_PORT,
      reuseExistingServer: false,
      env: { RELAY_PORT: String(RELAY_PORT) },
    },
    {
      command: `npm run dev -- --port ${APP_PORT} --strictPort`,
      port: APP_PORT,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        VITE_DEFAULT_RELAYS: `ws://localhost:${RELAY_PORT}`,
      },
    },
  ],
});
