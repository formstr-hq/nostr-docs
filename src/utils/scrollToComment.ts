/**
 * Scrolls the document to a comment's highlighted span(s) and briefly pulses
 * them so the eye can find the right spot after the scroll.
 *
 * A single comment can render as multiple `[data-comment-id]` spans — a quote
 * that crosses bold/italic/link boundaries in preview is wrapped per fragment,
 * and edit mode renders a ProseMirror inline decoration. All matching spans are
 * pulsed; the first is scrolled into view.
 *
 * Returns false when the comment has no rendered highlight — resolved and
 * outdated comments aren't anchored in the doc — so callers can treat it as a
 * no-op (e.g. skip the click for outdated cards).
 */
export function scrollToComment(commentId: string): boolean {
  const spans = document.querySelectorAll<HTMLElement>(
    `[data-comment-id="${CSS.escape(commentId)}"]`,
  );
  if (spans.length === 0) return false;

  spans[0].scrollIntoView({ behavior: "smooth", block: "center" });

  spans.forEach((span) => {
    // Restart the animation if it's still mid-pulse from a previous click.
    span.classList.remove("comment-highlight-pulse");
    void span.offsetWidth; // force reflow so re-adding the class replays it
    span.classList.add("comment-highlight-pulse");

    const clear = () => {
      span.classList.remove("comment-highlight-pulse");
      span.removeEventListener("animationend", clear);
    };
    span.addEventListener("animationend", clear);
  });

  return true;
}
