import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the nostr-docs web app.
 *
 * The tests drive the real app against a local in-memory nostr relay (started
 * as a webServer below), so they are fast and deterministic — no live relays.
 * The app is pointed at it via VITE_DEFAULT_RELAYS (honored in src/nostr/relayPool.ts).
 */
// Dedicated ports unlikely to collide with other dev servers/relays the user
// may already be running (reuseExistingServer would otherwise reuse a foreign
// app on a common port like 5173).
const RELAY_PORT = 7449;
const APP_PORT = 5181;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "node tests/e2e/relay-server.cjs",
      port: RELAY_PORT,
      reuseExistingServer: !process.env.CI,
      env: { RELAY_PORT: String(RELAY_PORT) },
    },
    {
      command: `npm run dev -- --port ${APP_PORT} --strictPort`,
      port: APP_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        VITE_DEFAULT_RELAYS: `ws://localhost:${RELAY_PORT}`,
      },
    },
  ],
});
