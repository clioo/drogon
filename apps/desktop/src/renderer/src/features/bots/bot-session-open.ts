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

/** The exact `bot.run` input for an open-session dispatch. */
export function buildOpenBotSessionTurn(input: {
  scope: BotScope & { locale: string };
  bot: BotsPanelBot;
  requestId: string;
}): BotRunTurnInput {
  return {
    ...input.scope,
    requestId: input.requestId,
    botId: input.bot.id,
    interactive: true,
    harness: buildBotRunHarness(
      input.bot.harnessPolicy.defaultHarness,
      input.bot.harnessPolicy.explicitModel,
    ),
  };
}

/** Dispatches the open-session turn, or `null` when the bridge has no
 *  `botRun` (capability withheld) so the caller reports an honest error
 *  instead of a silent no-op. */
export async function dispatchOpenBotSession(input: {
  bridge?: Pick<BotBridge, "botRun">;
  scope: BotScope & { locale: string };
  bot: BotsPanelBot;
  requestId: string;
}): Promise<Result<BotRunReceipt> | null> {
  const botRun = input.bridge?.botRun;
  if (!botRun) return null;
  return botRun(buildOpenBotSessionTurn(input));
}
