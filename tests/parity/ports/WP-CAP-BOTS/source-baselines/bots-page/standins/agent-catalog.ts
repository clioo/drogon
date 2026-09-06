export function getAgentLabel(agent: string): string {
  if (agent === 'codex') return 'Codex'
  throw new Error(`capsule catalog stand-in received unreviewed agent: ${agent}`)
}
