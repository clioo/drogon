// MIT Copyright (c) 2026 Lovecast Inc.
// First-known prompt + manual-title precedence from store/slices/agent-generated-tab-title.
import { useEffect, useState } from "react";
import type { Session } from "../../../../shared/session-contract";
import { deriveGeneratedTabTitle } from "../../../../shared/agent-tab-title";
import { useAgentSettings } from "./agent-settings-state";
const KEY = "drogon:agent-generated-titles:v1";
export function addGeneratedTitles(
  previous: Record<string, string>,
  sessions: Session[],
  enabled: boolean,
): Record<string, string> {
  if (!enabled) return previous;
  let next = previous;
  for (const session of sessions) {
    if (next[session.id] || !session.agentPromptPreview) continue;
    const title = deriveGeneratedTabTitle(session.agentPromptPreview);
    if (title) next = { ...next, [session.id]: title };
  }
  return next;
}
function readTitles(): Record<string, string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored))
      return {};
    return Object.fromEntries(
      Object.entries(stored)
        .filter(
          ([key, value]) =>
            key.length <= 128 &&
            typeof value === "string" &&
            value.length <= 40,
        )
        .slice(-1024),
    );
  } catch {
    return {};
  }
}
export function useGeneratedAgentTitles(
  sessions: Session[],
): Record<string, string> {
  const { settings } = useAgentSettings();
  const [titles, setTitles] = useState(readTitles);
  useEffect(() => {
    const next = addGeneratedTitles(
      titles,
      sessions,
      settings.tabAutoGenerateTitle,
    );
    if (next === titles) return;
    setTitles(next);
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify(
          Object.fromEntries(
            Object.entries({ ...readTitles(), ...next }).slice(-1024),
          ),
        ),
      );
    } catch {
      /* In-memory names still work. */
    }
  }, [sessions, settings.tabAutoGenerateTitle, titles]);
  return titles;
}
