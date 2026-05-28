# Todd Jr. — Handover Document

> Last updated: 2026-05-21
> Repo: https://github.com/dodisworking/ToddJr
> Deploy: Railway (auto-deploys from `main`)

---

## What This App Does

**Todd Jr.** is a commercial-lease-review QC system. A reviewer uploads tenant folders (each containing leases, amendments, exhibits, guaranties, etc.). The app:

1. Reads every document with Claude.
2. Generates *missing-document* findings — things the reviewer needs to chase down.
3. Runs the findings through a second-pass filter ("Todd") that drops false positives.
4. Hands the surviving findings to a human reviewer in a side-by-side UI for confirm/reject feedback.
5. Exports an Excel report with Confirmed / Rejected / Summary / Audit tabs.

The Excel report is the deliverable. Lauren (the reviewer) tests every iteration and her rejection notes become new training rules.

---

## What's Visible in the UI (Current State)

The hunt screen now shows **one button only**:

```
🎯 Todd Jr. Target Practice
```

Hidden but kept in code: TP3 button, Master Trainer, juice toggle, save-as-juice-model. Re-enable by removing the `hidden` class from the corresponding element if needed.

---

## Architecture — TP2 Pipeline (the live mode)

```
┌──────────────────────────────────────────────────────────────────┐
│  Upload  →  Dedup  →  Generate  →  Verify  →  Todd  →  Excel     │
└──────────────────────────────────────────────────────────────────┘
```

### Stage 1 — Upload + Dedup (`server.js` + `public/app.js`)
- Two paths: disk upload (`/api/upload`) and in-memory drag-drop (`/api/session/register`).
- Both paths now apply:
  - Unicode **NFC normalization** + `.trim()` on every folder name
  - **Dedup by `(property, suite, tenantName)`** — merges duplicates like `"Mirage Hair "` and `"Mirage Hair"`
  - **Empty-tenant filter** — drops folders with zero usable files
  - **File-count integrity check** — flags any silent file loss
  - **`session.uploadDiagnostics`** captured for the Audit tab

### Stage 2 — Generate (Sonnet — `lib/claude.js`)
- Reads all PDFs/DOCX, generates findings using 106 seed rules ("juice").
- Hard JSON-parse with 5-stage fallback: strip code fences → trailing prose → trailing commas → braces → fail-soft.
- Parse failures now emit a single LOW-severity LEGIBILITY note (not a HIGH-severity row).

### Stage 3 — Execution Verifier (Opus → Sonnet fallback)
- For every `EXECUTION` finding, re-opens the actual PDF and asks "is the By: line signed?"
- Drops verified-executed findings before Todd sees them.
- Uses Opus 4.7 by default, falls back to Sonnet 4.6 on model-name errors.

### Stage 4 — Todd Filter (Sonnet)
- Pattern-only filter, F-rules **F1–F41** plus all 106 seed rules cross-checked.
- **Self-contradiction check is non-negotiable**: drops any finding whose own text contains "WITHDRAWN", "SUPPRESSED", "FALSE POSITIVE", "Retained for training transparency only", "NOT flagged as a finding", "self-resolving", "for reviewer awareness", etc.
- Also receives the full folder manifest so it can detect "finding says X missing but X.pdf is in folder."

### Stage 5 — Excel Report (`lib/reporter.js`)
- `✓ Confirmed` — what the AI got right (green tab)
- `❌ Rejected` — what the reviewer marked wrong (red tab)
- `Summary` — counts + reviewer info
- `📋 Audit Report` — input/output reconciliation; flags any SKIPPED, DUPLICATED, or ORPHAN tenants vs. the upload manifest. Green when clean, red when something's off.

---

## Rules (Current Counts)

| Source | Count |
|---|---|
| Seed rules (`server.js` `LAUREN_REVIEW_SEED`) | **106** |
| Todd F-rules (`lib/claude.js` `TODD_FILTER_RULES`) | **F1–F41** |

Every Lauren review session adds new rules. The seed list lives in `server.js`. The F-rules are in `lib/claude.js`.

---

## Recent Timeline (Most Recent First)

