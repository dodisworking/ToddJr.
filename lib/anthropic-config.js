/** Sonnet = production quality; Haiku = cheap / dumb mode (3.5 Haiku snapshot was retired — use Haiku 4.5). */
export const MODEL_SONNET = 'claude-sonnet-4-6'
export const MODEL_CHEAP = 'claude-haiku-4-5'

export function pickClaudeModel(cheapMode) {
  return cheapMode ? MODEL_CHEAP : MODEL_SONNET
}

export function pickClaudeMaxTokens(cheapMode, fullMax) {
  return fullMax  // always use full max — truncation is worse than token cost
}
