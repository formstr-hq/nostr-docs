import type { DecorationAttrs } from "@tiptap/pm/view";
import type { MutableRefObject } from "react";
import type { TrustedCollaborator } from "../../../collab/useTrustedCollaborators";

const FALLBACK_COLOR = "#9e9e9e";
const FALLBACK_NAME = "Anonymous";

/**
 * Builds the render/selectionRender callbacks for `@tiptap/extension-collaboration-caret`.
 *
 * These are plain functions invoked by the ProseMirror decoration plugin
 * outside React's render cycle, on every awareness update — they read a ref
 * (not React state) so they always see the latest resolved collaborator
 * identities without needing to recreate the TipTap editor.
 *
 * The `user` argument is this app's own awareness "user" field, which only
 * ever contains `{ sessionPubkey }` (see NostrYjsProvider) — deliberately no
 * self-asserted name/color, since those are resolved+trusted via
 * `useTrustedCollaborators` (session-attestation + profile lookup) instead.
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
    const picture = trusted?.picture;

    const caret = document.createElement("span");
    caret.classList.add("collaboration-caret");
    caret.setAttribute("style", `border-color: ${color}`);

    const label = document.createElement("div");
    label.classList.add("collaboration-caret__label");
    label.setAttribute("style", `background-color: ${color}`);

    const avatarWrap = document.createElement("span");
    avatarWrap.classList.add("collaboration-caret__avatar");
    avatarWrap.textContent = name.slice(0, 1).toUpperCase();

    if (picture) {
      const img = document.createElement("img");
      img.src = picture;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      // On load/decode failure, fall back to the initials already sitting
      // behind the image (avatarWrap's textContent) by just removing it.
      img.onerror = () => img.remove();
      avatarWrap.appendChild(img);
    }

    const nameSpan = document.createElement("span");
    nameSpan.classList.add("collaboration-caret__name");
    nameSpan.textContent = name;

    label.appendChild(avatarWrap);
    label.appendChild(nameSpan);
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
