/* C04 additive editor: list/add/edit/delete controls for a Bot's
 * versioned, project-scoped memories. Presentational + local draft state
 * only (this repo's Bots data-layer convention): every mutation is
 * emitted as an explicit expected-version request through the caller's
 * bridge-backed callback -- no bridge access, no window.api, no local
 * persistence. The excluded BotsPanel/use-bots-page-controller mount
 * wires these callbacks to the reviewed `bot.memory_*` bridge methods
 * (checkpoint msg_068595e02641) and owns busy/error/conflict state. */

import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import type { MemoryScope } from "./bot-memory-draft";
import {
  buildMemoryCreateRequest,
  buildMemoryDeleteRequest,
  buildMemoryUpdateRequest,
  isLegacyGlobalMemory,
  memoryContentError,
  memoryScopeLabel,
  memoryVisibilitySummary,
} from "./bot-memory-draft";
import type {
  BotMemoryRecord,
  MemoryCreateRequest,
  MemoryDeleteRequest,
  MemoryUpdateRequest,
  VersionConflict,
} from "./bot-memory-draft";

/** A failed update/delete carrying both versions; `memoryId` names the
 *  record the conflict belongs to (create conflicts cannot happen: a new
 *  record has no expected version). */
export type MemoryConflictState = VersionConflict & {
  memoryId: string | null;
};

export type BotMemoryEditorProps = {
  botId: string;
  memories: BotMemoryRecord[];
  /** Current project context. Project-scoped new memories need it; null
   *  (the app-global Bots scope) offers global scope only. */
  projectId: string | null;
  busy: boolean;
  error: string | null;
  conflict: MemoryConflictState | null;
  onCreate: (request: MemoryCreateRequest) => void | Promise<void>;
  onUpdate: (request: MemoryUpdateRequest) => void | Promise<void>;
  onDelete: (request: MemoryDeleteRequest) => void | Promise<void>;
  onDismissConflict?: () => void;
};

const SCOPE_SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";

export function BotMemoryEditor({
  botId,
  memories,
  projectId,
  busy,
  error,
  conflict,
  onCreate,
  onUpdate,
  onDelete,
  onDismissConflict,
}: BotMemoryEditorProps) {
  const [newContent, setNewContent] = useState("");
  const [newScope, setNewScope] = useState<MemoryScope>(
    projectId ? "project" : "global",
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const newContentError = memoryContentError(newContent);
  const editContentError =
    editingId === null ? null : memoryContentError(editContent);

  const submitCreate = () => {
    if (busy || newContentError) {
      return;
    }
    void Promise.resolve(
      onCreate(
        buildMemoryCreateRequest({
          botId,
          scope: newScope,
          projectId,
          content: newContent,
        }),
      ),
    ).finally(() => {
      setNewContent("");
    });
  };

  const submitEdit = (record: BotMemoryRecord) => {
    if (busy || editContentError) {
      return;
    }
    void Promise.resolve(
      onUpdate(buildMemoryUpdateRequest(record, editContent)),
    ).finally(() => {
      setEditingId(null);
      setEditContent("");
    });
  };

  return (
    <section
      data-testid="bot-memory-editor"
      aria-label="Memories"
      className="space-y-3 rounded-lg border border-border px-5 py-4"
    >
      <div>
        <h3 className="text-sm font-semibold">Memories</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Facts this Bot keeps across sessions. Global memories follow it into
          every project; project memories stay in their project.
        </p>
      </div>
      {conflict ? (
        <div
          role="alert"
          data-testid="bot-memory-conflict"
          className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-foreground"
        >
          This memory changed elsewhere: you expected version{" "}
          {conflict.expectedVersion}, but it is now version{" "}
          {conflict.currentVersion}. Refresh and retry to keep the other change.
          {onDismissConflict ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-2 h-6 px-2 text-xs"
              onClick={onDismissConflict}
            >
              Dismiss
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          data-testid="bot-memory-error"
          className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}
      {memories.length ? (
        <ul className="space-y-2" aria-label="Memory list">
          {memories.map((record) => (
            <li
              key={record.id}
              data-testid="memory-row"
              className="rounded-md border border-border px-3 py-2"
            >
              {editingId === record.id ? (
                <div className="space-y-2">
                  <Textarea
                    aria-label="Edit memory content"
                    value={editContent}
                    rows={2}
                    disabled={busy}
                    onChange={(event) => setEditContent(event.target.value)}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(null);
                        setEditContent("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      data-testid="memory-edit-save"
                      disabled={busy || Boolean(editContentError)}
                      onClick={() => submitEdit(record)}
                    >
                      {busy ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        record.scope === "global" ? "secondary" : "outline"
                      }
                    >
                      {memoryScopeLabel(record)}
                    </Badge>
                    {isLegacyGlobalMemory(record) ? (
                      <Badge
                        variant="dot"
                        title="Migrated from earlier global-only memories; visible in every project."
                      >
                        Legacy global
                      </Badge>
                    ) : null}
                    <span className="ml-auto flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Edit memory ${record.id}`}
                        disabled={busy}
                        onClick={() => {
                          setEditingId(record.id);
                          setEditContent(record.content);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete memory ${record.id}`}
                        disabled={busy}
                        onClick={() =>
                          void Promise.resolve(
                            onDelete(buildMemoryDeleteRequest(record)),
                          )
                        }
                      >
                        Delete
                      </Button>
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">
                    {record.content}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {memoryVisibilitySummary(record)}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p
          data-testid="bot-memory-empty"
          className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground"
        >
          No memories yet.
        </p>
      )}
      <form
        aria-label="Add a memory"
        className="space-y-2 border-t border-border pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          submitCreate();
        }}
      >
        <Textarea
          aria-label="New memory content"
          data-testid="memory-new-content"
          value={newContent}
          rows={2}
          disabled={busy}
          placeholder="One fact this Bot should always keep"
          onChange={(event) => setNewContent(event.target.value)}
        />
        <div className="flex items-end justify-between gap-3">
          {projectId ? (
            <label className="w-40 space-y-1 text-xs font-medium">
              Scope
              <select
                aria-label="Memory scope"
                data-testid="memory-scope-select"
                value={newScope}
                disabled={busy}
                className={SCOPE_SELECT_CLASS}
                onChange={(event) =>
                  setNewScope(event.target.value as MemoryScope)
                }
              >
                <option value="project">Project</option>
                <option value="global">Global</option>
              </select>
            </label>
          ) : (
            <input type="hidden" value="global" aria-hidden />
          )}
          <Button
            type="submit"
            size="sm"
            data-testid="memory-add"
            disabled={busy || Boolean(newContentError)}
            title={newContentError ?? undefined}
          >
            <Plus />
            {busy ? "Adding…" : "Add memory"}
          </Button>
        </div>
        {newContentError && newContent.trim() ? (
          <p className="text-xs text-destructive" role="status">
            {newContentError}
          </p>
        ) : null}
      </form>
    </section>
  );
}

export default BotMemoryEditor;
