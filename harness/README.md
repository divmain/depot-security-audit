# Depot audit harness

A Bun + TypeScript harness that drives an LLM reviewer through the items in
`../audit-ledger.tsv`. Each item gets a fresh-context, source-only review using
four read-only tools (`read_file`, `read_dir`, `grep`, `glob`) sandboxed to the
audit workspace, and finishes with a `submit_review` tool call whose input is
validated against the ReviewResult schema. When a review reports a finding, an
optional second stage puts that finding on trial: a stronger adversarial
reviewer re-derives the evidence and returns a verdict. When a verdict
confirms the finding, an optional third stage designs 1-3 remediation options
(exactly one primary, each scoped by invasiveness) so findings can be triaged
by ROI — see [Adversarial pass](#adversarial-pass) and
[Remediation pass](#remediation-pass).

Built directly on the Vercel AI SDK (`ai`) with an OpenAI-compatible provider,
so any inexpensive tool-calling endpoint works (Fireworks, Together, Groq,
OpenRouter, …).

## Quickstart

```sh
cd harness
bun install
cp .env.example .env      # fill in AUDIT_BASE_URL / AUDIT_API_KEY / AUDIT_MODEL

bun run dry-run --limit 2 --prefix HTTP   # inspect selection + assembled prompts, no calls
bun run start --ids HTTP-001              # canary: one item, end to end
bun run start --prefix AUTH --criticality critical,high   # a real batch
bun run start                             # everything pending, critical-first
```

## Per-item lifecycle

1. **Select** — rows with `status = not_started` (override with `--status`),
   filtered by `--prefix` / `--criticality` / `--ids` / `--limit`, ordered
   critical → high → medium → low, ledger order within a band.
2. **Prompt** — a system prompt distilled from the Audit Brief (adapted for
   source-only review) with the **complete `Finding-Categories.md` taxonomy
   embedded verbatim** (classification never depends on the model choosing to
   read it), plus *exactly one* verbatim inventory bullet from
   `audit-inventory.md`. The 2.8 MB inventory file itself is never in context.
3. **Review** — one `generateText` call per item on the shared agent loop
   (`src/agent-loop.ts`): tool loop for exploration, a terminal
   `submit_review` tool call for the structured `ReviewResult`, `stopWhen`
   step cap, `prepareStep` budget guards, and `repairToolCall` for
   malformed tool inputs.
   Fresh context per item by construction; nothing carries over. The system
   prompt is identical across items (~81 KB), so providers with prompt caching
   cache it as a stable prefix and only the per-item user message is billed
   uncached.
4. **Adversarial pass (optional)** — when the primary review reports
   `finding_identified` and `AUDIT_ADVERSARY_MODEL` is set, the row first
   moves to `preliminary_finding` (configurable via
   `AUDIT_PRELIMINARY_STATUS`) and a second, stronger model adversarially
   re-examines the finding before the row becomes `done`. An interrupt or
   failure between the stages leaves the row at `preliminary_finding`, and
   the next launch resumes with the adversarial pass directly.
5. **Remediation pass (optional)** — when the adversarial verdict confirms
   the finding (`upheld`/`overstated`/`understated`) and
   `AUDIT_REMEDIATION_MODEL` is set, the row moves to `remediation_needed`
   (configurable via `AUDIT_REMEDIATION_STATUS`) and a remediation designer
   proposes 1-3 fixes (exactly one primary) before the row becomes `done`.
   Refuted/undecidable verdicts finish the row directly.
6. **Write** — on completion (and only then):
   - `results/<inventory_id>.json` — the full review output plus metadata
     (model, usage, steps, elapsed, revision), — after an adversarial
     pass — the `adversarial` verdict block and derived `final_outcome`,
     and — after a remediation pass — the `remediation` plan block.
   - the ledger row's `status` becomes `done` (configurable via
     `AUDIT_DONE_STATUS`). No other ledger field is ever touched; the ledger
     rewrite is atomic (tmp + rename) and byte-identical otherwise.
   - `transcripts/<inventory_id>.jsonl` — per-step tool calls, truncated tool
     outputs, usage, and the final result; the evidence trail for each review.
     The adversarial pass writes `transcripts/<inventory_id>.adversary.jsonl`
     and the remediation pass `transcripts/<inventory_id>.remediation.jsonl`,
     both with the same event shapes.

Failed items keep their previous status (so they re-run next launch) and are
listed in the end-of-run summary.

## Adversarial pass

When `AUDIT_ADVERSARY_MODEL` is set (empty = disabled, findings go straight to
`done`), every `finding_identified` outcome gets a second stage before the row
is finished:

1. The primary result is written and the row moves to `preliminary_finding`
   (`AUDIT_PRELIMINARY_STATUS`) — so an interrupt between the stages resumes
   with the adversarial pass, never a redundant primary re-run.
2. A second, stronger model — with its own step/token budget
   (`AUDIT_ADVERSARY_MAX_STEPS`, `AUDIT_ADVERSARY_TOKEN_BUDGET`) and reasoning
   effort (`AUDIT_ADVERSARY_REASONING_EFFORT`, sent as the provider's
   `reasoning_effort`) — re-examines the finding with the same four read-only
   tools, fresh context, and a different mandate: put the finding on trial.
   It re-derives the claimed code path, line-verifies the cited locations,
   hunts for mitigations the primary may have missed, and checks disposition
   against documented intent (docs/Threat-Model.md, design docs, code
   comments). The primary reviewer's transcript is deliberately not shared —
   the adversary must re-derive the evidence itself.
3. The verdict is merged into `results/<inventory_id>.json` under
   `adversarial` (never overwriting the primary finding) and the derived
   `final_outcome` replaces the plain outcome:
   `upheld → finding_upheld`, `overstated → finding_overstated`,
   `understated → finding_understated`, `refuted → finding_refuted`,
   `undecidable → needs_validation`. Disputing verdicts must carry structured
   `corrections` (corrected values for the disputed finding fields); an
   `undecidable` verdict must name the decisive `experiment`.
4. Only then does the row become `done`. A failed adversarial pass leaves the
   row at `preliminary_finding` for the next launch.

Cost note: adversarial spend scales with the finding rate — each finding pays
for a second full review pass, on a stronger (pricier) model.

## Remediation pass

When `AUDIT_REMEDIATION_MODEL` is set (empty = disabled, confirmed findings
finish at `done` after the adversarial pass), every confirming verdict —
`upheld`, `overstated`, or `understated` — gets a third stage before the row
is finished:

1. The row moves to `remediation_needed`
   (`AUDIT_REMEDIATION_STATUS`) after the adversarial verdict is recorded, so
   an interrupt between the stages resumes with the remediation pass.
2. The remediation designer — with its own step/token budget
   (`AUDIT_REMEDIATION_MAX_STEPS`, `AUDIT_REMEDIATION_TOKEN_BUDGET`) and
   reasoning effort (`AUDIT_REMEDIATION_REASONING_EFFORT`) — receives the
   **effective finding**: the primary finding with the adversarial
   corrections applied, so it remediates what was actually adjudicated.
   Same four read-only tools, fresh context, a solution-design mandate (not
   re-litigation): ground every proposal in the actual source, prefer the
   least invasive option that genuinely restores the violated invariant, offer
   2-3 options only when genuinely distinct approaches exist, and mark as
   primary the option that most holistically restores the invariant at
   acceptable cost.
3. Each option carries: a short `title`; a 2-5 paragraph `description`
   (what to change, where exactly, why it restores the invariant); a `scope`
   on the invasiveness ladder (`targeted` < `single-file` < `multi-file` <
   `requires-redesign`); optional `tradeOffs` (when to prefer it) and
   `residualRisk` (what it deliberately leaves unfixed). Documented design
   exposures still get 1-3 options — "accept or tighten the documented
   bound" is a valid `requires-redesign` remediation.
4. Exactly one option must be marked `primaryRecommendation` (enforced in
   cross-checks, retried with a corrective note otherwise). The plan is merged
   into `results/<inventory_id>.json` under `remediation` (with
   `based_on_verdict`), and only then does the row become `done`.

The ROI cut for post-processing is a join of the ledger's `criticality` with
the primary remediation's `scope`: a critical finding whose primary fix is
`targeted` is an immediate, cheap win; a critical finding that
`requires-redesign` needs scheduling and design discussion. Cost note: each
confirmed finding now pays for three model passes in total.

## Pausing and resuming

- **Resume** is just re-running: selection is driven by ledger status, and a
  completed item is never `not_started` again.
- **Ctrl-C once** stops new claims and drains in-flight items (boundary-safe:
  results are only written on completion).
- **Ctrl-C twice** aborts in-flight calls; aborted items were never written and
  re-run later. Exit code `130` on abort, `1` if any item failed.
- A `.run-lock` guard (PID-based, `--force` to override) prevents two
  concurrent runs from racing the ledger.

## Concurrency

Inference calls are limited **per model**: every distinct model ID in use — the
primary reviewer, per-criticality overrides, and the adversarial reviewer —
gets its own pool of `AUDIT_CONCURRENCY` slots, so a slow or expensive model
(e.g. every finding paying for an adversarial pass) never starves the others'
queues. Total in-flight calls can therefore reach
`AUDIT_CONCURRENCY × (models in use)`; set
`AUDIT_CONCURRENCY_OVERRIDES=model-id=limit,...` (exact model IDs,
comma-separated) to cap a specific model below the default. The queue
saturates each model's slots and backfills immediately when a call finishes.
One item holds at most one model slot at a time (primary and adversarial
stages are sequential). Transient provider errors get the SDK's built-in
retry with backoff (`maxRetries: 2`) plus one full per-item retry when the
model fails to produce a schema-valid result.

## Cost controls

- `AUDIT_MAX_STEPS` (default 40): hard per-item step cap. Two steps before the
  cap, the exploration tools are withdrawn and a `submit_review` call is forced
  (`toolChoice`) — this guarantees the structured result actually materializes
  instead of the run being cut off mid-exploration.
- `AUDIT_TOKEN_BUDGET` (default 200,000): per-item conversation-size ceiling,
  measured as the largest step's input+output tokens (not the sum across steps,
  which double-counts the re-sent context). Reaching it triggers a soft
  interrupt at the next turn boundary: the reviewer is told to wrap up — a
  couple of tool calls at most — and submit, and a short reminder with a
  countdown to forced submission is injected at every subsequent turn boundary
  so the nudge stays at the end of the reviewer's context. It does not end the
  run by itself; the step cap remains the hard limit.
