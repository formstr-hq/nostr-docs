import { test, expect, type Page } from "@playwright/test";
import WebSocket from "ws";
import * as Y from "yjs";
import { readSyncMessage, writeSyncStep1, writeUpdate } from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip44,
  type Event,
} from "nostr-tools";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { nip19, finalizeEvent as signWith } from "nostr-tools";
import {
  loginAsGuest,
  typeIntoEditor,
  save,
  unlockAfterReload,
  editorSurface,
  closeShareDialog,
  queryLocalRelay,
  publishToLocalRelay,
  pubkeyFromDocUrl,
  LOCAL_RELAY_URL,
} from "./helpers";
import { decodeNKeys, encodeNKeys } from "../../src/utils/nkeys";

/**
 * Live collaboration authorization. A viewKey is held by everyone a page is
 * shared with — including view-only recipients — so the live Yjs layer must not
 * treat "can decrypt" as "may edit", and a collaborator's identity must come
 * from who signed the event, not from what their presence state claims.
 *
 * The attacker here is a plain script holding only the share link's viewKey.
 */

const KIND_CRDT_OP = 22457;
const KIND_PRESENCE = 24578;

function viewKeyFromLink(link: string): string {
  const hash = new URL(link).hash.replace(/^#/, "");
  const viewKey = decodeNKeys(hash).viewKey;
  if (!viewKey) throw new Error("share link has no viewKey");
  return viewKey;
}

function conversationKey(viewKey: string): Uint8Array {
  const bytes = hexToBytes(viewKey);
  return nip44.getConversationKey(bytes, getPublicKey(bytes));
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** A script that speaks the app's collab wire format with only a viewKey. */
class Attacker {
  readonly sk = generateSecretKey();
  readonly pubkey = getPublicKey(this.sk);
  readonly ydoc = new Y.Doc();
  private readonly ws: WebSocket;
  private readonly room: string;
  private readonly convKey: Uint8Array;
  private readonly opened: Promise<void>;

  constructor(viewKey: string) {
    this.room = getPublicKey(hexToBytes(viewKey));
    this.convKey = conversationKey(viewKey);
    this.ws = new WebSocket(LOCAL_RELAY_URL);
    this.opened = new Promise((resolve) => this.ws.on("open", () => resolve()));
    this.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg[0] !== "EVENT") return;
      const event = msg[2] as Event;
      if (event.kind !== KIND_CRDT_OP || event.pubkey === this.pubkey) return;
      try {
        const env = JSON.parse(nip44.decrypt(event.content, this.convKey));
        const decoder = decoding.createDecoder(Buffer.from(env.m, "base64"));
        readSyncMessage(decoder, encoding.createEncoder(), this.ydoc, "remote");
      } catch {
        /* not for us */
      }
    });
  }

  async join(): Promise<void> {
    await this.opened;
    this.ws.send(
      JSON.stringify(["REQ", "atk", { kinds: [KIND_CRDT_OP], "#a": [this.room] }]),
    );
    const encoder = encoding.createEncoder();
    writeSyncStep1(encoder, this.ydoc);
    this.send(KIND_CRDT_OP, encoding.toUint8Array(encoder));
  }

  /** Append a paragraph to the shared document and broadcast the update. */
  injectParagraph(text: string): void {
    const updates: Uint8Array[] = [];
    const onUpdate = (u: Uint8Array) => updates.push(u);
    this.ydoc.on("update", onUpdate);
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [new Y.XmlText(text)]);
    this.ydoc.getXmlFragment("default").push([p]);
    this.ydoc.off("update", onUpdate);
    for (const u of updates) {
      const encoder = encoding.createEncoder();
      writeUpdate(encoder, u);
      this.send(KIND_CRDT_OP, encoding.toUint8Array(encoder));
    }
  }

  /** Broadcast a presence state that claims someone else's session key. */
  claimSession(sessionPubkey: string): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint(encoder, Math.floor(Math.random() * 2 ** 30));
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarString(encoder, JSON.stringify({ user: { sessionPubkey } }));
    this.send(KIND_PRESENCE, encoding.toUint8Array(encoder));
  }

  private send(kind: number, bytes: Uint8Array): void {
    const content = nip44.encrypt(JSON.stringify({ a: null, m: b64(bytes) }), this.convKey);
    const event = finalizeEvent(
      { kind, tags: [["a", this.room]], content, created_at: Math.floor(Date.now() / 1000) },
      this.sk,
    );
    this.ws.send(JSON.stringify(["EVENT", event]));
  }

  close(): void {
    this.ws.close();
  }
}

async function becomeVisualEditor(page: Page) {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Visual editor" }).click();
  await expect(editorSurface(page)).toBeVisible();
  await expect(page.getByText(/Connecting/)).toBeHidden({ timeout: 20_000 });
}

async function ownerShares(page: Page, mode: "view" | "open"): Promise<string> {
  await loginAsGuest(page);
  await typeIntoEditor(page, `# collab-auth-${Date.now()}\n\nowner text`);
  await save(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Share Page" });
  if (mode === "open") {
    await dialog.getByRole("switch", { name: "Can edit" }).click();
    await dialog.getByRole("switch", { name: "Anyone with the link can edit" }).click();
  }
  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 20_000 });
  await closeShareDialog(page);
  return page.url();
}

test("a view-only link holder cannot push edits into a live session", async ({ page }) => {
  const link = await ownerShares(page, "view");
  await becomeVisualEditor(page);

  const attacker = new Attacker(viewKeyFromLink(link));
  await attacker.join();
  // Wait until the attacker has the owner's live document, so its edit is a
  // well-formed continuation of it rather than a detached fragment.
  await expect
    .poll(() => attacker.ydoc.getXmlFragment("default").length, { timeout: 20_000 })
    .toBeGreaterThan(0);

  attacker.injectParagraph("INJECTED-BY-VIEWER");
  // Give the update ample time to arrive and be applied.
  await page.waitForTimeout(3_000);
  await expect(editorSurface(page)).toContainText("owner text");
  await expect(editorSurface(page)).not.toContainText("INJECTED-BY-VIEWER");
  attacker.close();
});

