import Anthropic from '@anthropic-ai/sdk'
import { pickClaudeModel, pickClaudeMaxTokens } from './anthropic-config.js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/**
 * Evaluates a side-by-side comparison of Raw Todd vs Beefed-Up Todd and
 * produces a verdict on whether the active learnings helped, hurt, or had
 * no effect — and what to do with them next.
 *
 * @param {object} opts.rawResult       — full analyzeFolder result (no learnings)
 * @param {object} opts.beefedResult    — full analyzeFolder result (with learnings)
 * @param {Array}  opts.activeLearnings — [{ checkType, suggestion, rationale }]
 * @param {string} opts.tenantName
 */
export async function evaluateSideBySide({ rawResult, beefedResult, activeLearnings, tenantName, cheapMode }) {
  const formatFindings = (result, label) => {
    if (!result || result.allClear || !result.findings?.length)
      return `${label}: ALL CLEAR (no findings)`
    return `${label} — ${result.findings.length} finding(s):\n` +
      result.findings.map((f, i) =>
        `  [${i+1}] ${f.checkType} | ${f.severity} | "${f.missingDocument}"\n` +
        `       Comment: ${f.comment}\n` +
        `       Evidence: ${f.evidence}`
      ).join('\n')
  }

  const learningsBlock = (activeLearnings || []).length
    ? activeLearnings.map((l, i) =>
        `  LEARNING ${i+1} [${l.checkType}]: ${l.suggestion}`
      ).join('\n')
    : '  (none — Beefed-Up Todd ran with no active learnings)'

  const prompt = `You are a senior AI evaluation specialist reviewing the results of a controlled experiment.

A commercial real estate document review AI ("Todd") was run twice on the same tenant folder:
- RUN A: Raw Todd — standard baseline, no additional rules
- RUN B: Beefed-Up Todd — same model with the following training learnings injected into the system prompt:

ACTIVE LEARNINGS APPLIED TO RUN B:
${learningsBlock}

TENANT: ${tenantName || 'Unknown'}

${'═'.repeat(60)}
${formatFindings(rawResult, 'RUN A (RAW TODD)')}

${'═'.repeat(60)}
${formatFindings(beefedResult, 'BEEFED-UP TODD')}
${'═'.repeat(60)}

Write a structured verdict report with these exact sections:

VERDICT SUMMARY (1-2 sentences: did Beefed-Up Todd perform better, worse, or the same overall?)

IMPROVEMENTS (findings Beefed-Up caught that Raw missed, or errors Raw made that Beefed-Up avoided):
For each: describe what changed and which learning caused it.

REGRESSIONS (valid findings Raw caught that Beefed-Up dropped, or new false positives Beefed-Up introduced):
For each: describe what regressed and which learning may have caused it.

LEARNING-BY-LEARNING ASSESSMENT:
For each active learning: was it exercised in this folder? Did it help, hurt, or have no observable effect?

RECOMMENDATION FOR EACH LEARNING:
- KEEP: learning clearly helped or was neutral
- REVISE: learning had partial effect or caused a regression — suggest specific rewording
- DISCARD: learning caused clear regression or was irrelevant

OVERALL RECOMMENDATION:
One of: PROMOTE ALL / PROMOTE SOME / HOLD FOR MORE TESTING / DISCARD ALL
With a 1-sentence rationale.

Be direct and specific. This report will be used to decide whether to make these learnings permanent.`

  const cheap = !!cheapMode
  const response = await client.messages.create({
    model:      pickClaudeModel(cheap),
    max_tokens: pickClaudeMaxTokens(cheap, 3000),
    messages:   [{ role: 'user', content: prompt }]
  })

  return response.content[0]?.text || 'Verdict generation failed — no response.'
}

/**
 * "Lazy trainer" — extracts learning rules directly from a Dr. Todd
 * diagnostic report (the 3-run synthesis text). No human annotation needed.
 *
 * @param {string} reportText  — the full synthesis report from synthesizeDrTodd()
 * @param {string} tenantName
 */
export async function extractLearningsFromDrTodd(reportText, tenantName, cheapMode = false) {
  const prompt = `You are a prompt engineering specialist for a commercial real estate document review AI called "Todd."

A diagnostic tool ran 3 independent analyses of the same tenant folder and produced the following consistency report comparing what the AI found vs missed across the 3 runs:

TENANT: ${tenantName}

═══ DR. TODD DIAGNOSTIC REPORT ═══
${reportText}
═══ END REPORT ═══

Your job: extract specific, actionable learning rules from this report that should be added to Todd's system prompt to make future analyses more consistent and accurate.

Focus on:
- Findings that only appeared in 1 or 2 of 3 runs (inconsistency = model uncertainty)
- Root causes identified in the report
- Specific prompt improvements the report recommends

Return ONLY valid JSON — no markdown, no prose outside the JSON:
{
  "summary": "2-3 sentences: what the key inconsistencies were and what type of learning this generated",
  "learnings": [
    {
      "checkType": "EXECUTION|EXHIBIT|CURRENCY|REFERENCED_DOC|AMENDMENT_GAP|MISSING_PAGE|LEGIBILITY|SPECIAL_AGREEMENT|GUARANTY|NAME_MISMATCH|GENERAL",
      "suggestion": "The exact instruction text to add to the AI prompt. Write as a direct rule starting with a verb. Be specific and actionable.",
      "confidence": "HIGH|MEDIUM|LOW",
      "rationale": "1 sentence: which part of the diagnostic report supports this learning"
    }
  ]
}

RULES:
- Maximum 6 learnings
- Only extract learnings directly evidenced in the report
- HIGH = report explicitly called this out as a clear problem; MEDIUM = pattern mentioned; LOW = implied or minor
- Each suggestion must be a concrete, narrow instruction — not vague ("be more careful")
- Prefer rules that would prevent inconsistency across multiple runs`

  const cheap = !!cheapMode
  const response = await client.messages.create({
    model: pickClaudeModel(cheap),
    max_tokens: pickClaudeMaxTokens(cheap, 2000),
    messages: [{ role: 'user', content: prompt }]
  })

  const text = response.content[0]?.text || '{}'
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const jsonStart = cleaned.indexOf('{')
  if (jsonStart > 0) cleaned = cleaned.substring(jsonStart)

  try {
    const parsed = JSON.parse(cleaned)
    return { learnings: parsed.learnings || [], summary: parsed.summary || 'Learnings extracted.' }
  } catch {
    return { learnings: [], summary: 'Could not parse trainer response — report was saved.' }
  }
}

