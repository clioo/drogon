// Settings → Demo: runs the whole reproducible chain from inside the app and
// walks the viewer through it, moving the focus to whatever is changing right
// now. Built for a screen recording: one control to start, then every step
// shows what the daemon reported, and nothing on screen is a placeholder.

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleDashed, CircleDot, Play, XCircle } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { SettingsRow, SettingsSubsectionHeader } from "../SettingsFormControls";
import { SettingsSection } from "../SettingsSection";
import {
  DEFAULT_REPRO_ITERATIONS,
  DEFAULT_REPRO_RUNTIME,
  REPRO_ITERATION_CHOICES,
  REPRO_PHASES,
  REPRO_RUNTIME_CHOICES,
  describeReproCost,
  describeWorkflowStatus,
  formatReproCost,
  type ReproPhaseId,
  type ReproPhaseState,
} from "./repro-demo-plan";
import { requestReproTour } from "../../../repro-demo-tour";
import { useReproDemo, type ReproDemoBridge } from "./use-repro-demo";

/** The bridges the demo needs, gathered from the frozen `window.drogon`
 *  namespaces. A build whose preload predates any of them reports the demo as
 *  unavailable instead of failing when someone presses the button. */
export function windowReproBridge(): ReproDemoBridge | null {
  try {
    const drogon = (window as unknown as { drogon?: Record<string, unknown> }).drogon;
    if (!drogon) return null;
    const graph = drogon.graph as Record<string, unknown> | undefined;
    const project = drogon.project as Record<string, unknown> | undefined;
    const needed = {
      status: drogon.status,
      quickSessionCreate: project?.quickSessionCreate,
      fileWrite: drogon.fileWrite,
      botCreate: drogon.botCreate,
      botMonitorCreate: drogon.botMonitorCreate,
      botMonitorApprove: drogon.botMonitorApprove,
      botMonitorList: drogon.botMonitorList,
      graphWritePolicy: graph?.graphWritePolicy,
      graphOrchestratorStart: graph?.graphOrchestratorStart,
      graphOrchestratorStatus: graph?.graphOrchestratorStatus,
      graphObservabilityStatus: graph?.graphObservabilityStatus,
    };
    if (Object.values(needed).some((value) => typeof value !== "function")) return null;
    return {
      status: () => (needed.status as () => Promise<never>)(),
      quickSessionCreate: (input) =>
        (needed.quickSessionCreate as (value: unknown) => Promise<never>)(input),
      fileWrite: (input) => (needed.fileWrite as (value: unknown) => Promise<never>)(input),
      botCreate: (input) => (needed.botCreate as (value: unknown) => Promise<never>)(input),
      botMonitorCreate: (input) =>
        (needed.botMonitorCreate as (value: unknown) => Promise<never>)(input),
      botMonitorApprove: (input) =>
        (needed.botMonitorApprove as (value: unknown) => Promise<never>)(input),
      botMonitorList: (input) =>
        (needed.botMonitorList as (value: unknown) => Promise<never>)(input),
      graphWritePolicy: (input) =>
        (needed.graphWritePolicy as (value: unknown) => Promise<never>)(input),
      graphOrchestratorStart: (input) =>
        (needed.graphOrchestratorStart as (value: unknown) => Promise<never>)(input),
      graphOrchestratorStatus: (input) =>
        (needed.graphOrchestratorStatus as (value: unknown) => Promise<never>)(input),
      graphObservabilityStatus: (input) =>
        (needed.graphObservabilityStatus as (value: unknown) => Promise<never>)(input),
    } as ReproDemoBridge;
  } catch {
    return null;
  }
}

function PhaseIcon({ status }: { status: ReproPhaseState["status"] }): React.JSX.Element {
  if (status === "done")
    return <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />;
  if (status === "failed") return <XCircle className="size-4 text-destructive" aria-hidden />;
  if (status === "running")
    return <CircleDot className="size-4 animate-pulse text-primary" aria-hidden />;
  return <CircleDashed className="size-4 text-muted-foreground" aria-hidden />;
}

/** Scrolls its child into view whenever it becomes the focused widget, so a
 *  viewer's eye follows the run without anyone touching the mouse. Respects
 *  the OS reduced-motion preference. */