- Every tool paginates or caps output (≤500 lines per read, capped grep/glob
  results, 2 MB file ceiling) so one call cannot blow the context window.
- Per-criticality model routing: `AUDIT_MODEL_CRITICAL` … `AUDIT_MODEL_LOW`
  override `AUDIT_MODEL` per band, e.g. a strong model for `critical` items
  and a cheap one for `low`.

## Tool sandbox and path virtualization

- The reviewer is told the repository is mounted at **`/opt/depot`**
  (`AUDIT_VIRTUAL_ROOT`). Every tool path — `/opt/depot/packages/...` absolute
  or `packages/...` repo-relative — is translated to the real repository
  directory, and outputs are translated back to `/opt/depot/...` form, so the
  model never learns or leaks real host paths.
- The repository directory is the **only** accessible root. Any other absolute
  path, any `..` escape, and any symlink pointing outside are refused
  (`realpath` containment check). This also makes `audit-inventory.md`,
  `audit-ledger.*`, and the harness's own files unreachable by construction —
  no denylists needed.
- Every tool paginates or caps output (≤500 lines per read, capped grep/glob
  results, 2 MB file ceiling) so one call cannot blow the context window.
- `grep`/`glob` skip `node_modules`, `.git`, `dist`, `coverage`, etc. `grep`
  uses ripgrep when available (with explicit exclusions) and falls back to a
  pure-JS walker that supports JavaScript-only regex features like lookaround.

