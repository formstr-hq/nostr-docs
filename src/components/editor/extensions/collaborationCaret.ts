import type { DecorationAttrs } from "@tiptap/pm/view";
import type { MutableRefObject } from "react";
import type { TrustedCollaborator } from "../../../collab/useTrustedCollaborators";

const FALLBACK_COLOR = "#9e9e9e";
const FALLBACK_NAME = "Anonymous";

/**
 * Builds the render/selectionRender callbacks for
 * `@tiptap/extension-collaboration-caret`. These are plain functions invoked by
 * the ProseMirror decoration plugin outside React's render cycle, so they read a
 * ref (not state) for the latest resolved collaborator identities.
 *
 * The `user` argument is only `{ sessionPubkey }` (see NostrYjsProvider) — names
 * and colors are resolved+trusted via `useTrustedCollaborators`.
 */
export function createCollaborationCaretRenderers(
  trustedRef: MutableRefObject<Map<string, TrustedCollaborator>>,
) {
  const lookup = (user: Record<string, unknown>): TrustedCollaborator | null => {
    const sessionPubkey = user?.sessionPubkey as string | undefined;
    if (!sessionPubkey) return null;
    return trustedRef.current.get(sessionPubkey) ?? null;
  };

  const render = (user: Record<string, unknown>): HTMLElement => {
    const trusted = lookup(user);
    const color = trusted?.color ?? FALLBACK_COLOR;
    const name = trusted?.name ?? FALLBACK_NAME;

    const caret = document.createElement("span");
    caret.classList.add("collaboration-caret");
    caret.setAttribute("style", `border-color: ${color}`);

    const label = document.createElement("div");
    label.classList.add("collaboration-caret__label");
    label.setAttribute("style", `background-color: ${color}`);
    label.textContent = name;

    caret.appendChild(label);
    return caret;
  };

  const selectionRender = (user: Record<string, unknown>): DecorationAttrs => {
    const trusted = lookup(user);
    const color = trusted?.color ?? FALLBACK_COLOR;
    return {
      style: `background-color: ${color}33`,
      class: "collaboration-caret__selection",
    };
  };

  return { render, selectionRender };
}