test("presence cannot claim another collaborator's identity", async ({ page, browser }) => {
  const link = await ownerShares(page, "open");
  await becomeVisualEditor(page);
  const viewKey = viewKeyFromLink(link);
  const room = getPublicKey(hexToBytes(viewKey));

  // A real editor joins, is shown to the owner, then leaves.
  const editorContext = await browser.newContext();
  const editor = await editorContext.newPage();
  await loginAsGuest(editor);
  await editor.goto(link);
  await unlockAfterReload(editor);
  await becomeVisualEditor(editor);

  const presenceAvatars = page.getByRole("img").filter({ hasText: /./ });
  await expect(presenceAvatars).toHaveCount(1, { timeout: 20_000 });
  const editorName = await presenceAvatars.first().getAttribute("aria-label");
  expect(editorName).toBeTruthy();

  // The editor's session key is public: it signs every presence event.
  const ownerSessions = new Set<string>();
  const presence = await queryLocalRelay({ kinds: [KIND_PRESENCE], "#a": [room] });
  const convKey = conversationKey(viewKey);
  let editorSession: string | null = null;
  for (const ev of presence) {
    try {
      const env = JSON.parse(nip44.decrypt(ev.content, convKey));
      const realPubkey = env.a ? JSON.parse(env.a.content).realPubkey : null;
      const short = realPubkey ? `${realPubkey.slice(0, 6)}…${realPubkey.slice(-4)}` : null;
      if (short === editorName) editorSession = ev.pubkey;
      else ownerSessions.add(ev.pubkey);
    } catch {
      /* ignore */
    }
  }
  expect(editorSession, "found the editor's session key").toBeTruthy();

  await editorContext.close();
  await expect(presenceAvatars).toHaveCount(0, { timeout: 45_000 });

  // The attacker now shows up claiming the departed editor's session key.
  const attacker = new Attacker(viewKey);
  await attacker.join();
  attacker.claimSession(editorSession!);
  await page.waitForTimeout(3_000);
  await expect(page.getByRole("img", { name: editorName! })).toHaveCount(0);
  attacker.close();
});

/** Append a line at the end of the visual editor. */
async function appendLine(page: Page, text: string) {
  await editorSurface(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(text);
}

test("a roster editor's live edits still reach the owner", async ({ page, browser }) => {
  // The editor signs in first and saves a page, which tells us their pubkey.
  const editorContext = await browser.newContext();
  const editor = await editorContext.newPage();
  await loginAsGuest(editor);
  await typeIntoEditor(editor, "editor scratch page");
  await save(editor);
  const editorPubkey = pubkeyFromDocUrl(editor.url());

  // Owner shares an editable link, then restricts editing to that editor.
  await loginAsGuest(page);
  await typeIntoEditor(page, `# restricted-${Date.now()}\n\nowner text`);
  await save(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Share Page" });
  await dialog.getByRole("switch", { name: "Can edit" }).click();
  await dialog.getByRole("button", { name: "Generate Link" }).click();
  await expect(page).toHaveURL(/#nkeys1/, { timeout: 20_000 });
  await dialog.getByLabel("npub1… or hex pubkey").fill(nip19.npubEncode(editorPubkey));
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog.getByRole("button", { name: `Remove editor ${editorPubkey.slice(0, 8)}` })).toBeVisible({
    timeout: 20_000,
  });
  await closeShareDialog(page);
  const link = page.url();
  await becomeVisualEditor(page);

  await editor.goto(link);
  await unlockAfterReload(editor);
  await expect(editor.getByText("Shared page · edit access")).toBeVisible({ timeout: 20_000 });
  await becomeVisualEditor(editor);

  const line = `roster-editor-live-${Date.now()}`;
  await appendLine(editor, line);
  // Live, without saving.
  await expect(editorSurface(page)).toContainText(line, { timeout: 20_000 });
  await editorContext.close();
});

test("two editKey holders on a legacy link still edit live together", async ({ browser }) => {
  // A legacy share, forged exactly as the old model wrote it.
  const editKey = generateSecretKey();
  const viewKey = generateSecretKey();
  const conv = nip44.getConversationKey(viewKey, getPublicKey(viewKey));
  const dtag = `leg${Math.random().toString(36).slice(2, 8)}`;
  await publishToLocalRelay(
    signWith(
      {
        kind: 33457,
        tags: [["d", dtag]],
        content: nip44.encrypt(`# legacy-live-${Date.now()}\n\nlegacy body`, conv),
        created_at: Math.floor(Date.now() / 1000),
      },
      editKey,
    ),
  );
  const naddr = nip19.naddrEncode({ kind: 33457, pubkey: getPublicKey(editKey), identifier: dtag });
  const link = `/doc/${naddr}#${encodeNKeys({ viewKey: bytesToHex(viewKey), editKey: bytesToHex(editKey) })}`;

  // Two anonymous visitors: the editKey is their only credential.
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  for (const p of [a, b]) {
    await p.goto(link);
    await expect(p.getByText("legacy body").first()).toBeVisible({ timeout: 20_000 });
    await becomeVisualEditor(p);
  }

  const line = `legacy-live-${Date.now()}`;
  await appendLine(a, line);
  await expect(editorSurface(b)).toContainText(line, { timeout: 20_000 });
  await a.context().close();
  await b.context().close();
});