## Result JSON shape

```jsonc
{
  "inventory_id": "HTTP-046",
  "area": "HTTP",
  "surface": "Verified-token to request-authority mapping",
  "criticality": "critical",
  "item_text": "- [HTTP-046] **…** — …",        // verbatim inventory bullet
  "outcome": "reviewed_no_finding",              // | finding_identified | needs_validation
  "category_ids": ["FC-AUTHORIZATION"],
  "evidence": "… files/functions/lines, contrasts exercised, reasoning …",
  "notes": "…",
  "criticality_comment": null,                   // only set when a change is proposed
  "finding": null,                               // required when outcome = finding_identified
  "model": "…", "attempts": 1, "steps": 12,
  "usage": { "inputTokens": 0, "outputTokens": 0 },
  "elapsed_ms": 0,
  "revision": { "head": "…", "dirty": false, "baseline": "6a72e67b…" },
  "finished_at": "…",
  "final_outcome": "reviewed_no_finding",   // finding_upheld | finding_overstated |
                                          // finding_understated | finding_refuted |
                                          // needs_validation (after adversarial pass)
  "adversarial": null,                      // verdict block, only when the pass ran:
                                            // { verdict, rationale, evidence,
                                            //   corrections, experiment, notes,
                                            //   model, reasoning_effort, usage, … }
  "remediation": null                       // plan block, only when the pass ran:
                                            // { remediations: [{ title,
                                            //   primaryRecommendation, description,
                                            //   scope, tradeOffs?, residualRisk? }],
                                            //   based_on_verdict, model, usage, … }
}
```

