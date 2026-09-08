// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/assemble-chrome/BrowserAddressBar.tsx
// Adapted: history comes in as a `recentUrls` prop (workspace-local recents,
// no store, no Kagi/doc rows — the engine comes from the persisted
// preference, default google); the suggestion dropdown is
// a plain absolutely-positioned listbox (no Popover/Command primitives in
// this feature); dismissal on window blur is kept. Focus/edit-session,
// preview, Enter-to-navigate and Escape-to-restore semantics are unchanged.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Globe } from "lucide-react";
import { cn } from "../tasks/cn";
import { shouldOverlayBrowserAddressBar } from "./browser-address-bar-expansion";
import { readBrowserSearchEngine } from "./browser-search-engine";
import { buildBrowserAddressBarSuggestions } from "./browser-address-bar-suggestions";
import {
  consumeBrowserAddressBarEditSession,
  saveBrowserAddressBarEditSession,
} from "./browser-address-bar-edit-session";
import type { BrowserRecentUrl } from "./browser-recent-urls";
import BrowserAddressBarSuggestionList from "./browser-address-bar-suggestion-list";

export type BrowserAddressBarProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onNavigate: (url: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  dismissSuggestionsRef?: React.MutableRefObject<(() => void) | null>;
  /** Workspace-local recents the suggestions match against. */
  recentUrls: readonly BrowserRecentUrl[];
  /**
   * Tab id that keys a parked edit: a tab switch unmounts the bar
   * mid-typing and the remount for the same tab picks the edit back up.
   */
  editSessionTabId?: string | null;
  /**
   * Escape with no preview to restore: hands the committed URL back (the
   * pane resets the draft). Escape with a preview only restores the typed
   * query, like the source.
   */
  onRevert?: () => void;
};