function Spotlight({
  active,
  children,
  testId,
}: {
  active: boolean;
  children: React.ReactNode;
  testId: string;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    // `scrollIntoView` is absent in some embedders (jsdom included): the ring
    // is the focus signal, and scrolling is the enhancement.
    if (!active || !element || typeof element.scrollIntoView !== "function") return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "nearest",
    });
  }, [active]);
  return (
    <div
      ref={ref}
      data-testid={testId}
      data-spotlight={active ? "on" : "off"}
      className={[
        "rounded-lg transition-shadow",
        active ? "ring-2 ring-primary/70 ring-offset-2 ring-offset-background" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

/** A round's own verdict, in the product's badge grammar plus the semantic
 *  colour the Evidence tab already uses: pass is green, findings amber, and
 *  anything else stays neutral rather than being dressed as either. */
function VerdictBadge({
  verdict,
  status,
}: {
  verdict: string | null;
  status: string;
}): React.JSX.Element {
  const tone =
    verdict === "pass"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : verdict === "findings"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "border-border/50 bg-background/50 text-foreground/80";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${tone}`}
    >
      {verdict ?? status}
    </span>
  );
}

export function ReproDemoSection({
  bridge,
}: {
  bridge?: ReproDemoBridge | null;
}): React.JSX.Element {
  const resolved = useMemo(
    () => (bridge === undefined ? windowReproBridge() : bridge),
    [bridge],
  );
  const { state, run, cancel } = useReproDemo(resolved);
  // Reopening the panel after the tour must show what RAN, not the defaults:
  // the store remembers the selection across the unmount the tour causes.
  const [runtimeId, setRuntimeId] = useState(
    state.selection?.runtimeId ?? DEFAULT_REPRO_RUNTIME.id,
  );
  const [model, setModel] = useState(state.selection?.model ?? DEFAULT_REPRO_RUNTIME.model);
  const [iterations, setIterations] = useState<number>(
    state.selection?.iterations ?? DEFAULT_REPRO_ITERATIONS,
  );

  const choice = REPRO_RUNTIME_CHOICES.find((entry) => entry.id === runtimeId) ?? DEFAULT_REPRO_RUNTIME;
  const runtime = { ...choice, model: model.trim() };
  const spotlightFor = (id: ReproPhaseId) => state.spotlight === id;

  return (
    <SettingsSection
      id="demo"
      title="Demo reproducible"
      description="Corré la cadena completa con un clic: un bot con un monitor sobre el spec, el cambio que lo despierta, las rondas adversariales del Work Graph, y la evidencia y el costo de lo que corrió. Todo pasa en un workspace desechable que la demo crea para sí misma, y cuando empiezan las rondas Drogon te lleva a verlas en el Work Graph."
    >
      <div className="space-y-6">
        <SettingsSubsectionHeader
          title="Qué corre"
          description="Elegí el harness y el modelo. El modelo local es gratis: no factura nada, y es el que usamos para probar."
        />

        <SettingsRow
          label="Runtime"
          description={choice.note}
          control={
            <select
              id="repro-demo-runtime"
              data-testid="repro-demo-runtime"
              className="h-9 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm"
              value={runtimeId}
              disabled={state.running}
              onChange={(event) => {
                const next =
                  REPRO_RUNTIME_CHOICES.find((entry) => entry.id === event.target.value) ??
                  DEFAULT_REPRO_RUNTIME;
                setRuntimeId(next.id);
                setModel(next.model);
              }}
            >
              {REPRO_RUNTIME_CHOICES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                  {entry.free ? " — gratis" : ""}
                </option>
              ))}
            </select>
          }
        />

        <SettingsRow
          label="Modelo exacto"
          description="El id exacto que el harness recibe. Drogon nunca adivina un modelo ni un proveedor."
          control={
            <input
              id="repro-demo-model"
              data-testid="repro-demo-model"
              className="h-9 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm font-mono"
              value={model}
              disabled={state.running}
              placeholder="por defecto del harness"
              onChange={(event) => setModel(event.target.value)}
            />
          }
        />

        <SettingsRow
          label="Tope de rondas"
          description="Cuántas veces se permite romper y corregir antes de parar. El tope es una válvula de tiempo, no de gasto."
          control={
            <div className="flex gap-2">
              {REPRO_ITERATION_CHOICES.map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={iterations === value ? "default" : "outline"}
                  disabled={state.running}
                  onClick={() => setIterations(value)}
                >
                  {value}
                </Button>
              ))}
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            data-testid="repro-demo-run"
            disabled={state.running || !resolved}
            onClick={() => void run({ runtime, iterations })}
          >
            <Play className="mr-2 size-4" aria-hidden />
            {state.running ? "Corriendo…" : "Correr demo"}
          </Button>
          {state.running ? (
            <Button type="button" variant="outline" size="sm" onClick={cancel}>
              Cancelar
            </Button>
          ) : null}
          {!resolved ? (
            <span className="text-sm text-muted-foreground">
              Esta build no expone todos los canales que la demo necesita.
            </span>
          ) : null}
          {state.workflowId ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="repro-demo-show-orchestration"
              onClick={() => {
                if (!state.workspaceId) return;
                requestReproTour({ kind: "open-work-graph", workspaceId: state.workspaceId });
                requestReproTour({ kind: "focus-view", view: "graph" });
              }}
            >
              Ver la orquestación
            </Button>
          ) : null}
          {state.projectName ? (
            <span
              data-testid="repro-demo-run-name"
              className="rounded-md border border-border/60 px-2 py-1 font-mono text-xs"
              title={state.workspaceId ?? undefined}
            >
              {state.projectName}
            </span>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          Al empezar las rondas, Drogon abre el Work Graph de esta corrida y va
          moviendo su vista — grafo, evidencia y uso — conforme cambian. Volvé a
          Settings cuando quieras: el panel conserva el estado de la corrida.
        </p>

        <Spotlight active={state.spotlight !== null && state.running} testId="repro-demo-phases">
          <ol className="space-y-1" data-testid="repro-demo-phase-list">
            {REPRO_PHASES.map((phase) => {
              const item = state.phases[phase.id];
              return (
                <li
                  key={phase.id}
                  data-testid={`repro-demo-phase-${phase.id}`}
                  data-status={item.status}
                  className={[
                    "flex items-start gap-3 rounded-md px-3 py-2",
                    spotlightFor(phase.id) ? "bg-primary/5" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <PhaseIcon status={item.status} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{phase.title}</span>
                      {item.note ? (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {item.note}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{phase.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Spotlight>

        {state.checks.length > 0 ? (
          <Spotlight active={spotlightFor("firing") || spotlightFor("spec")} testId="repro-demo-checks">
            <div className="space-y-2">
              <SettingsSubsectionHeader
                title="Chequeos del monitor"
                description="Cada chequeo es del daemon, no de esta pantalla."
              />
              <ul className="space-y-1 font-mono text-xs text-muted-foreground">
                {state.checks.map((check, index) => (
                  <li key={`${check.outcome}-${check.eventId ?? index}`}>
                    {check.outcome}
                    {check.eventId ? ` · evento ${check.eventId}` : ""}
                    {check.firing ? ` · disparo ${check.firing}` : ""}
                    {check.error ? ` · ${check.error}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          </Spotlight>
        ) : null}

        {state.rounds.length > 0 ? (
          <Spotlight active={spotlightFor("rounds")} testId="repro-demo-rounds">
            <div className="space-y-2">
              <SettingsSubsectionHeader
                title="Rondas"
                description={describeWorkflowStatus(state.workflowStatus ?? undefined)}
              />
              <ul className="space-y-1">
                {state.rounds.map((round) => (
                  <li
                    key={round.iteration + round.phase + (round.runtime ?? "")}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      ronda {round.iteration}
                    </span>
                    <span className="w-16 text-sm">{round.phase}</span>
                    <VerdictBadge verdict={round.verdict} status={round.status} />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {round.runtime ?? "—"}
                      {round.isFallback ? " (fallback)" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Spotlight>
        ) : null}

        {state.evidence.length > 0 || state.cost ? (
          <Spotlight active={spotlightFor("evidence")} testId="repro-demo-evidence">
            <div className="space-y-4">
              <SettingsSubsectionHeader
                title="Evidencia y costo"
                description="Los mismos ledgers que viven en .drogon/ y se leen sin Drogon."
              />
              <ul className="space-y-2">
                {state.evidence.map((entry) => (
                  <li key={entry.id} className="text-sm">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {entry.role ?? "—"}
                    </span>{" "}
                    {entry.summary}
                  </li>
                ))}
              </ul>
              {state.cost ? (
                <div
                  data-testid="repro-demo-cost"
                  className="rounded-lg border border-border/60 bg-background px-4 py-3"
                >
                  <div className="text-lg font-semibold tabular-nums">
                    {formatReproCost(state.cost)}
                  </div>
                  <p className="text-xs text-muted-foreground">{describeReproCost(state.cost)}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {state.cost.inputTokens ?? "—"} in · {state.cost.outputTokens ?? "—"} out
                  </p>
                </div>
              ) : null}
            </div>
          </Spotlight>
        ) : null}

        {state.releasedBy ? (
          <p className="text-xs text-muted-foreground" data-testid="repro-demo-release">
            Liberado por{" "}
            {state.releasedBy === "monitor"
              ? "el monitor del bot"
              : "esta pantalla (el monitor no liberó el trabajo)"}
            {state.releaseNote ? ` · ${state.releaseNote}` : ""}
          </p>
        ) : null}

        {state.failure ? (
          <p className="text-sm text-destructive" data-testid="repro-demo-failure">
            {state.failure}
          </p>
        ) : null}
      </div>
    </SettingsSection>
  );
}
