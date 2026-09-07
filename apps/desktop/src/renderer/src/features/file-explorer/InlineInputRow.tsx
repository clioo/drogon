/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/file-explorer-inline-input-row.tsx.
   Adapted: the menu-focus grace timers are simplified to a single
   settle flag (no Radix menu layer here), but the observable contract is
   unchanged — autofocus with stem selection on rename, Enter commits,
   Escape cancels, and blur past the settle window commits like Finder. */

import { useCallback, useRef } from "react";
import { File, Folder } from "lucide-react";
import type { InlineKind } from "./explorer-policy";

export interface InlineInput {
  parentPath: string;
  type: InlineKind;
  depth: number;
  existingName?: string;
  existingPath?: string;
}

export function InlineInputRow({
  depth,
  inlineInput,
  error,
  onSubmit,
  onCancel,
}: {
  depth: number;
  inlineInput: InlineInput;
  /** Validation message from the last submit; null while typing. */
  error: string | null;
  /** True when the value was accepted (row may dismiss). */
  onSubmit: (value: string) => boolean;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const submitted = useRef(false);
  const focusSettled = useRef(false);
  const inlineInputKey = [
    inlineInput.type,
    inlineInput.parentPath,
    inlineInput.depth,
    inlineInput.existingPath ?? "",
    inlineInput.existingName ?? "",
  ].join("\0");

  // `onSubmit` reports whether the value was accepted: a rejection
  // (synchronous validation) clears the guard so fixing the name and
  // pressing Enter retries instead of sticking the row open.
  const submit = useCallback(
    (value: string) => {
      if (submitted.current) return;
      submitted.current = true;
      if (!onSubmit(value)) submitted.current = false;
    },
    [onSubmit],
  );

  const setInputRef = useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      if (!el) return;
      submitted.current = false;
      focusSettled.current = false;
      requestAnimationFrame(() => {
        if (inputRef.current !== el) return;
        el.focus();
        if (inlineInput.type === "rename" && inlineInput.existingName) {
          const dotIndex = inlineInput.existingName.lastIndexOf(".");
          if (dotIndex > 0) el.setSelectionRange(0, dotIndex);
          else el.select();
        }
        // Menu-close focus management can steal focus right after mount;
        // only blurs past this window count as the user leaving the edit.
        setTimeout(() => {
          focusSettled.current = true;
        }, 200);
      });
    },
    [inlineInput.existingName, inlineInput.type],
  );

  return (
    <div
      className="flex w-full items-center gap-1 px-2"
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      data-file-explorer-inline-input=""
    >
      <span className="size-3 shrink-0" aria-hidden />
      {inlineInput.type === "folder" ? (
        <Folder className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <File className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <input
          key={inlineInputKey}
          ref={setInputRef}
          className="min-w-0 flex-1 rounded-sm border border-ring bg-transparent px-1 text-xs text-foreground outline-none"
          aria-label={
            inlineInput.type === "rename"
              ? `Rename to ${inlineInput.existingName ?? ""}`
              : inlineInput.type === "folder"
                ? "New folder name"
                : "New file name"
          }
          defaultValue={
            inlineInput.type === "rename" ? (inlineInput.existingName ?? "") : ""
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit(event.currentTarget.value);
            } else if (event.key === "Escape") {
              submitted.current = true;
              onCancel();
            }
          }}
          onBlur={(event) => {
            // During the grace window a menu close may shift focus away
            // before the user can type: re-focus instead of dismissing the
            // still-empty input. Past that window a blur commits like
            // Finder does.
            if (!focusSettled.current) {
              requestAnimationFrame(() => inputRef.current?.focus());
              return;
            }
            const value = event.currentTarget.value;
            setTimeout(() => submit(value), 150);
          }}
        />
        {error && (
          <span role="alert" className="truncate text-[11px] text-destructive">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
