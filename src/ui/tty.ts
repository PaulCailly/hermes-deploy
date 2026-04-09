/**
 * Decide whether to use the Ink reporter or fall back to the plain
 * stdout reporter. Ink only makes sense when stdout is a TTY (no point
 * sending escape sequences to a pipe or a CI log). The user can also
 * force-disable Ink with --no-ink (parsed by commander) or the
 * HERMES_DEPLOY_NO_INK env var (useful in CI scripts that want
 * deterministic output without touching argv).
 */
export function shouldUseInk(): boolean {
  if (process.env.HERMES_DEPLOY_NO_INK === '1') return false;
  if (process.argv.includes('--no-ink')) return false;
  return process.stdout.isTTY === true;
}
