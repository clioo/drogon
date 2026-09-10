// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationEditorDialog.tsx with its
// header, prompt section, settings sidebar and footer. Adaptation: the prompt
// editor is a textarea (no Monaco in this repo), the settings sidebar is
// reduced to workspace/harness/schedule/grace/enabled (no projects, hosts,
// SSH, precheck or session controls), and there is no Hermes target. Dialog
// chrome (overlay, Escape closes, focus title), copy and layout stay literal.
import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { cn } from "./automation-class-names";
import type { Workspace } from "../../../../shared/session-contract";
import { previewZonedCronFires } from "./automation-cron-preview";
import {
  draftCron,
  type AutomationDraftErrors,
  type AutomationEditorDraft,
} from "./automation-editor-validation";
import { formatAutomationDateTime } from "./automation-page-parts";
import { AutomationSchedulePicker } from "./AutomationSchedulePicker";
import { AutomationTimezonePicker } from "./AutomationTimezonePicker";
import {
  AutomationTemplateEmptyState,
  getAutomationTemplates,
  type AutomationTemplate,
} from "./AutomationListEmptyView";

export const AUTOMATION_EDITOR_PICKER_TRIGGER_CLASS =
  "border-input bg-input/30 shadow-xs hover:bg-accent/60 dark:bg-input/30 dark:hover:bg-input/50";

const FIELD_LABEL_CLASS = "text-[11px] font-semibold uppercase tracking-[0.05em]";

function EditorField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className={FIELD_LABEL_CLASS}>
        <span className="text-muted-foreground">{label}</span>
      </div>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AutomationTemplateCard({
  template,
  onSelect,
}: {
  template: AutomationTemplate;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="rounded-md border border-border/70 bg-background px-3 py-2 text-left shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="text-[11px] font-medium uppercase text-muted-foreground">
        {template.category}
      </div>
      <div className="mt-1 text-sm font-medium">{template.label}</div>
      <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{template.description}</div>
    </button>
  );
}

const selectClass =
  "h-9 w-full min-w-0 rounded-md border border-input bg-input/30 px-3 py-1 text-sm shadow-xs outline-none dark:bg-input/30 focus-visible:ring-[3px] focus-visible:ring-ring/50";

export type AutomationEditorDialogProps = {
  open: boolean;
  isEditing: boolean;
  isSaving: boolean;
  draft: AutomationEditorDraft;
  workspaces: Workspace[];
  errors: AutomationDraftErrors;
  onDraftChange: (updater: (current: AutomationEditorDraft) => AutomationEditorDraft) => void;
  onApplyTemplate: (template: AutomationTemplate) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
};

