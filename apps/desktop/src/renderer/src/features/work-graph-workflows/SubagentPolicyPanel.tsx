// MIT Copyright (c) 2026 Lovecast Inc.
// The "Subagent policy" panel (Orchestrator, Part 1): every control here
// is `intent` — an ordered Approved-runtimes list (the failover order),
// one Fallback runtime, the bounded Adversarial-testing loop's on/off and
// max-iterations, and the new Delegate mode. Writes go through the SAME
// `graph.write_intent` seam the authoring canvas uses (`onChange` hands
// the parent a complete new `GraphPolicy`; the parent resends the current
// `nodes` array unchanged alongside it — see `graph-contract.ts`'s doc on
// why `policy` must never be sent without the current nodes, and never be
// omitted when the human meant to change it).
//
// Harness/model choices come from the REAL catalogs
// (`useHarnessCatalog`/`useMentuModelCatalog`, PRs #426/#436/#453) — the
// same source WorkGraphDesigner's node inspector uses. A subagent policy
// row only offers real agent harnesses (never `shell`: a policy row picks
// WHICH AGENT does the work, and shell has no model to fail over to).
//
// The summary line is derived (`deriveSubagentPolicySummary`), never a
// separately-tracked count — it can't drift from the policy it describes.

import { useMemo } from "react";
import { Minus, Plus, ChevronDown, ChevronUp, X } from "lucide-react";
import {
  MAX_ADVERSARIAL_MAX_ITERATIONS,
  MAX_POLICY_APPROVED_RUNTIMES,
  MIN_ADVERSARIAL_MAX_ITERATIONS,
  deriveSubagentPolicySummary,
  type GraphPolicy,
  type GraphRuntimeRef,
} from "../../../../shared/graph-contract";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { useHarnessCatalog } from "../mentu/mentu-harness-catalog";
import { useMentuModelCatalog } from "../mentu/mentu-model-catalog";
import { MentuModelPicker } from "../mentu/MentuModelPicker";
import { modelOptionsFromCatalog } from "../mentu/mentu-model-registry";

function RuntimeModelField({
  harness,
  model,
  disabled,
  onChange,
  testIdPrefix,
}: {
  harness: string;
  model: string;
  disabled: boolean;
  onChange: (model: string) => void;
  testIdPrefix: string;
}): React.JSX.Element {
  const modelCatalog = useMentuModelCatalog(harness);
  const options = useMemo(
    () =>
      modelOptionsFromCatalog({
        catalog: modelCatalog.catalog,
        recipe: null,
        harness,
        excludeStepLabel: null,
      }),
    [modelCatalog.catalog, harness],
  );
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span
        className="min-w-0 flex-1 truncate rounded-md border border-input bg-transparent px-2 py-1 text-xs"
        data-testid={`${testIdPrefix}-model-value`}
      >
        {model || "harness default"}
      </span>
      <MentuModelPicker
        options={options}
        selected={model}
        disabled={disabled}
        onSelect={onChange}
        emptyReason={
          modelCatalog.error
            ? `The host enumerated nothing for ${harness}: ${modelCatalog.error}`
            : modelCatalog.catalog
              ? `The host enumerated no models for ${harness} (${modelCatalog.catalog.status}). Type an exact id — it rides unverified.`
              : null
        }
      />
    </div>
  );
}

