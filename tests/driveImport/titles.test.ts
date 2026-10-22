import { describe, it, expect } from "vitest";
import { heuristicTitle } from "../../src/lib/docSearch";
import { importSourceKey } from "../../src/features/driveImport/importRegistry";
import { isEditModeRouteState, EDIT_MODE_ROUTE_STATE } from "../../src/features/driveImport/editModeRoute";
import type { NormalizedDrivePayload } from "../../src/features/driveImport/types";

describe("heuristicTitle", () => {
  it("uses the first heading without its marker", () => {
    expect(heuristicTitle("# Meeting notes\n\nBody")).toBe("Meeting notes");
  });

  it("strips the inline HTML the editor writes for font and colour changes", () => {
    expect(heuristicTitle('<span style="font-family: Impact;">sk</span>')).toBe("sk");
    expect(heuristicTitle('# <span style="color: red">Plan</span> &nbsp;A')).toBe("Plan  A");
  });

  it("skips lines that are only markup and blank lines", () => {
    expect(heuristicTitle('\n<span style="x"></span>\n\n## Real title')).toBe("Real title");
  });

  it("drops a trailing hard-break backslash", () => {
    const [backslash, newline] = [String.fromCharCode(92), String.fromCharCode(10)];
    expect(heuristicTitle(["Title", backslash, newline, "next"].join(""))).toBe("Title");
  });

  it("truncates after cleaning, not through a tag", () => {
    expect(heuristicTitle('<span style="font-family: Impact;">abcdefghij</span>', 4)).toBe("abcd");
  });

  it("returns an empty string when there is no text", () => {
    expect(heuristicTitle("")).toBe("");
    expect(heuristicTitle("<br>")).toBe("");
  });
});

describe("importSourceKey", () => {
  const base = { server: "https://blossom.example", name: "a.docx" } as NormalizedDrivePayload;

  it("keys a single-blob file by server and blob hash", () => {
    expect(importSourceKey({ ...base, blobHash: "abc" })).toBe("https://blossom.example|abc");
  });

  it("keys a multi-chunk file by all chunk hashes", () => {
    expect(importSourceKey({ ...base, chunks: [{ hash: "a" }, { hash: "b" }] } as NormalizedDrivePayload)).toBe(
      "https://blossom.example|a,b",
    );
  });

  it("has no key without a payload", () => {
    expect(importSourceKey(null)).toBeNull();
  });
});

describe("edit mode route state", () => {
  it("recognises only the explicit flag", () => {
    expect(isEditModeRouteState(EDIT_MODE_ROUTE_STATE)).toBe(true);
    expect(isEditModeRouteState(null)).toBe(false);
    expect(isEditModeRouteState({})).toBe(false);
    expect(isEditModeRouteState({ openInEditMode: "yes" })).toBe(false);
  });
});
