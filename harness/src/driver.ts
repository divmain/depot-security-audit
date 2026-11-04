import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  assertInferenceConfig,
  HARNESS_DIR,
  loadConfig,
  modelFor,
  type Config,
} from './config';
import { atomicWrite, parseLedger, renderLedger, selectItems, setField, type Ledger, type LedgerRow } from './ledger';
import { parseInventory } from './inventory';
import { readCategoriesDocument } from './categories';
import { createFsTools } from './fs-tools';
import { reviewItem, type ReviewDeps } from './agent';
import { adversarialReview, finalOutcomeFor, type AdversarialDeps, type AdversarialSubject } from './adversary';
import { BASELINE_REVISION, buildAdversarialSystemPrompt, buildAdversarialTaskPrompt, buildItemPrompt, buildSystemPrompt, type RevisionInfo } from './prompt';

interface CliArgs {
  statuses: string[];
  prefixes: string[];
  criticalities: string[];
  ids: Set<string>;
  limit?: number;
  concurrency?: number;
  maxSteps?: number;
  tokenBudget?: number;
  dryRun: boolean;
  force: boolean;
  help: boolean;
}

const HELP = `Depot audit harness — reviews audit-ledger.tsv items with a tool-using LLM reviewer.

Usage: bun run src/main.ts [options]

Selection (defaults to status=not_started plus rows awaiting an adversarial pass, ordered critical -> high -> medium -> low):
  --prefix PREFIXES      Comma-separated inventory ID prefixes, e.g. AUTH,HTTP
  --criticality BANDS    Comma-separated bands, e.g. critical,high
  --ids IDS              Exact inventory IDs, e.g. HTTP-001,HTTP-002 (ignores the default status filter)
  --status STATUSES      Comma-separated statuses to select (default: not_started,preliminary_finding)
  --limit N              Stop after N items

Execution:
  --concurrency N        Max simultaneous inference calls per model (default: AUDIT_CONCURRENCY or 8)
  --max-steps N          Per-item model step cap (default: AUDIT_MAX_STEPS or 40)
  --token-budget N       Conversation-size budget; on reaching it the reviewer is told to wrap up and submit (default: AUDIT_TOKEN_BUDGET or 200000)

Other:
  --dry-run              Show the selection and the assembled prompts; no model calls, no writes
  --force                Ignore a stale run lock
  -h, --help             Show this help

Behavior:
  - On completion of an item: results/<inventory_id>.json is written and the ledger row's
    status becomes "done" (AUDIT_DONE_STATUS). Nothing else in the ledger is touched.
  - When the adversarial pass is enabled (AUDIT_ADVERSARY_MODEL set) and the primary
    review reports finding_identified, the row first moves to "preliminary_finding"
    (AUDIT_PRELIMINARY_STATUS); the adversarial reviewer then tries to break the
    finding and the row only becomes "done" once its verdict is recorded. Rows left
    at preliminary_finding (interrupt or failure) resume with the adversarial pass.
  - Ctrl-C once: stop claiming new items and drain the in-flight ones (boundary-safe).
    Ctrl-C twice: abort in-flight calls; unfinished items keep their current status and re-run later.
  - Failed items are left at their previous status and reported in the summary.`;

function csvArg(value: string | undefined, collect: string[]): void {
  if (value == null || value.trim() === '') return;
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (trimmed !== '') collect.push(trimmed);
  }
}

