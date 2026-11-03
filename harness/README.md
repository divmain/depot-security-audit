# Depot audit harness

A Bun + TypeScript harness that drives an LLM reviewer through the items in
`../audit-ledger.tsv`. Each item gets a fresh-context, source-only review using
four read-only tools (`read_file`, `read_dir`, `grep`, `glob`) sandboxed to the
audit workspace, and finishes with a `submit_review` tool call whose input is
validated against the ReviewResult schema.

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
3. **Review** — one `generateText` call per item: tool loop for exploration,
   `Output.object` for the final `ReviewResult` schema, `stopWhen` step cap,
   `prepareStep` budget guard, and `repairToolCall` for malformed tool inputs.
   Fresh context per item by construction; nothing carries over. The system
   prompt is identical across items (~81 KB), so providers with prompt caching
   cache it as a stable prefix and only the per-item user message is billed
   uncached.
4. **Write** — on completion (and only then):
   - `results/<inventory_id>.json` — the full review output plus metadata
     (model, usage, steps, elapsed, revision).
   - the ledger row's `status` becomes `done` (configurable via
     `AUDIT_DONE_STATUS`). No other ledger field is ever touched; the ledger
     rewrite is atomic (tmp + rename) and byte-identical otherwise.
   - `transcripts/<inventory_id>.jsonl` — per-step tool calls, truncated tool
     outputs, usage, and the final result; the evidence trail for each review.

Failed items keep their previous status (so they re-run next launch) and are
listed in the end-of-run summary.

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

One item = at most one in-flight model call, so the item semaphore is exactly
the inference-call limit. The queue saturates all `AUDIT_CONCURRENCY` slots and
backfills immediately when a call finishes — no scheduler, no idle slots.
Transient provider errors get the SDK's built-in retry with backoff
(`maxRetries: 2`) plus one full per-item retry when the model fails to produce
a schema-valid result.

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
  "finished_at": "…"
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
| `src/prompt.ts` | system + per-item prompt assembly |
| `src/agent.ts` | the per-item `generateText` call, budget guard, repair, transcripts |
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
  `status`.
