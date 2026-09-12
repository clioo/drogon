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

/** Dispatches the open-session turn, or `null` when the bridge has no
 *  `botRun` (capability withheld) so the caller reports an honest error
 *  instead of a silent no-op. A skew refusal (daemon older than the
 *  `interactive` field this build sends — install-resilience P4) is
 *  classified HERE, the single choke point for both entry points, so the
 *  user is directed to restart the service instead of reading the raw
 *  serde text. */
export async function dispatchOpenBotSession(input: {
  bridge?: Pick<BotBridge, "botRun">;
  scope: BotScope & { locale: string };
  bot: BotsPanelBot;
  requestId: string;
  resume?: boolean;
}): Promise<Result<BotRunReceipt> | null> {
  const botRun = input.bridge?.botRun;
  if (!botRun) return null;
  const result = await botRun(buildOpenBotSessionTurn(input));
  if (!result.ok) {
    const skewMessage = daemonSkewRefusalMessage(result.error);
    if (skewMessage)
      return {
        ok: false,
        error: { ...result.error, message: skewMessage },
      };
  }
  return result;
}