The `finding` object (when present) mirrors the Finding Template: title,
status, evidence_confidence, affected_inventory_ids, expected_invariant,
observed_behavior, minimum_attacker_access, boundary, impact,
severity_rationale, source_locations, proposed_validation, disposition,
remediation.

Because results live in their own per-ID files, post-processing (dedupe,
criticality recalibration, merging outcomes back into the ledger) is fully
decoupled from progress tracking.

## Development

```sh
bun run typecheck            # tsc --noEmit
bun run scripts/smoke-tools.ts   # sandbox + tool behavior checks
```

Layout:

| File | Role |
| --- | --- |
| `src/config.ts` | env parsing, path resolution, model routing |
| `src/ledger.ts` | TSV parse/select/atomic rewrite (byte-exact round-trip) |
| `src/inventory.ts` | one-time index of `audit-inventory.md` bullets by ID |
| `src/categories.ts` | reads `Finding-Categories.md` for verbatim embedding in the prompt |
| `src/fs-tools.ts` | virtualized, repo-confined filesystem primitives (read/dir/grep/glob) |
| `src/tools.ts` | AI SDK tool definitions wrapping `fs-tools` |
| `src/prompt.ts` | system + per-item prompt assembly (primary and adversarial) |
| `src/agent-loop.ts` | the shared tool-loop agent core (guards, reminders, repair, retry) |
| `src/agent.ts` | the primary reviewer: ReviewResult schema + cross-checks |
| `src/adversary.ts` | the adversarial reviewer: verdict schema + cross-checks |
| `src/remediation.ts` | the remediation designer: plan schema + cross-checks |
| `src/driver.ts` | CLI, semaphore, SIGINT drain, lock, persistence, summary |
| `src/main.ts` | entry point |

To add a tool: implement it in `src/fs-tools.ts` (or beside it), wrap it in
`src/tools.ts`, and mention it in the system prompt's Tools section. To tune
review behavior, edit `src/prompt.ts` — it is the only place review
instructions live.

## Known limits

- Reviews are **source-only** by design (no execution tools). The prompt
  encodes this: unproven candidates become `needs_validation` with a named
  decisive experiment rather than findings.
- The provider endpoint must support tool calling. The structured result is
  produced in tool mode — a terminal `submit_review` tool whose input is
  schema-validated — so native JSON-schema response formats are never required.
- `reviewer`, `reviewed_revision`, `outcome` and other ledger columns are
  intentionally left for your post-processing merge; the harness only owns
  `status`. The adversarial verdict lives in `results/<id>.json`
  (`adversarial.verdict`, `final_outcome`), not in the ledger.
- The adversarial and remediation reviewers are only as good as the models you
  point them at; set `AUDIT_ADVERSARY_MODEL` / `AUDIT_REMEDIATION_MODEL` to
  something stronger than the primary reviewer, or leave them empty to skip the
  stages entirely. Each confirmed finding pays for three model passes in total.
