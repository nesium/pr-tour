import { onBeforeUnmount, watch, type Ref } from "vue";
import type { SearchQuery } from "./search";

const NAME = "search";
const supported = () => typeof CSS !== "undefined" && "highlights" in CSS;

/**
 * Marks every match of the query inside `container` with the CSS Custom
 * Highlight API, which paints ranges without touching the DOM, so Vue's
 * rendering and the highlighting can't fight. Re-marks whenever the content
 * changes, e.g. as diffs load or a fold opens.
 */
export function useSearchHighlight(container: Ref<HTMLElement | null>, query: Ref<SearchQuery | null>) {
  let frame = 0;
  let scrollToFirst = false;
  const observer = new MutationObserver(() => schedule());

  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(mark);
  }

  function mark() {
    const root = container.value;
    const wanted = query.value;
    if (!supported()) return;
    if (!root || !wanted) {
      CSS.highlights.delete(NAME);
      return;
    }
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.toLowerCase() ?? "";
      for (let at = text.indexOf(wanted); at >= 0; at = text.indexOf(wanted, at + wanted.length)) {
        const range = new Range();
        range.setStart(node, at);
        range.setEnd(node, at + wanted.length);
        ranges.push(range);
      }
    }
    CSS.highlights.set(NAME, new Highlight(...ranges));
    if (scrollToFirst && ranges.length) {
      scrollToFirst = false;
      ranges[0].startContainer.parentElement?.scrollIntoView({ block: "center" });
    }
  }

  watch(
    container,
    (root, _, onCleanup) => {
      if (!root) return;
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      schedule();
      onCleanup(() => observer.disconnect());
    },
    { immediate: true },
  );
  watch(query, schedule);
  onBeforeUnmount(() => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    if (supported()) CSS.highlights.delete(NAME);
  });

  /** Scrolls to the first match once the next page has rendered. */
  return {
    revealFirst() {
      scrollToFirst = true;
      schedule();
    },
  };
}