function HarnessSelect({
  value,
  harnesses,
  disabled,
  onChange,
  testId,
}: {
  value: string;
  harnesses: { harnessId: string; displayName: string }[];
  disabled: boolean;
  onChange: (harness: string) => void;
  testId: string;
}): React.JSX.Element {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        size="sm"
        className="min-w-0 flex-1"
        aria-label="Harness"
        data-testid={testId}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {harnesses.map((harness) => (
          <SelectItem key={harness.harnessId} value={harness.harnessId}>
            {harness.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SubagentPolicyPanel({
  policy,
  onChange,
  interactive,
}: {
  policy: GraphPolicy;
  /** Hands the parent the COMPLETE new policy on every edit; the parent
   *  writes it through `graph.write_intent` alongside the current, unchanged
   *  `nodes`. */
  onChange: (next: GraphPolicy) => void;
  /** False renders every control disabled with an honest reason, instead
   *  of accepting edits nothing will ever save. */
  interactive: boolean;
}): React.JSX.Element {
  const harnessCatalog = useHarnessCatalog();
  const harnesses = harnessCatalog.harnesses.filter(
    (harness) => harness.availability === "available",
  );
  const fallbackHarnesses =
    harnesses.length > 0
      ? harnesses
      : harnessCatalog.harnesses.length > 0
        ? harnessCatalog.harnesses
        : [
            {
              harnessId: policy.fallbackRuntime?.harness ?? "pi",
              displayName: policy.fallbackRuntime?.harness ?? "pi",
            },
          ];
  const approvedHarnessChoices =
    harnesses.length > 0 ? harnesses : fallbackHarnesses;

  const summary = deriveSubagentPolicySummary(policy);
  const disabledReason = interactive
    ? null
    : "Save is unavailable in this build — changes here would not persist.";

  const updateApproved = (index: number, patch: Partial<GraphRuntimeRef>) => {
    const next = policy.approvedRuntimes.map((runtime, i) =>
      i === index ? { ...runtime, ...patch } : runtime,
    );
    onChange({ ...policy, approvedRuntimes: next });
  };

  const removeApproved = (index: number) => {
    onChange({
      ...policy,
      approvedRuntimes: policy.approvedRuntimes.filter((_, i) => i !== index),
    });
  };

  const moveApproved = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= policy.approvedRuntimes.length) return;
    const next = [...policy.approvedRuntimes];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange({ ...policy, approvedRuntimes: next });
  };

  const addApproved = () => {
    const fallback: GraphRuntimeRef = {
      harness: approvedHarnessChoices[0]?.harnessId ?? "pi",
      model: "",
    };
    onChange({
      ...policy,
      approvedRuntimes: [...policy.approvedRuntimes, fallback],
    });
  };

  const fallback = policy.fallbackRuntime;

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-y-auto border-l border-border bg-card p-4"
      data-testid="subagent-policy-panel"
    >
      <h2 className="text-base font-semibold">Subagent policy</h2>

      <div className="mt-5">
        <h3 className="text-sm font-medium">Approved runtimes</h3>
        <p className="text-xs text-muted-foreground">
          Tried in order for every subagent.
        </p>
        <ul className="mt-2 space-y-2" data-testid="approved-runtimes-list">
          {policy.approvedRuntimes.map((runtime, index) => (
            <li
              key={index}
              className="flex items-center gap-1.5 rounded-md border border-border bg-background p-1.5"
              data-testid={`approved-runtime-row-${index}`}
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium">
                {index + 1}
              </span>
              <HarnessSelect
                value={runtime.harness}
                harnesses={approvedHarnessChoices}
                disabled={!interactive}
                onChange={(harness) =>
                  updateApproved(index, { harness, model: "" })
                }
                testId={`approved-runtime-${index}-harness`}
              />
              <RuntimeModelField
                harness={runtime.harness}
                model={runtime.model}
                disabled={!interactive}
                onChange={(model) => updateApproved(index, { model })}
                testIdPrefix={`approved-runtime-${index}`}
              />
              <Badge
                variant="outline"
                className="shrink-0 border-emerald-600/40 text-emerald-700 dark:border-emerald-400/40 dark:text-emerald-400"
              >
                Approved
              </Badge>
              <div className="flex shrink-0 flex-col">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="size-5"
                  disabled={!interactive || index === 0}
                  onClick={() => moveApproved(index, -1)}
                  aria-label={`Move approved runtime ${index + 1} up`}
                  data-testid={`approved-runtime-${index}-up`}
                >
                  <ChevronUp className="size-3" aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="size-5"
                  disabled={
                    !interactive || index === policy.approvedRuntimes.length - 1
                  }
                  onClick={() => moveApproved(index, 1)}
                  aria-label={`Move approved runtime ${index + 1} down`}
                  data-testid={`approved-runtime-${index}-down`}
                >
                  <ChevronDown className="size-3" aria-hidden />
                </Button>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="size-6 shrink-0"
                disabled={!interactive}
                onClick={() => removeApproved(index)}
                aria-label={`Remove approved runtime ${index + 1}`}
                data-testid={`approved-runtime-${index}-remove`}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2 w-full justify-center gap-1.5"
          disabled={
            !interactive ||
            policy.approvedRuntimes.length >= MAX_POLICY_APPROVED_RUNTIMES
          }
          onClick={addApproved}
          data-testid="add-approved-runtime"
        >
          <Plus className="size-3.5" aria-hidden />
          Add approved runtime
        </Button>
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Fallback runtime</h3>
          <Badge
            variant="outline"
            className="border-amber-600/40 text-amber-700 dark:border-amber-400/40 dark:text-amber-400"
          >
            Not approved
          </Badge>
        </div>
        <div
          className="mt-2 flex items-center gap-1.5 rounded-md border border-border bg-background p-1.5"
          data-testid="fallback-runtime-row"
        >
          <HarnessSelect
            value={fallback?.harness ?? ""}
            harnesses={fallbackHarnesses}
            disabled={!interactive}
            onChange={(harness) =>
              onChange({
                ...policy,
                fallbackRuntime: { harness, model: fallback?.model ?? "" },
              })
            }
            testId="fallback-runtime-harness"
          />
          <RuntimeModelField
            harness={fallback?.harness ?? ""}
            model={fallback?.model ?? ""}
            disabled={!interactive || !fallback}
            onChange={(model) =>
              onChange({
                ...policy,
                fallbackRuntime: { harness: fallback?.harness ?? "", model },
              })
            }
            testIdPrefix="fallback-runtime"
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Only after all approved runtimes fail.
        </p>
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <h3 className="text-sm font-medium">Optional modes</h3>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div>
            <Label htmlFor="policy-adversarial-toggle" className="text-sm">
              Adversarial testing
            </Label>
          </div>
          <Switch
            id="policy-adversarial-toggle"
            checked={policy.adversarial.enabled}
            disabled={!interactive}
            onCheckedChange={(enabled) =>
              onChange({
                ...policy,
                adversarial: { ...policy.adversarial, enabled },
              })
            }
            data-testid="adversarial-toggle"
          />
        </div>
        {policy.adversarial.enabled ? (
          <div className="mt-2 flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">
              Maximum iterations
            </Label>
            <div
              className="flex items-center gap-1.5"
              data-testid="adversarial-max-iterations"
            >
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                disabled={
                  !interactive ||
                  policy.adversarial.maxIterations <=
                    MIN_ADVERSARIAL_MAX_ITERATIONS
                }
                onClick={() =>
                  onChange({
                    ...policy,
                    adversarial: {
                      ...policy.adversarial,
                      maxIterations: Math.max(
                        MIN_ADVERSARIAL_MAX_ITERATIONS,
                        policy.adversarial.maxIterations - 1,
                      ),
                    },
                  })
                }
                aria-label="Decrease maximum iterations"
                data-testid="adversarial-max-iterations-decrease"
              >
                <Minus className="size-3.5" aria-hidden />
              </Button>
              <span
                className="w-6 text-center text-sm font-medium"
                data-testid="adversarial-max-iterations-value"
              >
                {policy.adversarial.maxIterations}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                disabled={
                  !interactive ||
                  policy.adversarial.maxIterations >=
                    MAX_ADVERSARIAL_MAX_ITERATIONS
                }
                onClick={() =>
                  onChange({
                    ...policy,
                    adversarial: {
                      ...policy.adversarial,
                      maxIterations: Math.min(
                        MAX_ADVERSARIAL_MAX_ITERATIONS,
                        policy.adversarial.maxIterations + 1,
                      ),
                    },
                  })
                }
                aria-label="Increase maximum iterations"
                data-testid="adversarial-max-iterations-increase"
              >
                <Plus className="size-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        ) : null}
        <p className="mt-1.5 text-xs text-muted-foreground">
          {policy.adversarial.enabled
            ? `Adds test and review subagents at depth 1.`
            : "Adds testing and code review subagents when enabled."}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Label htmlFor="policy-delegate-toggle" className="text-sm">
            Delegate
          </Label>
          <Switch
            id="policy-delegate-toggle"
            checked={policy.delegate}
            disabled={!interactive}
            onCheckedChange={(delegate) => onChange({ ...policy, delegate })}
            data-testid="delegate-toggle"
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {policy.delegate
            ? "The main agent plans and delegates to the enabled nodes instead of doing the work itself."
            : "Single node: the main agent does the work itself."}
        </p>
      </div>

      <p
        className="mt-6 border-t border-border pt-3 text-xs text-muted-foreground"
        data-testid="subagent-policy-summary"
      >
        {summary}
      </p>
      {disabledReason ? (
        <p
          className="mt-2 text-xs text-amber-600 dark:text-amber-400"
          role="status"
        >
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}
