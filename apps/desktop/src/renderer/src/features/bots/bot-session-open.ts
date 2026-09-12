// MIT Copyright (c) 2026 Lovecast Inc.
//
// One shared builder/dispatcher for the Bot "open session" turn
// (bug-bot-a836b4ebf8be65505, refined by task_e7c183ebc637). Both the Bots
// page controller and the app shell's sidebar open the SAME kind of turn:
// `interactive: true`, NO `prompt` (the wire contract rejects a prompt
// alongside interactive), carrying the Bot's stored harness overrides. This
// module owns the shape so the two entry points can never drift.
import type { Result } from "../../../../shared/session-contract";
import type {
  BotBridge,
  BotRunReceipt,
  BotRunTurnInput,
  BotScope,
  BotsPanelBot,
} from "./bots-panel-contracts";
import { buildBotRunHarness } from "./bots-page-model";
import { daemonSkewRefusalMessage } from "../../daemon-capabilities";

/** The exact `bot.run` input for an open-session dispatch. `resume`
 *  (Defect 2) is set only when the Bot's recorded session is known to have
 *  exited and the harness can reopen its own conversation; it is never set
 *  on a first open. */
export function buildOpenBotSessionTurn(input: {
  scope: BotScope & { locale: string };
  bot: BotsPanelBot;
  requestId: string;
  resume?: boolean;
}): BotRunTurnInput {
  return {
    ...input.scope,
    requestId: input.requestId,
    botId: input.bot.id,
    interactive: true,
    ...(input.resume ? { resume: true } : {}),
    harness: buildBotRunHarness(
      input.bot.harnessPolicy.defaultHarness,
      input.bot.harnessPolicy.explicitModel,
    ),
  };
}

/** The in-flight open-session dispatches, keyed PER BOT (the adversarial
 *  report: "two surfaces, one Bot, two sessions"). The old guard was
 *  per-surface (each caller's own `busy` flag), so the Bots page's "Open
 *  session" button and the sidebar Chats row clicking in the same tick on
 *  an `unverifiable` Bot session each dispatched their own turn and the
 *  Bot ended up with 2 live sessions. Keying the guard on the Bot makes
 *  ANY pair of surfaces racing for the same Bot resolve to ONE dispatch;
 *  the loser joins the winner's promise and observes the same receipt
 *  (the one live session) instead of opening a second tab. The entry
 *  clears when the dispatch settles, so a deliberate later open still
 *  dispatches. Keyed by host + Bot id: a Bot belongs to exactly one host. */
const inFlightOpenDispatches = new Map<
  string,
  Promise<Result<BotRunReceipt>>
>();

/** Dispatches the open-session turn, or `null` when the bridge has no
 *  `botRun` (capability withheld) so the caller reports an honest error
 *  instead of a silent no-op. A skew refusal (daemon older than the
 *  `interactive` field this build sends — install-resilience P4) is
 *  classified HERE, the single choke point for both entry points, so the
 *  user is directed to restart the service instead of reading the raw
 *  serde text. Deliberately NOT an `async` function: a racing second
 *  caller for the SAME Bot must receive the winner's identical promise
 *  (it joins the one dispatch), and `async` would wrap it in a fresh
 *  promise object each call. */
export function dispatchOpenBotSession(input: {
  bridge?: Pick<BotBridge, "botRun">;
  scope: BotScope & { locale: string };
  bot: BotsPanelBot;
  requestId: string;
  resume?: boolean;
}): Promise<Result<BotRunReceipt> | null> {
  const botRun = input.bridge?.botRun;
  if (!botRun) return Promise.resolve(null);
  const key = `${input.scope.hostId}:${input.bot.id}`;
  const inFlight = inFlightOpenDispatches.get(key);
  if (inFlight) return inFlight;
  // The dispatch starts synchronously (both racing surfaces observe the
  // one in-flight turn within the same tick); a synchronously-throwing
  // bridge still lands in the same guarded promise as a rejection. The
  // skew classification rides the winner's promise, so a joined surface
  // observes the same honest refusal.
  let turn: Promise<Result<BotRunReceipt>>;
  try {
    turn = Promise.resolve(botRun(buildOpenBotSessionTurn(input)));
  } catch (error) {
    turn = Promise.reject(error);
  }
  const dispatch = turn.then((result) => {
    if (!result.ok) {
      const skewMessage = daemonSkewRefusalMessage(result.error);
      if (skewMessage)
        return {
          ok: false as const,
          error: { ...result.error, message: skewMessage },
        };
    }
    return result;
  });
  const guarded = dispatch.finally(() => {
    inFlightOpenDispatches.delete(key);
  });
  inFlightOpenDispatches.set(key, guarded);
  return guarded;
}