function intArg(value: string | undefined): number | undefined {
  if (value == null || value.trim() === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`not a positive integer: ${value}`);
  return parsed;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    statuses: [],
    prefixes: [],
    criticalities: [],
    ids: new Set<string>(),
    dryRun: false,
    force: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string | undefined => (i + 1 < argv.length ? argv[i + 1] : undefined);
    switch (arg) {
      case '--prefix':
        csvArg(next(), args.prefixes);
        i++;
        break;
      case '--criticality':
        csvArg(next(), args.criticalities);
        i++;
        break;
      case '--ids': {
        const parts: string[] = [];
        csvArg(next(), parts);
        for (const part of parts) args.ids.add(part);
        i++;
        break;
      }
      case '--status':
        csvArg(next(), args.statuses);
        i++;
        break;
      case '--limit':
        args.limit = intArg(next());
        i++;
        break;
      case '--concurrency':
        args.concurrency = intArg(next());
        i++;
        break;
      case '--max-steps':
        args.maxSteps = intArg(next());
        i++;
        break;
      case '--token-budget':
        args.tokenBudget = intArg(next());
        i++;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}\n\n${HELP}`);
    }
  }
  // Default status selection is applied in run(), once the configured preliminary
  // status is known; exact --ids selection is explicit and carries no status filter.
  return args;
}

function semaphore(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) {
      await new Promise<void>(resolve => {
        waiters.push(resolve);
      });
    }
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiters.shift()?.();
    }
  };
}

/**
 * Per-model semaphore pools: each distinct model ID gets its own limit (the
 * default, or its override), so calls to one model never contend with calls to
 * another. Total in-flight calls can reach limit × (models in use).
 */
export function semaphoreMap(defaultLimit: number, overrides: Map<string, number>) {
  const pools = new Map<string, ReturnType<typeof semaphore>>();
  return async <T>(modelId: string, task: () => Promise<T>): Promise<T> => {
    let pool = pools.get(modelId);
    if (pool == null) {
      pool = semaphore(overrides.get(modelId) ?? defaultLimit);
      pools.set(modelId, pool);
    }
    return pool(task);
  };
}

function getRevisionInfo(repoDir: string): RevisionInfo {
  const head = Bun.spawnSync({ cmd: ['git', '-C', repoDir, 'rev-parse', 'HEAD'], stdout: 'pipe', stderr: 'pipe' });
  const status = Bun.spawnSync({ cmd: ['git', '-C', repoDir, 'status', '--porcelain'], stdout: 'pipe', stderr: 'pipe' });
  const headText = String(head.stdout).trim();
  const headOk = head.exitCode === 0 && headText !== '';
  const dirty = status.exitCode === 0 && String(status.stdout).trim() !== '';
  return {
    head: headOk ? headText : 'unknown (git unavailable)',
    dirty,
  };
}

function acquireLock(force: boolean): () => void {
  const lockPath = join(HARNESS_DIR, '.run-lock');
  if (existsSync(lockPath)) {
    let pid: number | undefined;
    try {
      pid = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10);
    } catch {
      pid = undefined;
    }
    let alive = false;
    if (pid != null && Number.isFinite(pid)) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch (error) {
        alive = (error as NodeJS.ErrnoException).code === 'EPERM';
      }
    }
    if (alive && !force) {
      throw new Error(`another harness run appears active (pid ${pid}); pass --force to ignore`);
    }
  }
  writeFileSync(lockPath, String(process.pid));
  return () => {
    try {
      unlinkSync(lockPath);
    } catch {
      // already gone
    }
  };
}

interface Summary {
  done: number;
  failed: number;
  skipped: number;
  inputTokens: number;
  outputTokens: number;
  outcomes: Map<string, number>;
  verdicts: Map<string, number>;
  adversarialDone: number;
  failures: Array<{ id: string; error: string }>;
}

function printPlan(
  cfg: Config,
  args: CliArgs,
  ledger: Ledger,
  selected: LedgerRow[],
  missingBullets: LedgerRow[],
  revision: RevisionInfo,
): void {
  const byCriticality = new Map<string, number>();
  const byArea = new Map<string, number>();
  for (const row of selected) {
    byCriticality.set(row.criticality, (byCriticality.get(row.criticality) ?? 0) + 1);
    byArea.set(row.area, (byArea.get(row.area) ?? 0) + 1);
  }
  const fmt = (map: Map<string, number>): string =>
    [...map.entries()].map(([k, v]) => `${k}=${v}`).join(' ') || 'none';
  console.log(`Ledger: ${ledger.rows.length} rows (${cfg.ledgerPath})`);
  console.log(`Repo: ${cfg.repoDir} mounted for the reviewer at ${cfg.virtualRoot}`);
  console.log(`Revision: ${revision.head}${revision.dirty ? ' (dirty)' : ''} | inventory baseline: ${BASELINE_REVISION}`);
  console.log(`Selected: ${selected.length} | by criticality: ${fmt(byCriticality)} | by area: ${fmt(byArea)}`);
  if (args.prefixes.length > 0) console.log(`Filters: prefix=[${args.prefixes.join(',')}]${args.criticalities.length > 0 ? ` criticality=[${args.criticalities.join(',')}]` : ''}${args.statuses.length > 0 ? ` status=[${args.statuses.join(',')}]` : ''}`);
  if (missingBullets.length > 0) {
    const ids = missingBullets.slice(0, 10).map(r => r.inventory_id).join(', ');
    console.warn(
      `WARNING: ${missingBullets.length} selected item(s) have no inventory bullet and will be skipped: ${ids}${missingBullets.length > 10 ? ' …' : ''}`,
    );
  }
}

/** A row skipped because the run is draining (SIGINT); not a failure. */
class InterruptedRowError extends Error {}

/** Loads a stored primary result and returns it as an adversarial subject; null when missing or not a finding. */
function loadPrimaryResult(cfg: Config, inventoryId: string): AdversarialSubject | null {
  let payload: any;
  try {
    payload = JSON.parse(readFileSync(join(cfg.resultsDir, `${inventoryId}.json`), 'utf8'));
  } catch {
    return null;
  }
  if (payload?.outcome !== 'finding_identified' || payload?.finding == null) return null;
  return {
    outcome: payload.outcome,
    evidence: String(payload.evidence ?? ''),
    notes: String(payload.notes ?? ''),
    finding: payload.finding,
  };
}

export async function run(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(HELP);
    return;
  }

  const cfg = loadConfig();
  if (args.concurrency != null) cfg.concurrency = args.concurrency;
  if (args.maxSteps != null) cfg.maxSteps = args.maxSteps;
  if (args.tokenBudget != null) cfg.tokenBudget = args.tokenBudget;
  const adversaryEnabled = cfg.adversaryModel !== '';

  // Default selection: pending items plus rows awaiting an adversarial pass.
  if (args.statuses.length === 0 && args.ids.size === 0) {
    args.statuses = ['not_started', cfg.preliminaryStatus];
  }

  const ledger = parseLedger(cfg.ledgerPath);
  const inventory = parseInventory(cfg.inventoryPath);
  const categoriesDocument = readCategoriesDocument(cfg.categoriesPath);
  const revision = getRevisionInfo(cfg.repoDir);

  const selected = selectItems(ledger, {
    statuses: args.statuses,
    prefixes: args.prefixes,
    criticalities: args.criticalities,
    ids: args.ids,
    limit: args.limit,
  });
  const missingBullets = selected.filter(row => !inventory.has(row.inventory_id));
  const runnable = selected.filter(row => inventory.has(row.inventory_id));

  printPlan(cfg, args, ledger, selected, missingBullets, revision);

  if (args.dryRun) {
    if (runnable.length > 0) {
      const row = runnable[0];
      const bullet = inventory.get(row.inventory_id);
      console.log('\n===== SYSTEM PROMPT (first selected item) =====\n');
      console.log(
        buildSystemPrompt({
          categoriesDocument,
          revision,
          maxSteps: cfg.maxSteps,
          tokenBudget: cfg.tokenBudget,
          virtualRoot: cfg.virtualRoot,
        }),
      );
      console.log('\n===== ITEM PROMPT =====\n');
      console.log(buildItemPrompt({ item: row, bullet: bullet?.text ?? '', revision, virtualRoot: cfg.virtualRoot }));
    }
    const preliminary = adversaryEnabled
      ? runnable.find(r => r.status === cfg.preliminaryStatus)
      : undefined;
    if (preliminary != null) {
      const bullet = inventory.get(preliminary.inventory_id);
      const primary = loadPrimaryResult(cfg, preliminary.inventory_id);
      if (bullet != null && primary != null) {
        console.log(`\n===== ADVERSARIAL SYSTEM PROMPT (${preliminary.inventory_id}) =====\n`);
        console.log(
          buildAdversarialSystemPrompt({
            revision,
            maxSteps: cfg.adversaryMaxSteps,
            tokenBudget: cfg.adversaryTokenBudget,
            virtualRoot: cfg.virtualRoot,
          }),
        );
        console.log('\n===== ADVERSARIAL TASK PROMPT =====\n');
        console.log(
          buildAdversarialTaskPrompt({
            item: preliminary,
            bullet: bullet?.text ?? '',
            primary,
            revision,
            virtualRoot: cfg.virtualRoot,
          }),
        );
      } else if (bullet != null) {
        console.warn(
          `\n(no stored finding for ${preliminary.inventory_id}: the adversarial pass would fall back to a primary re-run)`,
        );
      }
    }
    console.log('\n(dry run: no model calls, no writes)');
    return;
  }

  assertInferenceConfig(cfg);
  mkdirSync(cfg.resultsDir, { recursive: true });
  mkdirSync(cfg.transcriptsDir, { recursive: true });
  const releaseLock = acquireLock(args.force);

  const provider = createOpenAICompatible({
    name: cfg.providerName,
    baseURL: cfg.baseUrl,
    apiKey: cfg.apiKey,
  });

  const fsTools = createFsTools({
    repoDir: cfg.repoDir,
    virtualRoot: cfg.virtualRoot,
  });

  // ---- Pause/resume machinery ----------------------------------------------
  let stopping = false;
  const hardAbort = new AbortController();
  process.on('SIGINT', () => {
    if (stopping) {
      console.error('\nSecond SIGINT — aborting in-flight work.');
      hardAbort.abort();
      setTimeout(() => process.exit(130), 2000);
      return;
    }
    stopping = true;
    console.error('\nSIGINT — draining in-flight items; no new items will start. Ctrl-C again to abort.');
  });

  // Ledger rewrites are serialized so concurrent completions cannot interleave.
  // Each caller awaits its own link (to observe its own failure), while the
  // chain itself swallows errors so one failed write cannot poison the writes
  // queued behind it. Because every link renders the full shared in-memory
  // ledger, a later successful write also repairs an earlier failed one.
  let persistChain: Promise<void> = Promise.resolve();
  const persistStatus = (row: LedgerRow, status: string): Promise<void> => {
    const link = persistChain.then(() => {
      setField(ledger, row, 'status', status);
      atomicWrite(ledger.path, renderLedger(ledger));
    });
    persistChain = link.catch(() => {});
    return link;
  };

  const summary: Summary = {
    done: 0,
    failed: 0,
    skipped: 0,
    inputTokens: 0,
    outputTokens: 0,
    outcomes: new Map<string, number>(),
    verdicts: new Map<string, number>(),
    adversarialDone: 0,
    failures: [],
  };
  const total = runnable.length;
  const startedAt = Date.now();
  const limit = semaphoreMap(cfg.concurrency, cfg.concurrencyOverrides);

  const concurrencyOverridesText =
    cfg.concurrencyOverrides.size > 0
      ? ` (${[...cfg.concurrencyOverrides.entries()].map(([id, n]) => `${id}=${n}`).join(' ')})`
      : '';
  console.log(
    `Model: ${cfg.models.default}` +
      (cfg.models.critical !== cfg.models.default || cfg.models.high !== cfg.models.default ||
        cfg.models.medium !== cfg.models.default || cfg.models.low !== cfg.models.default
        ? ` (overrides: critical=${cfg.models.critical} high=${cfg.models.high} medium=${cfg.models.medium} low=${cfg.models.low})`
        : '') +
      ` | provider: ${cfg.providerName} | concurrency: ${cfg.concurrency}/model${concurrencyOverridesText}` +
      ` | max steps: ${cfg.maxSteps} | token budget: ${cfg.tokenBudget.toLocaleString('en-US')}`,
  );
  if (adversaryEnabled) {
    console.log(
      `Adversary: ${cfg.adversaryModel} (reasoning: ${cfg.adversaryReasoningEffort || 'provider default'} | ` +
        `max steps: ${cfg.adversaryMaxSteps} | token budget: ${cfg.adversaryTokenBudget.toLocaleString('en-US')})`,
    );
  } else {
    console.log('Adversary: disabled (AUDIT_ADVERSARY_MODEL unset) — findings go straight to done');
  }
  console.log(`Reviewing ${total} item(s). Results → ${cfg.resultsDir} | transcripts → ${cfg.transcriptsDir}\n`);

  const processRow = async (row: LedgerRow): Promise<void> => {
    if (stopping) {
      summary.skipped++;
      return;
    }
    const bullet = inventory.get(row.inventory_id);
    if (bullet == null) return;
    // Rows awaiting the adversarial pass (interrupted between stages, or
    // re-selected by hand) go straight to stage two when it is enabled.
    if (adversaryEnabled && row.status === cfg.preliminaryStatus) {
      return runAdversarialPass(row, bullet);
    }
    return runPrimaryReview(row, bullet);
  };

  const runPrimaryReview = async (row: LedgerRow, bullet: { text: string }): Promise<void> => {
    const modelId = modelFor(cfg.models, row.criticality);
    const deps: ReviewDeps = {
      model: provider(modelId),
      modelId,
      fs: fsTools,
      categoriesDocument,
      revision,
      maxSteps: cfg.maxSteps,
      tokenBudget: cfg.tokenBudget,
      virtualRoot: cfg.virtualRoot,
      transcriptsDir: cfg.transcriptsDir,
      abortSignal: hardAbort.signal,
    };

    try {
      const review = await limit(modelId, async () => {
        // Re-check after slot acquisition so a draining run skips queued rows
        // without spending inference calls (mirrors the old global gate).
        if (stopping) throw new InterruptedRowError();
        return reviewItem(row, bullet.text, deps);
      });
      const payload = {
        inventory_id: row.inventory_id,
        area: row.area,
        surface: row.surface,
        criticality: row.criticality,
        item_text: bullet.text,
        ...review.output,
        model: modelId,
        attempts: review.attempts,
        steps: review.steps,
        usage: review.usage,
        elapsed_ms: review.elapsedMs,
        revision: { head: revision.head, dirty: revision.dirty, baseline: BASELINE_REVISION },
        finished_at: new Date().toISOString(),
        final_outcome: review.output.outcome,
      };
      atomicWrite(join(cfg.resultsDir, `${row.inventory_id}.json`), `${JSON.stringify(payload, null, 2)}\n`);

      summary.outcomes.set(review.output.outcome, (summary.outcomes.get(review.output.outcome) ?? 0) + 1);
      summary.inputTokens += review.usage.inputTokens;
      summary.outputTokens += review.usage.outputTokens;

      // A finding hands the item to the adversarial reviewer: the result file is
      // already on disk and the status flips to the preliminary status, so an
      // interrupt at any point after this resumes with the adversarial pass.
      if (review.output.outcome === 'finding_identified' && adversaryEnabled) {
        await persistStatus(row, cfg.preliminaryStatus);
        console.log(
          `  ${row.inventory_id} primary → finding_identified (${review.steps} steps, ` +
            `${(review.elapsedMs / 1000).toFixed(1)}s${review.attempts > 1 ? ', retried' : ''}) — adversarial pass starting`,
        );
        return runAdversarialPass(row, bullet);
      }

      await persistStatus(row, cfg.doneStatus);
      summary.done++;
      console.log(
        `[${summary.done + summary.failed}/${total}] ${row.inventory_id} → ${review.output.outcome}` +
          ` (${review.steps} steps, ${(review.elapsedMs / 1000).toFixed(1)}s${review.attempts > 1 ? ', retried' : ''})`,
      );
    } catch (error) {
      if (error instanceof InterruptedRowError) {
        summary.skipped++;
        return;
      }
      summary.failed++;
      const message = error instanceof Error ? error.message : String(error);
      summary.failures.push({ id: row.inventory_id, error: message });
      console.error(`[${summary.done + summary.failed}/${total}] ${row.inventory_id} FAILED: ${message}`);
    }
  };

  const runAdversarialPass = async (row: LedgerRow, bullet: { text: string }): Promise<void> => {
    const resultPath = join(cfg.resultsDir, `${row.inventory_id}.json`);
    const primary = loadPrimaryResult(cfg, row.inventory_id);
    if (primary == null) {
      // Stage-two routing requires a stored finding; without one the only sane
      // recovery is to re-run the primary review.
      console.warn(
        `  ${row.inventory_id}: no stored finding in ${resultPath} — falling back to primary re-run`,
      );
      return runPrimaryReview(row, bullet);
    }

    const deps: AdversarialDeps = {
      model: provider(cfg.adversaryModel),
      modelId: cfg.adversaryModel,
      fs: fsTools,
      revision,
      maxSteps: cfg.adversaryMaxSteps,
      tokenBudget: cfg.adversaryTokenBudget,
      virtualRoot: cfg.virtualRoot,
      transcriptsDir: cfg.transcriptsDir,
      abortSignal: hardAbort.signal,
      reasoningEffort: cfg.adversaryReasoningEffort,
      providerOptionsKey: cfg.providerName,
    };

    try {
      const review = await limit(cfg.adversaryModel, async () => {
        if (stopping) throw new InterruptedRowError();
        return adversarialReview(row, bullet.text, primary, deps);
      });
      const payload = JSON.parse(readFileSync(resultPath, 'utf8'));
      payload.adversarial = {
        verdict: review.output.verdict,
        rationale: review.output.rationale,
        evidence: review.output.evidence,
        corrections: review.output.corrections ?? null,
        experiment: review.output.experiment ?? null,
        notes: review.output.notes ?? null,
        model: cfg.adversaryModel,
        reasoning_effort: cfg.adversaryReasoningEffort || null,
        attempts: review.attempts,
        steps: review.steps,
        usage: review.usage,
        elapsed_ms: review.elapsedMs,
        finished_at: new Date().toISOString(),
      };
      payload.final_outcome = finalOutcomeFor(review.output.verdict);
      atomicWrite(resultPath, `${JSON.stringify(payload, null, 2)}\n`);
      await persistStatus(row, cfg.doneStatus);

      summary.done++;
      summary.adversarialDone++;
      summary.inputTokens += review.usage.inputTokens;
      summary.outputTokens += review.usage.outputTokens;
      const verdict = review.output.verdict;
      summary.verdicts.set(verdict, (summary.verdicts.get(verdict) ?? 0) + 1);
      console.log(
        `[${summary.done + summary.failed}/${total}] ${row.inventory_id} → finding → ${verdict}` +
          ` (adversary: ${review.steps} steps, ${(review.elapsedMs / 1000).toFixed(1)}s` +
          `${review.attempts > 1 ? ', retried' : ''})`,
      );
    } catch (error) {
      if (error instanceof InterruptedRowError) {
        summary.skipped++;
        return;
      }
      summary.failed++;
      const message = error instanceof Error ? error.message : String(error);
      summary.failures.push({ id: `${row.inventory_id} (adversarial)`, error: message });
      console.error(`[${summary.done + summary.failed}/${total}] ${row.inventory_id} ADVERSARIAL FAILED: ${message}`);
    }
  };

  try {
    await Promise.all(runnable.map(row => processRow(row)));
  } finally {
    releaseLock();
  }

  const elapsedS = (Date.now() - startedAt) / 1000;
  const outcomes = [...summary.outcomes.entries()].map(([k, v]) => `${k}=${v}`).join(' ') || 'none';
  const verdicts = [...summary.verdicts.entries()].map(([k, v]) => `${k}=${v}`).join(' ') || 'none';
  console.log('\n===== SUMMARY =====');
  console.log(`Done: ${summary.done}/${total} | failed: ${summary.failed} | skipped after interrupt: ${summary.skipped} | missing bullet: ${missingBullets.length}`);
  console.log(`Outcomes: ${outcomes}${summary.adversarialDone > 0 ? ` | adversarial verdicts: ${verdicts}` : ''}`);
  console.log(
    `Tokens: ${summary.inputTokens.toLocaleString('en-US')} in / ${summary.outputTokens.toLocaleString('en-US')} out | wall time: ${elapsedS.toFixed(0)}s` +
      (summary.done > 0 ? ` | ${(summary.done / Math.max(elapsedS / 60, 1e-9)).toFixed(1)} items/min` : ''),
  );
  if (summary.failures.length > 0) {
    console.log('Failures (left at previous status, will re-run next launch):');
    for (const failure of summary.failures) {
      console.log(`  ${failure.id}: ${truncateMessage(failure.error)}`);
    }
    process.exitCode = 1;
  }
  if (hardAbort.signal.aborted) process.exitCode = 130;
}

function truncateMessage(message: string, max = 300): string {
  return message.length > max ? `${message.slice(0, max)}…` : message;
}
