/** Sonnet = production quality; Haiku = cheap / dumb mode (3.5 Haiku snapshot was retired — use Haiku 4.5). */
export const MODEL_SONNET = 'claude-sonnet-4-6'
export const MODEL_CHEAP = 'claude-haiku-4-5'
/** Opus = top-tier reasoning, used by TP3 for the universal document verifier and senior-lawyer self-review pass. */
export const MODEL_OPUS = 'claude-opus-4-7'

export function pickClaudeModel(cheapMode) {
  return cheapMode ? MODEL_CHEAP : MODEL_SONNET
}

export function pickClaudeMaxTokens(cheapMode, fullMax) {
  if (!cheapMode) return fullMax
  return Math.min(fullMax, 8192)
}