| Date | Commit | What Changed |
|---|---|---|
| 5/19 | `aaf60f1` | TP2 regression fixes — parse fallback, 4 new rules (ex079–md082), F-rules to F41, false-ORPHAN audit fix |
| 5/19 | `409145f` | Opus → Sonnet fallback for model-name rejection |
| 5/18 | `54e023e` | TP2 pristine pass — dedup in `/api/session/register`, 6 new rules (ex073–dup078), suppression patterns |
| 5/07 | `3d5b047` | Master Trainer removed, audit tab gets input/output reconciliation |
| 5/06 | `357401a` | TP3 button wired into UI |
| 5/06 | `bc7997a` | TP3 pipeline (Opus universal verifier + senior-lawyer review) |
| 5/05 | `99616eb` | Upload-time dedup + audit diagnostics |

---

## Open Issues (Need Reproduction)

1. **System hangs at "0/N ready"** (Lauren Test #2 on 5/18) — no findings, no errors, indefinite wait. No repro data. Likely a stuck SSE connection.
2. **Wrong-folder bug** (Lauren Test #4 on 5/18) — system analyzed Masons docs under Duff & Phelps' tenant. Audit tab will now capture the upload manifest, so next repro will show the discrepancy.
3. **Blank-result tenants** (5/19) — 4 tenants returned zero findings with no errors. Possible network drop mid-stream. Need fresh repro.
4. **"9. Leases" treated as a tenant name** — a container folder leaked through as a tenant. Need a smarter container-folder detector.
5. **"Rules Generated from Session: 0"** — the feedback loop that should produce new rules from rejections isn't firing. Save errors observed in two sessions.

---

## How to Test (Lauren or anyone)

1. Go to the live Railway URL.
2. Drag-drop a folder containing tenant subfolders.
3. Wait for tenant cards to appear.
4. Click **🎯 Todd Jr. Target Practice**.
5. Review each tenant's findings — click ✓ or ✗ for each.
6. At the end, click **📥 Download Findings** to get the Excel.
7. Look at the **📋 Audit Report** tab — if it's green, the upload reconciled. If red, click it to see which tenants got skipped / duplicated.

---

## Where Things Live

| What | File | Notes |
|---|---|---|
| Upload + dedup + diagnostics | `server.js` (`/api/upload`, `/api/session/register`) | NFC norm + identity-key dedup |
| Frontend upload + dedup | `public/app.js` (~line 1760+) | Same dedup mirrored client-side |
| Main AI analysis | `lib/claude.js` → `analyzeFolder` / `beefedUpAnalyzeFolder` | 106 seed rules injected at runtime |
| Execution verifier | `lib/claude.js` → `verifyExecutionFindings` | Opus → Sonnet fallback |
| Todd filter | `lib/claude.js` → `filterFindingsForRelevance` | F1–F41 + folder manifest |
| Excel reporter | `lib/reporter.js` → `generateTargetPracticeSessionExcel` | 4 tabs incl. Audit |
| Seed rules | `server.js` → `LAUREN_REVIEW_SEED` | 106 rules, ID-keyed |
| Todd F-rules | `lib/claude.js` → `TODD_FILTER_RULES` | F1–F41 |
| Model config | `lib/anthropic-config.js` | `MODEL_SONNET`, `MODEL_OPUS`, `MODEL_CHEAP` |

---

## Deployment

- **GitHub**: https://github.com/dodisworking/ToddJr
- **Branch**: `main` (auto-deploys on push)
- **Host**: Railway
- **Env vars needed**: `ANTHROPIC_API_KEY`, `ANTHROPIC_API_KEY_2`, `ANTHROPIC_API_KEY_3` (3 keys for tier rotation)

To deploy a fix:
```bash
git add <files>
git commit -m "<message>"
git push origin main
```
Railway redeploys automatically. Check the dashboard for build status.

---

## Suggested Next Steps

1. **Reproduce the wrong-folder bug** — get a fresh test where this happens, then read Railway logs for that session.
2. **Container-folder detection** — handle `"9. Leases/Tenant Name/..."` by treating numbered/named container folders as wrappers, not tenants.
3. **SSE timeout handling** — add a 10-minute hard timeout per tenant analysis so the system never hangs forever.
4. **Rules-generation pipeline** — investigate why "Rules Generated: 0" in recent sessions. Save errors at end of session are the symptom.

---

## Contact / Pairing

When picking this up, start by reading the 3 most recent commit messages — they explain the latest reviewer feedback in detail. Then load the most recent Excel from Lauren and the latest commit's diff side-by-side; that's the working pattern.

The reviewer is the source of truth. Every rejected finding is signal. Every new rule should cite a specific reviewer note in its `rationale` field so we can trace why it exists.