/**
 * Compiles human reviewer feedback into conservative prompt learnings.
 * @param {object} opts
 * @param {object} opts.tenant     - { tenantName, folderName }
 * @param {Array}  opts.findings   - original findings with ids
 * @param {Array}  opts.feedbacks  - [{ findingId, verdict: 'correct'|'wrong'|'partial', comment }]
 * @param {Array}  opts.annotations - [{ docName, pageNum, comment }] — things model missed
 */
export async function compileWorkoutFeedback({ tenant, findings, feedbacks, annotations, cheapMode }) {
  const wrongFeedbacks = (feedbacks || []).filter(fb => fb.verdict !== 'correct')
  const anns = annotations || []

  if (wrongFeedbacks.length === 0 && anns.length === 0) {
    return { learnings: [], summary: 'All findings were correct — no learnings needed. Great job Todd!' }
  }

  let feedbackText = `TENANT: ${tenant.tenantName}\nFOLDER: ${tenant.folderName}\n\n`

  if (wrongFeedbacks.length > 0) {
    feedbackText += `═══ FINDINGS THE MODEL GOT WRONG ═══\n\n`
    for (const fb of wrongFeedbacks) {
      const finding = (findings || []).find(f => f.id === fb.findingId)
      if (!finding) continue
      feedbackText += `FINDING TYPE: ${finding.checkType}\n`
      feedbackText += `MODEL FLAGGED: "${finding.missingDocument}"\n`
      feedbackText += `MODEL EVIDENCE: ${finding.evidence}\n`
      feedbackText += `REVIEWER VERDICT: ${fb.verdict === 'wrong' ? 'WRONG — not actually an issue' : 'PARTIAL — only partially correct'}\n`
      if (fb.comment) feedbackText += `REVIEWER EXPLANATION: ${fb.comment}\n`
      feedbackText += '\n'
    }
  }

  if (anns.length > 0) {
    feedbackText += `═══ THINGS THE MODEL MISSED ═══\n\n`
    for (const ann of anns) {
      feedbackText += `DOCUMENT: ${ann.docName}, Page ${ann.pageNum || 'unknown'}\n`
      feedbackText += `REVIEWER NOTE: ${ann.comment}\n\n`
    }
  }

  const correctCount = (feedbacks || []).filter(fb => fb.verdict === 'correct').length
  feedbackText += `═══ SUMMARY ═══\n`
  feedbackText += `${correctCount} correct, ${wrongFeedbacks.length} wrong/partial, ${anns.length} missed.\n`

  const prompt = `You are a prompt engineering specialist for a commercial real estate document review AI. A human expert has reviewed the AI's findings on a tenant folder and provided corrections.

${feedbackText}

Analyze this feedback and generate conservative, specific learning rules to improve future AI performance.

Return ONLY valid JSON — no markdown, no prose outside the JSON:
{
  "summary": "2-3 sentences: what went wrong and the pattern behind it",
  "learnings": [
    {
      "checkType": "EXECUTION|EXHIBIT|CURRENCY|REFERENCED_DOC|AMENDMENT_GAP|MISSING_PAGE|LEGIBILITY|SPECIAL_AGREEMENT|GUARANTY|NAME_MISMATCH|GENERAL",
      "suggestion": "The exact instruction text to inject into the AI prompt. Write as a direct rule starting with a verb. Be specific — not vague.",
      "confidence": "HIGH|MEDIUM|LOW",
      "rationale": "1 sentence: why this learning is warranted by the feedback"
    }
  ]
}

GENERATION RULES:
- Maximum 5 learnings per session
- Only generate learnings clearly supported by the reviewer feedback
- Each suggestion must be actionable and specific (not "be more careful")
- Do not contradict existing rules about reading all pages thoroughly
- HIGH = clearly proven by feedback; MEDIUM = plausible pattern; LOW = single data point
- If reviewer said something is wrong but gave no explanation, set confidence LOW
- Prefer narrowly scoped rules over broad ones`

  const cheap = !!cheapMode
  const response = await client.messages.create({
    model: pickClaudeModel(cheap),
    max_tokens: pickClaudeMaxTokens(cheap, 2000),
    messages: [{ role: 'user', content: prompt }]
  })

  const text = response.content[0]?.text || '{}'
  let cleaned = text.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const jsonStart = cleaned.indexOf('{')
  if (jsonStart > 0) cleaned = cleaned.substring(jsonStart)

  try {
    const parsed = JSON.parse(cleaned)
    return {
      learnings: parsed.learnings || [],
      summary: parsed.summary || 'Feedback compiled.'
    }
  } catch {
    return { learnings: [], summary: 'Could not parse trainer response — feedback was recorded.' }
  }
}
