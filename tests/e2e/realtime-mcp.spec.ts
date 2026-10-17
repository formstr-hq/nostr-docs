import { spawn, type ChildProcess } from "node:child_process";

import { test, expect, type Page } from "@playwright/test";
import { nip19 } from "nostr-tools";

import { decodeNKeys } from "../../src/utils/nkeys";
import { loginAsGuest, save, typeIntoEditor } from "./helpers";
import { editorSurface } from "./helpers";

/**
 * Realtime collaboration, end to end, across two clients:
 *
 *   left  — the real Pages app in Chromium (the human), sharing an open doc.
 *   right — the real @formstr/mcp server over stdio (the AI), driving the
 *           v2 collab tools against the SAME local relay.
 *
 * The MCP's `edit_page_collab` publishes a Yjs op (kind 22457); the human's
 * editor must reflect it live, with no reload. The whole run is video-recorded.
 */

const MCP_DIST = "/home/drogon/Dev/formstr/common-packages/packages/mcp/dist/index.js";
const RELAY = "ws://localhost:7449";

/** Minimal MCP client: newline-delimited JSON-RPC over the server's stdio. */
class McpStdio {
  private readonly proc: ChildProcess;
  private buf = "";
  private nextId = 1;
  private readonly pending = new Map<number, (msg: unknown) => void>();

  constructor() {
    this.proc = spawn("node", [MCP_DIST, "--allow-writes", "--relays", RELAY], {
      env: {
        ...process.env,
        FORMSTR_MCP_KEYSTORE: "file",
        FORMSTR_MCP_CONFIG_DIR: "/tmp/opencode/mcp-e2e",
        FORMSTR_MCP_PASSPHRASE: "e2e-keystore-pass",
        FORMSTR_MCP_NCRYPTSEC_PASSPHRASE: "e2e-ncryptsec-pass",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout!.setEncoding("utf8");
    this.proc.stdout!.on("data", (chunk: string) => {
      this.buf += chunk;
      let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        this.onLine(line);
      }
    });
    this.proc.stderr!.on("data", (d: Buffer) => process.stderr.write(`[mcp] ${d}`));
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let msg: { id?: number; result?: unknown; error?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof msg.id === "number" && this.pending.has(msg.id)) {
      this.pending.get(msg.id)!(msg);
      this.pending.delete(msg.id);
    }
  }

  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    this.proc.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 60_000);
      this.pending.set(id, (msg: any) => {
        clearTimeout(t);
        if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      });
    });
  }

  async init(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pages-realtime-e2e", version: "0" },
    });
    this.proc.stdin!.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
  }

  async call(name: string, args: Record<string, unknown>): Promise<any> {
    const result = await this.request("tools/call", { name, arguments: args });
    if (result?.isError) throw new Error(`tool ${name} failed: ${result.content?.[0]?.text}`);
    return result;
  }

  close(): void {
    this.proc.kill();
  }
}

/** A dark side panel on the app page that mirrors the MCP traffic into the video. */
async function installOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.createElement("div");
    el.id = "mcp-panel";
    el.setAttribute(
      "style",
      [
        "position:fixed",
        "top:0",
        "right:0",
        "width:470px",
        "height:100%",
        "background:rgba(8,12,22,0.95)",
        "color:#8fe3ff",
        "z-index:2147483647",
        "font:12px/1.6 ui-monospace,Menlo,Consolas,monospace",
        "padding:16px",
        "overflow:auto",
        "white-space:pre-wrap",
        "box-sizing:border-box",
        "border-left:2px solid #3b82f6",
        "box-shadow:-8px 0 24px rgba(0,0,0,.5)",
      ].join(";"),
    );
    el.textContent = "● MCP (the AI)  ←→  Pages (the human)\n────────────────────────────\n\n";
    document.body.appendChild(el);
  });
}

async function mcpLog(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const el = document.getElementById("mcp-panel");
    if (el) el.textContent += `${t}\n`;
  }, text);
  await page.waitForTimeout(300);
}

/** The owner's doc must be in the TipTap (collab-capable) editor, not preview. */
async function ensureVisualEditor(page: Page): Promise<void> {
  if ((await page.locator(".tiptap").count()) > 0) return;
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Visual editor" }).click();
  await expect(page.locator(".tiptap").first()).toBeVisible({ timeout: 15_000 });
}

test("the AI edits a shared Pages doc live, over the MCP", async ({ page }) => {
  test.setTimeout(120_000);

  // 1. Human: sign in, write a doc, publish it.
  await loginAsGuest(page);
  await typeIntoEditor(page, "# Realtime collab\n\nHuman wrote this paragraph.");
  await save(page);
  await expect(page.getByRole("heading", { name: "Realtime collab" })).toBeVisible({
    timeout: 20_000,
  });

  // 2. Human: share an open (anyone-with-the-link) editable link.
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Share Page" });
  await dialog.getByRole("switch", { name: "Can edit" }).click();
  await dialog.getByRole("switch", { name: "Anyone with the link can edit" }).click();
  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 20_000 });
  const shareUrl = page.url();

  // 3. Decode the share link into (address, viewKey) for the AI.
  const naddrMatch = shareUrl.match(/\/doc\/(naddr1[0-9a-z]+)/i)!;
  const decoded = nip19.decode(naddrMatch[1]);
  if (decoded.type !== "naddr") throw new Error("expected an naddr");
  const address = `33457:${decoded.data.pubkey}:${decoded.data.identifier}`;
  const viewKey = decodeNKeys(shareUrl.split("#")[1]).viewKey;

  await ensureVisualEditor(page);
  await expect(page.getByText(/Connecting/)).toBeHidden({ timeout: 20_000 });
  await installOverlay(page);
  await mcpLog(page, `doc:      ${address}`);
  await mcpLog(page, `viewKey:  ${viewKey.slice(0, 20)}…`);
  await mcpLog(page, "human has the doc open — starting the MCP…\n");

  // 4. AI: boot the real MCP server and drive the v2 collab tools.
  const mcp = new McpStdio();
  await mcp.init();
  await mcpLog(page, "MCP booted (stdio, --allow-writes, local relay).\n");

  await mcpLog(page, "→ get_page_roster { address, viewKey }");
  const roster = await mcp.call("get_page_roster", { address, viewKey });
  await mcpLog(page, `← mode = ${roster.structuredContent?.mode}`);

  await mcpLog(page, "→ open_page_collab { address, viewKey }");
  const opened = await mcp.call("open_page_collab", { address, viewKey });
  const sessionId = opened.structuredContent?.sessionId as string;
  await mcpLog(page, `← sessionId = ${sessionId}`);

  const aiText =
    "## ✍️ Written by the AI via MCP\n\n" +
    "This paragraph travelled as a Yjs op (kind 22457) over Nostr and merged into " +
    "the human's editor — no reload, no save button.";

  await mcpLog(page, "→ edit_page_collab { mode: append, confirm: true }");
  await mcp.call("edit_page_collab", { sessionId, content: aiText, confirm: true });
  await mcpLog(page, "← op published — merging into the open editor…");

  // 5. The human's editor must show the AI's text with no reload.
  await expect(editorSurface(page)).toContainText("Written by the AI via MCP", {
    timeout: 20_000,
  });
  await mcpLog(page, "✓ the human's editor updated LIVE");
  await page.waitForTimeout(2500);

  await mcpLog(page, "→ close_page_collab");
  await mcp.call("close_page_collab", { sessionId });
  await mcpLog(page, "← session closed. done.");
  mcp.close();
  await page.waitForTimeout(1500);
});
