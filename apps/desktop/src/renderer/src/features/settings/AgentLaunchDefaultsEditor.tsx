// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from src/renderer/src/components/settings/AgentLaunchDefaultsEditor.tsx; Drogon data adapter.
import { useId, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { cn } from "../../lib/utils";
import {
  parseAgentDefaultEnvDraft,
  stringifyAgentDefaultEnvDraft,
} from "./agent-default-env-draft";

export function AgentCommandOverrideInput({
  defaultCmd,
  cmdOverride,
  onSaveOverride,
}: {
  defaultCmd: string;
  cmdOverride: string | undefined;
  onSaveOverride: (value: string) => void;
}): React.JSX.Element {
  const draftSeed = cmdOverride ?? defaultCmd;
  const [cmdDraft, setCmdDraft] = useState(draftSeed);
  const cancelled = useRef(false);
  const commitCmd = (): void => {
    const trimmed = cmdDraft.trim();
    if (!trimmed || trimmed === defaultCmd) {
      onSaveOverride("");
      setCmdDraft(defaultCmd);
    } else {
      onSaveOverride(trimmed);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{"Command"}</span>
      <div className="flex items-center gap-2">
        <Input
          aria-label="Command"
          value={cmdDraft}
          onChange={(event) => setCmdDraft(event.target.value)}
          onBlur={() => {
            if (!cancelled.current) commitCmd();
            cancelled.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.stopPropagation();
              cancelled.current = true;
              setCmdDraft(draftSeed);
              event.currentTarget.blur();
            }
          }}
          placeholder={defaultCmd}
          spellCheck={false}
          className="h-7 flex-1 font-mono text-xs"
        />
        {cmdOverride && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              onSaveOverride("");
              setCmdDraft(defaultCmd);
            }}
            className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            {"Reset"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function AgentDefaultArgsInput({
  defaultArgs,
  argsOverride,
  onSaveArgs,
}: {
  defaultArgs: string;
  argsOverride: string;
  onSaveArgs: (value: string) => void;
}): React.JSX.Element {
  const [argsDraft, setArgsDraft] = useState(argsOverride);
  const cancelled = useRef(false);
  const commitArgs = (): void => onSaveArgs(argsDraft.trim());

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{"Arguments"}</span>
      <div className="flex items-center gap-2">
        <Input
          aria-label="Arguments"
          value={argsDraft}
          onChange={(event) => setArgsDraft(event.target.value)}
          onBlur={() => {
            if (!cancelled.current) commitArgs();
            cancelled.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.stopPropagation();
              cancelled.current = true;
              setArgsDraft(argsOverride);
              event.currentTarget.blur();
            }
          }}
          placeholder={defaultArgs || "No default arguments"}
          spellCheck={false}
          className="h-7 flex-1 font-mono text-xs"
        />
        {argsOverride !== defaultArgs && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              onSaveArgs(defaultArgs);
              setArgsDraft(defaultArgs);
            }}
            className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            {"Reset"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function AgentDefaultEnvInput({
  defaultEnv,
  envOverride,
  onSaveEnv,
}: {
  defaultEnv: Record<string, string>;
  envOverride: Record<string, string>;
  onSaveEnv: (value: Record<string, string>) => void;
}): React.JSX.Element {
  const defaultEnvText = stringifyAgentDefaultEnvDraft(defaultEnv);
  const draftSeed = stringifyAgentDefaultEnvDraft(envOverride);
  const [envDraft, setEnvDraft] = useState(draftSeed);
  const cancelled = useRef(false);
  const [envDraftTooLarge, setEnvDraftTooLarge] = useState(false);
  const envDraftErrorId = useId();
  const commitEnv = (): void => {
    const parsedDraft = parseAgentDefaultEnvDraft(envDraft);
    setEnvDraftTooLarge(parsedDraft.tooLarge);
    if (!parsedDraft.tooLarge) {
      onSaveEnv(parsedDraft.env);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{"Environment"}</span>
      <div className="flex items-center gap-2">
        <Input
          aria-label="Environment"
          value={envDraft}
          onChange={(event) => {
            setEnvDraft(event.target.value);
            if (envDraftTooLarge) {
              setEnvDraftTooLarge(false);
            }
          }}
          onBlur={() => {
            if (!cancelled.current) commitEnv();
            cancelled.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.stopPropagation();
              cancelled.current = true;
              setEnvDraft(draftSeed);
              setEnvDraftTooLarge(false);
              event.currentTarget.blur();
            }
          }}
          placeholder={defaultEnvText || "No default environment"}
          spellCheck={false}
          aria-invalid={envDraftTooLarge || undefined}
          aria-describedby={envDraftTooLarge ? envDraftErrorId : undefined}
          className={cn(
            "h-7 flex-1 font-mono text-xs",
            envDraftTooLarge && "border-destructive/50 bg-destructive/5",
          )}
        />
        {draftSeed !== defaultEnvText && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              onSaveEnv(defaultEnv);
              setEnvDraft(defaultEnvText);
              setEnvDraftTooLarge(false);
            }}
            className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            {"Reset"}
          </Button>
        )}
      </div>
      {envDraftTooLarge && (
        <p id={envDraftErrorId} className="mt-1 text-[11px] text-destructive">
          {"Environment text is too large to parse safely."}
        </p>
      )}
    </div>
  );
}
