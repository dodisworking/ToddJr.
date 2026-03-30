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
export async function evaluateSideBySide({ rawResult, beefedResult, activeLearnings, tenantName, cheapMode, mode }) {
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

  // ── Double Check mode: two independent passes, no learnings ──────────
  if (mode === 'doublecheck') {
    const prompt = `You are a senior commercial real estate paralegal QA reviewer. Two independent AI analysts ("Pass A" and "Pass B") reviewed the same tenant folder separately with no communication. Your job is to compare what they each found and assess consistency.

TENANT: ${tenantName || 'Unknown'}

${'═'.repeat(60)}
${formatFindings(rawResult, 'PASS A (FIRST ANALYST)')}

${'═'.repeat(60)}
${formatFindings(beefedResult, 'PASS B (REVIEWER ANALYST)')}
${'═'.repeat(60)}

Write a structured diagnostic report with these exact sections:

CONSISTENCY SCORE
Rate agreement as: HIGH (both found essentially the same things) / MEDIUM (some differences) / LOW (significant disagreement)
1 sentence explaining why.

AGREED FINDINGS (both passes caught — high confidence these are real issues):
List each finding both passes agreed on, with check type and severity.

PASS A ONLY (first analyst found, reviewer missed):
For each: what was found, and why the reviewer might have missed it (false positive risk or legitimate oversight?).

PASS B ONLY (reviewer found, first analyst missed):
For each: what was found, and why the first analyst might have missed it (false positive risk or legitimate oversight?).

ROOT CAUSE OF DISCREPANCIES:
What specific document elements or check types are causing inconsistency between passes? Be specific.

RECOMMENDED ACTION:
- CONFIDENT: findings agreed by both passes — flag as confirmed issues
- NEEDS HUMAN REVIEW: findings only one pass caught — flag for manual verification
- LIKELY FALSE POSITIVE: findings that appear only once and look questionable

Be direct. This report helps a human reviewer decide which findings to trust.`

    const cheap = !!cheapMode
    const response = await client.messages.create({
      model:      pickClaudeModel(cheap),
      max_tokens: pickClaudeMaxTokens(cheap, 3000),
      messages:   [{ role: 'user', content: prompt }]
    })
    return response.content[0]?.text || 'Verdict generation failed — no response.'
  }

  // ── Standard mode: Raw vs Beefed-Up with learnings ───────────────────
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
    model:      pickClaudeModel(cheap),
    max_tokens: pickClaudeMaxTokens(cheap, 2000),
    messages:   [{ role: 'user', content: prompt }]
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
 * Creates a funny, super high-level TL;DR from Dr. Todd report text.
 */
export async function dumbDownDrToddReport(reportText, tenantName, cheapMode = false) {
  const prompt = `You are "Dr. Todd's funny translator." Convert a dense audit report into super simple plain English.

TENANT: ${tenantName || 'Unknown'}

REPORT:
${reportText}

Return ONLY plain text (no markdown), 6-10 short bullet-style lines max, covering:
1) What is good / clean
2) What is risky / missing
3) Urgency level (chill / medium / panic)
4) What to do next in plain words

Tone: slightly funny, clear, not clownish.`

  const cheap = !!cheapMode
  const response = await client.messages.create({
    model:      pickClaudeModel(cheap),
    max_tokens: pickClaudeMaxTokens(cheap, 900),
    messages:   [{ role: 'user', content: prompt }]
  })
  return response.content[0]?.text?.trim() || 'No TL;DR available.'
}

/**
 * Extracts juice learnings from a Dr. Verdict report (side-by-side or double-check comparison).
 * Unlike extractLearningsFromDrTodd (which reads 3-run synthesis), this reads the structured
 * verdict format: IMPROVEMENTS / REGRESSIONS / LEARNING-BY-LEARNING / RECOMMENDATION sections
 * (juice mode) or CONSISTENCY SCORE / AGREED / PASS A ONLY / PASS B ONLY / ROOT CAUSE (doublecheck).
 *
 * @param {string} verdictText  — full text from evaluateSideBySide()
 * @param {string} tenantName
 * @param {'juice'|'doublecheck'|'modelcompare'} mode
 * @param {boolean} cheapMode
 */
export async function extractLearningsFromVerdict(verdictText, tenantName, mode = 'juice', cheapMode = false) {
  const modeContext = mode === 'doublecheck'
    ? `Two independent AI passes (Pass A and Pass B) reviewed the same tenant folder with no communication. The verdict compares their results for consistency.`
    : mode === 'modelcompare'
    ? `Claude (Raw Todd) was compared against an OpenAI model on the same tenant folder. The verdict identifies what each model caught or missed.`
    : `The same tenant folder was analyzed twice: once by Raw Todd (no extra rules) and once by Beefed-Up Todd (with active juice learnings injected). The verdict compares the two runs to see if the learnings helped, hurt, or had no effect.`

  const extractGoal = mode === 'doublecheck'
    ? `Extract rules that would make Todd MORE CONSISTENT across independent runs — focus on the ROOT CAUSE section and things only one pass caught (inconsistency = uncertainty in the model that a clear prompt rule can resolve).`
    : `Extract rules that:
1. PREVENT the regressions — specific narrow rules that stop Todd from making the mistakes flagged in REGRESSIONS
2. REINFORCE the improvements — rules that lock in what Beefed-Up Todd did better so it happens every time
3. ADDRESS the REVISE recommendations — extract the exact narrowing needed for any learning marked REVISE`

  const prompt = `You are a prompt engineering specialist for a commercial real estate document review AI called "Todd."

CONTEXT:
${modeContext}

TENANT: ${tenantName}

═══ VERDICT REPORT ═══
${verdictText}
═══ END REPORT ═══

YOUR GOAL:
${extractGoal}

The learnings you extract will be injected directly into Todd's system prompt as rules. They must be:
- Written as direct imperatives starting with a verb ("Always check...", "Do NOT flag...", "When you see X, verify Y...")
- Specific enough that Todd can apply them without ambiguity
- Narrowly scoped — one rule per pattern, not broad catch-alls
- Grounded in specific evidence from the verdict (not general advice)

Return ONLY valid JSON — no markdown, no prose outside the JSON:
{
  "summary": "2-3 sentences: what the verdict revealed and what type of prompt changes these learnings represent",
  "learnings": [
    {
      "checkType": "EXECUTION|EXHIBIT|CURRENCY|REFERENCED_DOC|AMENDMENT_GAP|MISSING_PAGE|LEGIBILITY|SPECIAL_AGREEMENT|GUARANTY|NAME_MISMATCH|GENERAL",
      "suggestion": "The exact rule text to inject into Todd's prompt. Direct imperative, specific, actionable.",
      "confidence": "HIGH|MEDIUM|LOW",
      "rationale": "1 sentence: which part of the verdict (e.g. 'REGRESSIONS — Exhibit B false positive') supports this rule",
      "direction": "REINFORCE|PREVENT|NARROW"
    }
  ]
}

RULES:
- Maximum 6 learnings
- HIGH = verdict explicitly named this as a clear pattern with evidence; MEDIUM = implied by the verdict; LOW = single data point or uncertain
- REINFORCE = lock in something that worked; PREVENT = stop a mistake; NARROW = tighten an existing rule
- If the verdict said DISCARD for a learning, extract a counter-rule that prevents the harm that learning caused
- If the verdict said PROMOTE ALL or CONFIDENT (doublecheck), still extract rules — these confirm what Todd should keep doing
- Do NOT extract vague rules like "be more thorough" or "pay closer attention"`

  const cheap = !!cheapMode
  const response = await client.messages.create({
    model:      pickClaudeModel(cheap),
    max_tokens: pickClaudeMaxTokens(cheap, 2000),
    messages:   [{ role: 'user', content: prompt }]
  })

  const text = response.content[0]?.text || '{}'
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const jsonStart = cleaned.indexOf('{')
  if (jsonStart > 0) cleaned = cleaned.substring(jsonStart)

  try {
    const parsed = JSON.parse(cleaned)
    return { learnings: parsed.learnings || [], summary: parsed.summary || 'Learnings extracted from verdict.' }
  } catch {
    return { learnings: [], summary: 'Could not parse verdict learnings — report was saved.' }
  }
}

/**
 * Extracts targeted juice learnings from structured double-check review data.
 * Unlike extractLearningsFromVerdict (which reads free-text), this takes the
 * machine-readable review output with per-finding statuses and removedFindings.
 *
 * @param {Array}  opts.addedFindings     — findings reviewer added (missed by first pass)
 * @param {Array}  opts.correctedFindings — findings reviewer corrected (wrong details)
 * @param {Array}  opts.removedFindings   — false positives reviewer removed
 * @param {Array}  opts.confirmedFindings — findings both passes agreed on
 * @param {string} opts.tenantName
 * @param {boolean} opts.cheapMode
 */
export async function extractLearningsFromDoubleCheck({
  addedFindings = [],
  correctedFindings = [],
  removedFindings = [],
  confirmedFindings = [],
  tenantName = 'Unknown',
  cheapMode = false
}) {
  const formatFinding = (f, label) => {
    const parts = [`[${label}] ${f.checkType || 'GENERAL'} — "${f.missingDocument || 'N/A'}"`]
    if (f.comment) parts.push(`  Comment: ${f.comment}`)
    if (f.evidence) parts.push(`  Evidence: ${f.evidence}`)
    if (f.reviewNote) parts.push(`  Reviewer note: ${f.reviewNote}`)
    return parts.join('\n')
  }

  const formatRemoved = (r) =>
    `[REMOVED — FALSE POSITIVE] "${r.originalFinding || 'N/A'}"\n  Reason: ${r.reason || 'Not specified'}`

  let dataBlock = `TENANT: ${tenantName}\n\n`

  if (addedFindings.length > 0) {
    dataBlock += `═══ MISSED BY FIRST PASS (reviewer added — these are real issues Todd missed) ═══\n`
    dataBlock += addedFindings.map(f => formatFinding(f, 'ADDED')).join('\n\n') + '\n\n'
  }
  if (correctedFindings.length > 0) {
    dataBlock += `═══ INCORRECTLY DESCRIBED (reviewer corrected — Todd found it but got details wrong) ═══\n`
    dataBlock += correctedFindings.map(f => formatFinding(f, 'CORRECTED')).join('\n\n') + '\n\n'
  }
  if (removedFindings.length > 0) {
    dataBlock += `═══ FALSE POSITIVES (reviewer removed — Todd flagged these but they're not real issues) ═══\n`
    dataBlock += removedFindings.map(r => formatRemoved(r)).join('\n\n') + '\n\n'
  }
  if (confirmedFindings.length > 0) {
    dataBlock += `═══ CONFIRMED FINDINGS (both passes agreed — strong signal these rules work) ═══\n`
    dataBlock += confirmedFindings.map(f => formatFinding(f, 'CONFIRMED')).join('\n\n') + '\n\n'
  }

  const prompt = `You are a prompt engineering specialist for a commercial real estate document review AI called "Todd."

A senior paralegal reviewer ran a double-check QA pass on Todd's analysis. The structured results show exactly what Todd got right, wrong, missed, and overcalled:

${dataBlock}

Your job: extract specific, actionable prompt rules that fix the exact failure patterns shown above.

RULE TYPES TO GENERATE:
- For ADDED findings (Todd missed them): "Always check for X when Y condition is present" — what should Todd look for that he didn't?
- For CORRECTED findings (Todd got details wrong): "When flagging X, the correct way to describe/verify it is Y" — what should the description or verification logic be?
- For REMOVED findings (false positives): "Do NOT flag X when Y — because Z" — narrow, specific guard rail
- For CONFIRMED findings only if they reveal an interesting pattern worth locking in as an explicit rule

Return ONLY valid JSON — no markdown, no prose outside the JSON:
{
  "summary": "2-3 sentences: what QA patterns emerged and what type of rules these learnings represent",
  "learnings": [
    {
      "checkType": "EXECUTION|EXHIBIT|CURRENCY|REFERENCED_DOC|AMENDMENT_GAP|MISSING_PAGE|LEGIBILITY|SPECIAL_AGREEMENT|GUARANTY|NAME_MISMATCH|GENERAL",
      "suggestion": "The exact rule to inject into Todd's prompt. Direct imperative starting with a verb. Specific and narrow.",
      "confidence": "HIGH|MEDIUM|LOW",
      "rationale": "1 sentence: which finding type (ADDED/CORRECTED/REMOVED) and what specific evidence from above supports this rule",
      "direction": "PREVENT|REINFORCE|NARROW"
    }
  ]
}

RULES:
- Maximum 6 learnings
- Prioritize: REMOVED > ADDED > CORRECTED (false positives and misses are most actionable)
- HIGH = multiple instances or reviewer explicitly cited evidence; MEDIUM = single clear case; LOW = implied or borderline
- PREVENT = stop a mistake (false positive or miss); REINFORCE = lock in a correct behavior; NARROW = tighten an overcalibrated rule
- Do NOT generate vague rules ("be more careful", "check everything thoroughly")
- Each rule must be narrow enough that Todd can apply it unambiguously in future analyses`

  const cheap = !!cheapMode
  const response = await client.messages.create({
    model:      pickClaudeModel(cheap),
    max_tokens: pickClaudeMaxTokens(cheap, 2000),
    messages:   [{ role: 'user', content: prompt }]
  })

  const text = response.content[0]?.text || '{}'
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const jsonStart = cleaned.indexOf('{')
  if (jsonStart > 0) cleaned = cleaned.substring(jsonStart)

  try {
    const parsed = JSON.parse(cleaned)
    return { learnings: parsed.learnings || [], summary: parsed.summary || 'Learnings extracted from QA review.' }
  } catch {
    return { learnings: [], summary: 'Could not parse double-check learnings — raw response was saved.' }
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
