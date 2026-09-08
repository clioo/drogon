// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/jira/IssueDialog.tsx — DOM structure,
// Tailwind classes, copy strings, keyboard handling and ARIA are the fork's;
// the model is this directory's useJiraIssueCreationDialog hook and the
// submit shortcut label follows this repo's screen-submit helper.
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import {
  isScreenSubmitShortcut,
  getScreenSubmitModifierLabel,
} from "../../new-workspace/composer-submit-shortcut";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import { Button } from "../../../components/ui/button";
import { getJiraProjectPickerDisplayLabel as getJiraProjectDisplayLabel } from "./jira-project-picker-filter";
import { ChevronDown, Check, LoaderCircle } from "lucide-react";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "../../../components/ui/command";
import { getJiraProjectSelectionKey } from "./jira-project-selection";
import { cn } from "../cn";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../../components/ui/select";
import { Input } from "../../../components/ui/input";
import { getJiraCreateAllowedValueLabel } from "./jira-create-fields";
import type { JiraIssueCreationDialogState } from "./use-jira-issue-creation";

export function JiraIssueCreateDialog({
  model,
}: {
  model: JiraIssueCreationDialogState;
}): React.JSX.Element {
  const {
    open,
    setOpen,
    title,
    setTitle,
    body,
    setBody,
    projectComboboxOpen,
    handleProjectComboboxOpenChange,
    projectQuery,
    setProjectQuery,
    projectCommandValue,
    setProjectCommandValue,
    targetTypeId,
    setTargetTypeId,
    submitting,
    projectSearchInputRef,
    availableIssueTypes,
    issueTypesLoading,
    createFieldsLoading,
    createFieldsError,
    customFieldValues,
    setCustomFieldValues,
    includeSiteNameInProjectLabel,
    sortedProjects,
    filteredProjects,
    targetProject,
    targetProjectKey,
    targetType,
    visibleCreateFields,
    hasMissingJiraCreateField,
    handleProjectSelect,
    handleProjectTriggerKeyDown,
    handleCreate,
  } = model;
  const submitShortcutLabel = `${getScreenSubmitModifierLabel()} Enter`;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) {
          setOpen(next);
        }
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        onKeyDown={(event) => {
          if (isScreenSubmitShortcut(event)) {
            event.preventDefault();
            void handleCreate();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>New Jira issue</DialogTitle>
          <DialogDescription>
            {targetProject
              ? `Creates a new issue in ${targetProject.key}.`
              : "Choose a Jira project before creating the issue."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-muted-foreground">
                Project
              </label>
              <Popover
                open={projectComboboxOpen}
                onOpenChange={handleProjectComboboxOpenChange}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={projectComboboxOpen}
                    onKeyDown={handleProjectTriggerKeyDown}
                    disabled={submitting || sortedProjects.length === 0}
                    className="h-9 w-full justify-between px-3 text-left text-xs font-normal"
                  >
                    {targetProject ? (
                      <span className="min-w-0 truncate">
                        {getJiraProjectDisplayLabel(
                          targetProject,
                          includeSiteNameInProjectLabel,
                        )}
                      </span>
                    ) : (
                      <span className="min-w-0 truncate text-muted-foreground">
                        Project
                      </span>
                    )}
                    <ChevronDown className="size-3.5 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] p-0"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                >
                  <Command
                    shouldFilter={false}
                    value={projectCommandValue}
                    onValueChange={setProjectCommandValue}
                  >
                    <CommandInput
                      ref={projectSearchInputRef}
                      placeholder="Search projects..."
                      value={projectQuery}
                      onValueChange={setProjectQuery}
                    />
                    <CommandList className="max-h-56">
                      <CommandEmpty>No projects found.</CommandEmpty>
                      {filteredProjects.map((project) => {
                        const selectionKey = getJiraProjectSelectionKey(project);
                        const selected = selectionKey === targetProjectKey;
                        return (
                          <CommandItem
                            key={selectionKey}
                            value={selectionKey}
                            onSelect={() => handleProjectSelect(selectionKey)}
                            className="items-center gap-2 px-3 py-2 text-xs"
                          >
                            <Check
                              className={cn(
                                "size-3.5 text-foreground",
                                selected ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {getJiraProjectDisplayLabel(
                                project,
                                includeSiteNameInProjectLabel,
                              )}
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-muted-foreground">
                Issue type
              </label>
              <Select
                value={targetTypeId ?? targetType?.id ?? undefined}
                onValueChange={(value) => setTargetTypeId(value)}
                disabled={
                  submitting ||
                  issueTypesLoading ||
                  availableIssueTypes.length === 0
                }
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      issueTypesLoading ? "Loading..." : "Issue type"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableIssueTypes.map((issueType) => (
                    <SelectItem key={issueType.id} value={issueType.id}>
                      {issueType.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Title
            </label>
            <Input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void handleCreate();
                }
              }}
              placeholder="Short summary"
              disabled={submitting}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Description (optional)
            </label>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="What's going on?"
              rows={6}
              disabled={submitting}
              className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 resize-none max-h-60 overflow-y-auto scrollbar-sleek"
            />
          </div>
          {createFieldsLoading ? (
            <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              Loading required Jira fields…
            </div>
          ) : null}
          {createFieldsError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {createFieldsError}
            </p>
          ) : null}
          {visibleCreateFields.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {visibleCreateFields.map((field) => {
                const fieldValue = customFieldValues[field.key] ?? "";
                return (
                  <div key={field.key} className="flex min-w-0 flex-col gap-1">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      {field.name}
                    </label>
                    {field.allowedValues?.length && field.schema?.type !== "array" ? (
                      <Select
                        value={fieldValue}
                        onValueChange={(value) =>
                          setCustomFieldValues((prev) => ({
                            ...prev,
                            [field.key]: value,
                          }))
                        }
                        disabled={submitting}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={`Select ${field.name}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {field.allowedValues.map((value) => {
                            const optionValue = value.id ?? value.value ?? value.name ?? "";
                            return optionValue ? (
                              <SelectItem key={optionValue} value={optionValue}>
                                {getJiraCreateAllowedValueLabel(value)}
                              </SelectItem>
                            ) : null;
                          })}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={fieldValue}
                        onChange={(event) =>
                          setCustomFieldValues((prev) => ({
                            ...prev,
                            [field.key]: event.target.value,
                          }))
                        }
                        type={field.schema?.type === "number" ? "number" : "text"}
                        placeholder={
                          field.schema?.type === "array"
                            ? "Comma-separated values"
                            : `Enter ${field.name}`
                        }
                        disabled={submitting}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
          <p className="text-[10px] text-muted-foreground">
            {submitShortcutLabel} to submit.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleCreate()}
            disabled={
              !targetProject ||
              !targetTypeId ||
              !title.trim() ||
              hasMissingJiraCreateField ||
              createFieldsLoading ||
              submitting
            }
          >
            {submitting ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Creating…
              </>
            ) : (
              "Create issue"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
