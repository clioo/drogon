// MIT Copyright (c) 2026 Lovecast Inc. Ported verbatim from
// src/renderer/src/components/terminal-pane/terminal-pty-input-transaction.ts.
// `ptyId` is a Drogon session id here; the serialization guarantee is the
// source's: one paste transaction at a time per PTY.

const transactionTails = new Map<string, Promise<void>>()

export async function runTerminalPtyInputTransaction<T>(
  ptyId: string | null | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!ptyId) {
    return await operation()
  }

  const previous = transactionTails.get(ptyId)
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  transactionTails.set(ptyId, current)

  if (previous) {
    await previous
  }
  try {
    return await operation()
  } finally {
    release()
    if (transactionTails.get(ptyId) === current) {
      transactionTails.delete(ptyId)
    }
  }
}