export default function BrowserAddressBar({
  value,
  onChange,
  onSubmit,
  onNavigate,
  inputRef,
  dismissSuggestionsRef,
  recentUrls,
  editSessionTabId,
  onRevert,
}: BrowserAddressBarProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [selectedValueOverride, setSelectedValueOverride] = useState<string | null>(null);
  const prePreviewValueRef = useRef<string | null>(null);
  // Why: while previewing a highlighted suggestion the input shows the full URL,
  // but suggestions must keep matching the original typed query.
  const autocompleteQuery = prePreviewValueRef.current ?? value;
  const closingRef = useRef(false);
  const openedAtRef = useRef(0);
  const blurCloseTimerRef = useRef<number | null>(null);
  const closingResetTimerRef = useRef<number | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [inlineWidth, setInlineWidth] = useState<number | null>(null);

  // Why: the slot keeps its flex width even while the bar overlays the toolbar,
  // so measuring it here (not the form) cannot oscillate with the overlay.
  useEffect(() => {
    const slot = slotRef.current;
    if (!slot || typeof ResizeObserver === "undefined") {
      return;
    }
    const syncWidth = (): void => setInlineWidth(slot.getBoundingClientRect().width);
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);

  const overlay = shouldOverlayBrowserAddressBar({ inlineWidth, focused: open });

  const editSessionPageId = editSessionTabId ?? null;
  const liveEditRef = useRef({ value, open });
  useLayoutEffect(() => {
    liveEditRef.current = { value, open };
  });

  // Why after mount rather than as the initial state: the pane resumes in its
  // own layout effect, which runs after this bar has already mounted. This is
  // what puts a tab-switched edit back as the user left it.
  useLayoutEffect(() => {
    if (!editSessionPageId) return;
    const resumed = consumeBrowserAddressBarEditSession(editSessionPageId);
    if (!resumed) return;
    if (resumed.preview) {
      prePreviewValueRef.current = resumed.preview.typedQuery;
      setSelectedValueOverride(resumed.preview.previewedUrl);
    }
    onChange(resumed.draft);
    openedAtRef.current = Date.now();
    setOpen(resumed.suggestionsOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSessionPageId]);

  // Why layout and not a passive cleanup: React destroys passive effects for a deleted tree after
  // its DOM is gone, and by then document.activeElement is the body — every edit would read idle.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!editSessionPageId || !input) {
      return;
    }
    return () => {
      // Why only a focused bar: an idle one has no edit to hand on, and resuming it would seize
      // focus and reopen a dropdown for a user who was reading the page.
      if (document.activeElement !== input) {
        return;
      }
      const typedQuery = prePreviewValueRef.current;
      saveBrowserAddressBarEditSession(editSessionPageId, {
        draft: liveEditRef.current.value,
        selection: {
          start: input.selectionStart ?? input.value.length,
          end: input.selectionEnd ?? input.value.length,
          direction: input.selectionDirection ?? "none",
        },
        suggestionsOpen: liveEditRef.current.open,
        // Why the draft alone is not enough: mid-preview it holds the highlighted suggestion, and
        // dropping this would strand the user with no way back to what they actually typed.
        preview:
          typedQuery === null
            ? null
            : { typedQuery, previewedUrl: liveEditRef.current.value },
      });
    };
  }, [editSessionPageId, inputRef]);

  const clearAddressBarTimers = useCallback((): void => {
    if (blurCloseTimerRef.current !== null) {
      window.clearTimeout(blurCloseTimerRef.current);
      blurCloseTimerRef.current = null;
    }
    if (closingResetTimerRef.current !== null) {
      window.clearTimeout(closingResetTimerRef.current);
      closingResetTimerRef.current = null;
    }
  }, []);

  const setAddressBarFormRef = useCallback(
    (node: HTMLFormElement | null) => {
      if (node === null) {
        clearAddressBarTimers();
      }
    },
    [clearAddressBarTimers],
  );

  // Why once per mount: the Settings page unmounts the browser pane, so a
  // saved engine is always re-read before the next edit.
  const [searchEngine] = useState(readBrowserSearchEngine);
  const suggestions = useMemo(
    () =>
      buildBrowserAddressBarSuggestions({
        recentUrls,
        value: autocompleteQuery,
        searchEngine,
      }),
    [recentUrls, autocompleteQuery, searchEngine],
  );

  const clearSuggestionPreview = useCallback((): void => {
    prePreviewValueRef.current = null;
    setSelectedValueOverride(null);
  }, []);

  const previewSuggestion = useCallback(
    (url: string): void => {
      if (prePreviewValueRef.current === null) {
        prePreviewValueRef.current = autocompleteQuery;
      }
      setSelectedValueOverride(url);
      onChange(url);
    },
    [autocompleteQuery, onChange],
  );

  const restoreTypedQuery = useCallback((): void => {
    const typed = prePreviewValueRef.current;
    if (typed === null) {
      return;
    }
    prePreviewValueRef.current = null;
    setSelectedValueOverride(null);
    onChange(typed);
  }, [onChange]);

  const dismissSuggestions = useCallback((): void => {
    if (blurCloseTimerRef.current !== null) {
      window.clearTimeout(blurCloseTimerRef.current);
      blurCloseTimerRef.current = null;
    }
    restoreTypedQuery();
    setOpen(false);
  }, [restoreTypedQuery]);

  const selectedValue =
    selectedValueOverride &&
    suggestions.some((suggestion) => suggestion.url === selectedValueOverride)
      ? selectedValueOverride
      : (suggestions[0]?.url ?? "");

  const handleFocus = useCallback(() => {
    if (closingRef.current) {
      return;
    }
    if (blurCloseTimerRef.current !== null) {
      window.clearTimeout(blurCloseTimerRef.current);
      blurCloseTimerRef.current = null;
    }
    inputRef.current?.select();
    openedAtRef.current = Date.now();
    setOpen(true);
  }, [inputRef]);

  const handleBlur = useCallback(() => {
    // Why: delay close so that clicking a suggestion item registers before
    // the dropdown unmounts. Without this, the mousedown on the list triggers
    // input blur first and the pick never fires.
    //
    // Why (grace window): focusing the bar retries across frames to fight
    // guest focus stealing. Each cycle can cause a transient blur; without
    // this guard the dropdown opens on focus, immediately gets a blur, and
    // closes ~150ms later — the "flash then disappear" on first click.
    const elapsed = Date.now() - openedAtRef.current;
    const grace = elapsed < 400;
    if (blurCloseTimerRef.current !== null) {
      window.clearTimeout(blurCloseTimerRef.current);
    }
    blurCloseTimerRef.current = window.setTimeout(() => {
      blurCloseTimerRef.current = null;
      if (grace && inputRef.current && document.activeElement === inputRef.current) {
        return;
      }
      restoreTypedQuery();
      setOpen(false);
    }, 200);
  }, [inputRef, restoreTypedQuery]);

  const handleSelect = useCallback(
    (url: string) => {
      closingRef.current = true;
      setOpen(false);
      clearSuggestionPreview();
      onNavigate(url);
      if (closingResetTimerRef.current !== null) {
        window.clearTimeout(closingResetTimerRef.current);
      }
      closingResetTimerRef.current = window.setTimeout(() => {
        closingResetTimerRef.current = null;
        closingRef.current = false;
      }, 100);
    },
    [clearSuggestionPreview, onNavigate],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        // Why two stages: the first Escape hands back what the user typed
        // (dropping a preview), the second hands back the committed URL.
        if (prePreviewValueRef.current !== null) {
          restoreTypedQuery();
          setOpen(false);
          return;
        }
        setOpen(false);
        onRevert?.();
        return;
      }

      if (event.key === "Enter" && open) {
        // Why: match Chrome — Enter always navigates to the current input text,
        // not the highlighted dropdown row (click still picks a row directly).
        event.preventDefault();
        setOpen(false);
        clearSuggestionPreview();
        onSubmit();
        return;
      }

      if (!open || suggestions.length === 0) {
        return;
      }

      const isPreviewing = prePreviewValueRef.current !== null;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const idx = suggestions.findIndex((s) => s.url === selectedValue);
        const startIdx = Math.max(idx, 0);
        const next = startIdx < suggestions.length - 1 ? startIdx + 1 : 0;
        previewSuggestion(suggestions[next].url);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        const idx = suggestions.findIndex((s) => s.url === selectedValue);
        const startIdx = Math.max(idx, 0);
        if (!isPreviewing) {
          const next = startIdx > 0 ? startIdx - 1 : suggestions.length - 1;
          previewSuggestion(suggestions[next].url);
          return;
        }
        if (startIdx <= 0) {
          restoreTypedQuery();
          return;
        }
        previewSuggestion(suggestions[startIdx - 1].url);
      }
    },
    [
      open,
      suggestions,
      selectedValue,
      previewSuggestion,
      restoreTypedQuery,
      clearSuggestionPreview,
      onSubmit,
      onRevert,
    ],
  );

  // Why: a window blur (Alt+Tab, guest focus grab) dismisses the dropdown
  // and hands the typed query back, so the bar never strands a preview.
  useEffect(() => {
    if (!open) return;
    const handleWindowBlur = (): void => {
      dismissSuggestions();
    };
    window.addEventListener("blur", handleWindowBlur);
    return () => window.removeEventListener("blur", handleWindowBlur);
  }, [open, dismissSuggestions]);

  useEffect(() => {
    if (!dismissSuggestionsRef) {
      return;
    }
    dismissSuggestionsRef.current = dismissSuggestions;
    return () => {
      dismissSuggestionsRef.current = null;
    };
  }, [dismissSuggestions, dismissSuggestionsRef]);

  const listOpen = open && suggestions.length > 0;

  return (
    // Why: min-w-11 keeps the leading globe a real hit target once the toolbar
    // squeezes the bar away — without it neighbouring buttons overlap the only
    // affordance for reopening the URL field.
    // Why stretch: the toolbar row pins the address slot's height, and the bar must fill it rather
    // than size itself — otherwise it and the document chip drift apart again.
    <div
      ref={slotRef}
      className={cn(
        "flex min-w-11 flex-1 items-stretch",
        // Why: the overlay form positions against the toolbar row, so the
        // slot stays unpositioned while overlaying — otherwise the form would
        // size to the squeezed slot instead of the row. It stays relative
        // otherwise so the suggestion dropdown anchors to the slot (the fork
        // anchors its dropdown to a Popover portal instead).
        !overlay && "relative",
      )}
    >
      <form
        ref={setAddressBarFormRef}
        data-drogon-browser-address-bar-overlay={overlay ? "true" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-1 shadow-sm",
          // Why: the toolbar row is the positioned ancestor, so the overlay
          // spans it edge to edge (matching its px-3) instead of the few
          // pixels the squeezed slot has left.
          overlay
            ? "absolute inset-x-3 top-1/2 z-30 -translate-y-1/2 shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
            : "min-w-0 flex-1",
        )}
        // Why: when squeezed the input is zero-width, so clicks land on the
        // form padding — forward them to the input so it expands and edits.
        onClick={() => inputRef.current?.focus()}
        onSubmit={(event) => {
          event.preventDefault();
          setOpen(false);
          clearSuggestionPreview();
          onSubmit();
        }}
      >
        <Globe className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={value}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          data-drogon-browser-address-bar="true"
          aria-label="Address"
          className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 text-sm shadow-none outline-none"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(event) => {
            const nextValue = event.target.value;
            // Why: typing creates a new suggestion list, so keyboard selection
            // should return to the derived top match instead of a stale row.
            // Clearing preview state here also prevents stale hover/selection
            // from repopulating the input after Cmd+A → Delete.
            prePreviewValueRef.current = null;
            setSelectedValueOverride(null);
            onChange(nextValue);
          }}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls="browser-history-listbox"
          aria-autocomplete="list"
        />
      </form>
      {listOpen ? (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-black/14 bg-[rgba(255,255,255,0.95)] shadow-[0_16px_36px_rgba(0,0,0,0.24)] backdrop-blur-2xl dark:border-white/14 dark:bg-[rgba(0,0,0,0.9)] dark:shadow-[0_20px_44px_rgba(0,0,0,0.42)]">
          <BrowserAddressBarSuggestionList
            suggestions={suggestions}
            selectedValue={selectedValue}
            onSelectedValueChange={setSelectedValueOverride}
            onSelect={handleSelect}
          />
        </div>
      ) : null}
    </div>
  );
}
