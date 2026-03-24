/** Sonnet = production quality; Haiku = lowest-cost tier for local / feature testing. */
export const MODEL_SONNET = 'claude-sonnet-4-6'
export const MODEL_CHEAP = 'claude-3-5-haiku-20241022'

export function pickClaudeModel(cheapMode) {
  return cheapMode ? MODEL_CHEAP : MODEL_SONNET
}

export function pickClaudeMaxTokens(cheapMode, fullMax) {
  if (!cheapMode) return fullMax
  return Math.min(fullMax, 8192)
}