export function AutomationEditorDialog({
  open,
  isEditing,
  isSaving,
  draft,
  workspaces,
  errors,
  onDraftChange,
  onApplyTemplate,
  onOpenChange,
  onSave,
}: AutomationEditorDialogProps): React.JSX.Element | null {
  const [templateOpen, setTemplateOpen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const isCreateMode = !isEditing;

  useEffect(() => {
    if (!open) return;
    setTemplateOpen(false);
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [open, onOpenChange]);

  if (!open) {
    return null;
  }

  const title = isEditing ? "Edit automation" : "Create automation";
  const cron = draftCron(draft);
  // Zone-aware preview: the cron wall time evaluates in the draft zone
  // with the daemon's gap/fold policy, so this list matches the backend.
  const preview = cron === "" ? null : previewZonedCronFires(cron, draft.timezone, Date.now());

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="automation-editor-title"
        className="flex h-[min(880px,90vh)] w-[min(1080px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-lg border border-border bg-background p-0 shadow-lg"
      >
        <div className="flex flex-row items-center justify-between gap-3 border-b border-border/50 px-5 py-2.5 text-left">
          <h2
            id="automation-editor-title"
            ref={titleRef}
            tabIndex={-1}
            className="min-w-0 truncate text-sm font-medium outline-none"
          >
            {title}
          </h2>
          {isCreateMode ? (
            <div className="relative flex shrink-0 items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setTemplateOpen((v) => !v)} aria-expanded={templateOpen}>
                <Sparkles className="size-4" />
                Use template
              </Button>
              {templateOpen ? (
                <div className="absolute right-0 top-full z-10 mt-1 grid w-96 gap-2 rounded-md border border-border bg-background p-3 shadow-md">
                  {getAutomationTemplates().map((template) => (
                    <AutomationTemplateCard
                      key={template.id}
                      template={template}
                      onSelect={() => {
                        onApplyTemplate(template);
                        setTemplateOpen(false);
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-auto md:flex-row">
          <div className="flex min-h-0 flex-1 flex-col gap-3 border-b border-border/50 p-5 md:border-b-0 md:border-r">
            <EditorField label="Name" error={errors.name}>
              <Input
                value={draft.name}
                maxLength={128}
                placeholder="Nightly sweep"
                aria-label="Automation name"
                className="border-input bg-input/30 shadow-xs dark:bg-input/30"
                onChange={(event) =>
                  onDraftChange((current) => ({ ...current, name: event.target.value }))
                }
              />
            </EditorField>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              <div className={FIELD_LABEL_CLASS}>
                <span className="text-muted-foreground">Prompt</span>
              </div>
              <textarea
                value={draft.prompt}
                rows={12}
                placeholder="What should the automation do on each run?"
                aria-label="Automation prompt"
                className="min-h-40 flex-1 rounded-md border border-input bg-input/30 px-3 py-2 font-mono text-sm shadow-xs outline-none dark:bg-input/30 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onChange={(event) =>
                  onDraftChange((current) => ({ ...current, prompt: event.target.value }))
                }
              />
              {errors.prompt ? (
                <p role="alert" className="text-xs text-destructive">
                  {errors.prompt}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid w-full shrink-0 gap-4 p-5 md:w-72 md:overflow-auto">
            <EditorField label="Workspace" error={errors.workspaceId}>
              <select
                aria-label="Workspace"
                className={cn(selectClass, AUTOMATION_EDITOR_PICKER_TRIGGER_CLASS)}
                value={draft.workspaceId}
                onChange={(event) =>
                  onDraftChange((current) => ({ ...current, workspaceId: event.target.value }))
                }
              >
                <option value="">Select a workspace…</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </EditorField>
            <EditorField label="Harness" error={errors.harness}>
              <select
                aria-label="Harness"
                className={cn(selectClass, AUTOMATION_EDITOR_PICKER_TRIGGER_CLASS)}
                value={draft.harness}
                onChange={(event) =>
                  onDraftChange((current) => ({ ...current, harness: event.target.value }))
                }
              >
                {(["claude", "pi", "opencode", "antigravity", "codex"] as const).map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </EditorField>
            <div className="min-w-0 space-y-1.5">
              <div className={FIELD_LABEL_CLASS}>
                <span className="text-muted-foreground">Timezone</span>
              </div>
              <AutomationTimezonePicker
                timezone={draft.timezone}
                onTimezoneChange={(timezone) =>
                  onDraftChange((current) => ({
                    ...current,
                    timezone,
                    scheduleWarning: null,
                  }))
                }
              />
              {errors.timezone ? (
                <p role="alert" className="text-xs text-destructive">
                  {errors.timezone}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                The schedule runs at this wall time in the selected zone.
              </p>
            </div>
            <div className="min-w-0 space-y-1.5">
              <div className={FIELD_LABEL_CLASS}>
                <span className="text-muted-foreground">Schedule</span>
              </div>
              <AutomationSchedulePicker draft={draft} onDraftChange={onDraftChange} />
              {errors.schedule ? (
                <p role="alert" className="text-xs text-destructive">
                  {errors.schedule}
                </p>
              ) : null}
              <div className="text-xs text-muted-foreground" data-testid="automations-preview">
                {preview === null ? (
                  <span>Next runs: preview unavailable for this expression.</span>
                ) : (
                  <span>
                    Next runs:{" "}
                    {preview.fires.map((fire) => formatAutomationDateTime(fire)).join(" · ")}
                    {preview.skipped.length > 0 ? (
                      <span>
                        {" · "}
                        Skipped:{" "}
                        {preview.skipped
                          .map((skip) => `${skip.date} ${skip.wallTime} (DST gap)`)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </span>
                )}
              </div>
              {draft.scheduleWarning ? (
                <p role="alert" className="text-xs text-destructive">
                  {draft.scheduleWarning}
                </p>
              ) : null}
            </div>
            <EditorField label="Grace" error={errors.graceMinutes}>
              <div className="flex items-center gap-2">
                <Input
                  className="w-24 border-input bg-input/30 shadow-xs dark:bg-input/30"
                  value={draft.graceMinutes}
                  inputMode="decimal"
                  aria-label="Missed-run grace in minutes"
                  placeholder="15"
                  onChange={(event) =>
                    onDraftChange((current) => ({
                      ...current,
                      graceMinutes: event.target.value,
                    }))
                  }
                />
                <span className="text-xs text-muted-foreground">minutes</span>
              </div>
              <p className="text-xs text-muted-foreground">
                A run missed by more than this is recorded as skipped.
              </p>
            </EditorField>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.enabled}
                aria-label="Enabled"
                onChange={(event) =>
                  onDraftChange((current) => ({ ...current, enabled: event.target.checked }))
                }
              />
              Enabled
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/50 px-5 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={isSaving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={isSaving} onClick={onSave}>
            {isEditing ? "Save changes" : "Create automation"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export { AutomationTemplateEmptyState };
