import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateText,
  InvalidToolInputError,
  isStepCount,
  NoSuchToolError,
  tool,
  type LanguageModel,
} from 'ai';
import { z } from 'zod';
import type { FsTools } from './fs-tools';
import { buildAuditTools } from './tools';
import { buildItemPrompt, buildSystemPrompt, type ItemRef, type RevisionInfo } from './prompt';

const OUTCOMES = ['reviewed_no_finding', 'finding_identified', 'needs_validation'] as const;

const findingSchema = z.object({
  title: z.string().describe('Short, specific title of the demonstrated issue.'),
  status: z
    .enum(['candidate', 'confirmed', 'documented design exposure'])
    .describe('candidate = argued but with gaps; confirmed = source-proven; documented design exposure = matches an accepted design decision.'),
  evidence_confidence: z
    .enum(['source-proven', 'partial', 'hypothesis'])
    .describe('How solid the source-only argument is.'),
  affected_inventory_ids: z
    .array(z.string())
    .describe('This item plus any other inventory IDs sharing the root cause.'),
  expected_invariant: z.string().describe('The security property that must hold, and its canonical contract.'),
  observed_behavior: z.string().describe('What the source actually does, with the decisive code path.'),
  minimum_attacker_access: z
    .string()
    .describe('Minimum attacker position and the inputs they control (anonymous, credential holder, insider, operator, IdP, dependency, network peer).'),
  boundary: z.string().describe('Canonical TB* or local LB-* boundary crossed, plus the objects/identities involved.'),
  impact: z.string().describe('Consequence classes (confidentiality/integrity/availability/authority/external effects) and affected population.'),
  severity_rationale: z.string().describe('Prerequisites, exposure, repeatability, blast radius, persistence/recovery.'),
  source_locations: z.string().describe('Exact file paths, functions, and line ranges.'),
  proposed_validation: z
    .string()
    .describe('The minimal reproduction or experiment a human with an environment would run to confirm or refute this.'),
  disposition: z.enum([
    'implementation defect',
    'protection regression',
    'exceeded accepted bound',
    'deployment mismatch',
    'deliberate exposure requiring risk review',
  ]),
  remediation: z.string().describe('Smallest change that restores the invariant, plus compatibility constraints.'),
});

export const reviewSchema = z.object({
  outcome: z.enum(OUTCOMES).describe('reviewed_no_finding | finding_identified | needs_validation'),
  category_ids: z
    .array(z.string())
    .describe('FC-* taxonomy IDs, most specific first; empty array only when no category lens applied.'),
  evidence: z
    .string()
    .min(1)
    .describe('The auditable record: files/functions/lines examined, contrasts exercised, and the reasoning.'),
  notes: z.string().describe('Remaining limits, related inventory IDs, shared root causes, next-reviewer notes.'),
  criticality_comment: z
    .string()
    .optional()
    .describe('Evidence-backed proposal to change the assigned criticality band; omit if unchanged.'),
  finding: findingSchema.optional().describe('Required when outcome is finding_identified; omit otherwise.'),
});

export type ReviewOutput = z.infer<typeof reviewSchema>;

const SUBMIT_TOOL_NAME = 'submit_review';

/**
 * Floor for the evidence record. Real evidence in this harness runs to thousands
 * of characters (files/lines examined, contrasts exercised, reasoning); anything
 * this short is a stub, not an auditable record.
 */
const MIN_EVIDENCE_LENGTH = 200;

const PLACEHOLDER_PATTERN = /^(placeholder|place holder|tbd|todo|n\/?a|none|xxx|pending|\.+|…)$/i;

/**
 * Free-text fields must carry real content. Under forced-finalization pressure,
 * flash-tier models fill the long free-text fields with stubs like "placeholder"
 * while still satisfying the schema — that must be rejected, not recorded.
 * Long fields are exempt: real prose may legitimately *mention* placeholders
 * (e.g. evidence quoting a placeholder literal in source code), so only short
 * values are treated as stubs.
 */
function looksLikePlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length >= 40) return false;
  return trimmed.length < 3 || PLACEHOLDER_PATTERN.test(trimmed) || /place ?holder|lorem ipsum/i.test(trimmed);
}

/**
 * Terminal submission tool. It has no execute on purpose: the SDK stops the tool
 * loop as soon as the model calls it, and the harness reads the ReviewResult out
 * of the call's input. This is the tool-mode structured output — it works on any
 * tool-calling model, unlike responseFormat-based structured output.
 */
const submitReviewTool = tool({
  description:
    'Submit your final ReviewResult and end the review of this inventory item. ' +
    'Call this exactly once, after your evidence gathering is complete. ' +
    'The input is the full ReviewResult object from the result contract: outcome, category_ids, ' +
    'evidence, notes, optional criticality_comment, and the finding object when outcome is finding_identified.',
  inputSchema: reviewSchema,
});

export interface ItemReview {
  output: ReviewOutput;
  attempts: number;
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
  elapsedMs: number;
}

export interface ReviewDeps {
  model: LanguageModel;
  modelId: string;
  fs: FsTools;
  categoriesDocument: string;
  revision: RevisionInfo;
  maxSteps: number;
  tokenBudget: number;
  virtualRoot: string;
  transcriptsDir: string;
  abortSignal: AbortSignal;
}

/** Cross-check failures and a missing, lazy, or invalid submit_review call are worth one retry with a corrective note. */
class InvalidReviewOutputError extends Error {}

const iso = (): string => new Date().toISOString();

function truncate(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text == null) return '';
  return text.length > max ? `${text.slice(0, max)}… [truncated]` : text;
}

/**
 * One step's size (input+output tokens); the budget guard uses the max across
 * steps as the current conversation size. Usage shape varies across
 * providers/SDK versions; read it defensively.
 */
function stepTokens(step: unknown): number {
  const usage = (step as { usage?: Record<string, unknown> })?.usage;
  if (usage == null) return 0;
  const input = Number(usage.inputTokens ?? usage.promptTokens ?? 0) || 0;
  const output = Number(usage.outputTokens ?? usage.completionTokens ?? 0) || 0;
  const total = Number(usage.totalTokens ?? 0) || 0;
  return Math.max(total, input + output);
}

function isAbortError(signal: AbortSignal): boolean {
  return signal.aborted;
}

/**
 * Runs one inventory item as a single generateText call: tool loop for exploration,
 * a final submit_review tool call for the structured result, prepareStep as the budget guard.
 * Fresh context per item by construction — nothing is carried between items.
 */
export async function reviewItem(
  item: ItemRef,
  bullet: string,
  deps: ReviewDeps,
): Promise<ItemReview> {
  const transcriptPath = join(deps.transcriptsDir, `${item.inventory_id}.jsonl`);
  const writeLine = (obj: Record<string, unknown>): void => {
    appendFileSync(transcriptPath, `${JSON.stringify(obj)}\n`);
  };

  const systemPrompt = buildSystemPrompt({
    categoriesDocument: deps.categoriesDocument,
    revision: deps.revision,
    maxSteps: deps.maxSteps,
    tokenBudget: deps.tokenBudget,
    virtualRoot: deps.virtualRoot,
  });
  const baseItemPrompt = buildItemPrompt({
    item,
    bullet,
    revision: deps.revision,
    virtualRoot: deps.virtualRoot,
  });
  const auditTools = buildAuditTools(deps.fs);
  const explorationToolNames = new Set(Object.keys(auditTools));
  const tools = { ...auditTools, [SUBMIT_TOOL_NAME]: submitReviewTool };

  writeLine({
    type: 'meta',
    ts: iso(),
    inventory_id: item.inventory_id,
    model: deps.modelId,
    maxSteps: deps.maxSteps,
    tokenBudget: deps.tokenBudget,
    revision: deps.revision,
  });

  // Force submission two steps before the hard cap so the model still has room to
  // deliver its final ReviewResult instead of being cut off mid-exploration.
  const toolStepBudget = Math.max(1, deps.maxSteps - 2);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const usage = { inputTokens: 0, outputTokens: 0 };
    const startedAt = Date.now();
    // Guards re-apply on every step, but each activation is logged once per attempt.
    const announced = { wrapUp: false, forceSubmit: false };
    // Count of wrap-up reminders injected past the token budget (this attempt).
    let reminderCount = 0;
    const correction =
      lastError == null
        ? ''
        : `\n\nNOTE: your previous attempt failed to produce a valid ReviewResult (${
            lastError instanceof Error ? lastError.message : String(lastError)
          }). Explore less if needed, then call submit_review with your final ReviewResult, filling every field with real content — no placeholders.`;

    try {
      const result = await generateText({
        model: deps.model,
        tools,
        instructions: systemPrompt,
        prompt: baseItemPrompt + correction,
        stopWhen: isStepCount(deps.maxSteps),
        maxRetries: 2,
        abortSignal: deps.abortSignal,

        // Budget guards, applied at turn boundaries:
        // - token budget (conversation size = largest step's input+output): soft
        //   interrupt — steer the model to wrap up; tools stay available;
        // - step cap: hard force — only submit_review remains, so the structured
        //   result always materializes before the SDK stops the loop.
        prepareStep: ({ stepNumber, steps, initialInstructions, messages }: any) => {
          const contextTokens: number = (steps as unknown[]).reduce(
            (max: number, step: unknown) => Math.max(max, stepTokens(step)),
            0,
          );
          if (stepNumber >= toolStepBudget) {
            if (!announced.forceSubmit) {
              announced.forceSubmit = true;
              writeLine({ type: 'step-guard', ts: iso(), kind: 'force-submit', stepNumber });
            }
            return {
              activeTools: [SUBMIT_TOOL_NAME],
              toolChoice: { type: 'tool', toolName: SUBMIT_TOOL_NAME },
              instructions:
                `${initialInstructions}\n\nSTEP CAP REACHED — the exploration tools are no longer available. ` +
                'Call submit_review now with your best ReviewResult based on the evidence you have already gathered. ' +
                'Write the complete evidence record in full; placeholder values are rejected.',
            };
          }
          if (contextTokens >= deps.tokenBudget) {
            if (!announced.wrapUp) {
              announced.wrapUp = true;
              writeLine({
                type: 'step-guard',
                ts: iso(),
                kind: 'wrap-up',
                stepNumber,
                contextTokens,
                tokenBudget: deps.tokenBudget,
              });
            }
            // Every turn past the budget gets a fresh reminder at the end of the
            // context. Recency makes it far harder to ignore than the (carried
            // forward) system-level wrap-up note alone, and the countdown to
            // forced submission escalates on its own.
            reminderCount += 1;
            const stepsLeft = Math.max(1, toolStepBudget - stepNumber);
            const reminder = {
              role: 'user',
              content:
                `[harness reminder ${reminderCount}] The token budget has been reached and you have been asked to wrap up. ` +
                'Be efficient: make no further tool calls unless strictly necessary, and return your complete ' +
                'ReviewResult via submit_review now. ' +
                `Submission will be forced after ${stepsLeft} more step${stepsLeft === 1 ? '' : 's'}.`,
            };
            const nextMessages: any[] = [...((messages as any[] | undefined) ?? []), reminder];
            return {
              instructions:
                `${initialInstructions}\n\nTOKEN BUDGET REACHED — this conversation has grown to the per-item token budget ` +
                `(${deps.tokenBudget.toLocaleString('en-US')} tokens). Wrap up now: at most one or two more targeted ` +
                'tool calls if strictly necessary, then call submit_review with your complete ReviewResult written out ' +
                'in full. Placeholder values are rejected.',
              messages: nextMessages,
            };
          }
          return undefined;
        },

        onStepEnd: (step: any) => {
          const stepUsage = step?.usage ?? {};
          usage.inputTokens += Number(stepUsage.inputTokens ?? stepUsage.promptTokens ?? 0) || 0;
          usage.outputTokens += Number(stepUsage.outputTokens ?? stepUsage.completionTokens ?? 0) || 0;
          writeLine({
            type: 'step',
            ts: iso(),
            attempt,
            stepNumber: step?.stepNumber,
            finishReason: step?.finishReason,
            usage: stepUsage,
            toolCalls: (step?.toolCalls ?? []).map((call: any) => ({
              name: call?.toolName,
              input: call?.input ?? call?.args,
            })),
            toolResults: (step?.toolResults ?? []).map((res: any) => ({
              name: res?.toolName,
              output: truncate(res?.output ?? res?.result, 600),
            })),
          });
        },

        // Weak models emit invalid tool inputs more often; repair once instead of
        // burning a whole step on a failed call. The repair itself also runs in
        // tool mode: only the broken tool is offered and the call is forced, so
        // the corrected input arrives as a schema-validated tool call.
        repairToolCall: async ({ toolCall, tools: toolSet, error }: any) => {
          if (error != null && NoSuchToolError.isInstance(error)) return null;
          if (error == null || !InvalidToolInputError.isInstance(error)) return null;
          const definition = (toolSet as Record<string, any>)[toolCall.toolName];
          if (definition == null) return null;
          try {
            const { steps: repairSteps } = await generateText({
              model: deps.model,
              tools: { [toolCall.toolName]: definition },
              toolChoice: 'required',
              prompt: [
                `A model tried to call the tool "${toolCall.toolName}" with input that failed schema validation.`,
                `Attempted input: ${truncate(toolCall.input, 800)}`,
                'Call the tool now with the corrected input. Fix only what is invalid and keep the intent.',
              ].join('\n'),
            });
            const repairedCalls = (repairSteps as any[]).flatMap(step => step?.toolCalls ?? []);
            const repaired = repairedCalls[repairedCalls.length - 1]?.input;
            if (repaired == null) return null;
            const check = (definition.inputSchema as any)?.safeParse?.(repaired);
            if (check != null && !check.success) return null;
            writeLine({
              type: 'tool-repair',
              ts: iso(),
              toolName: toolCall.toolName,
              attempted: truncate(toolCall.input, 400),
              repaired,
            });
            return { ...toolCall, input: JSON.stringify(repaired) };
          } catch {
            return null;
          }
        },
      });

      // Tool-mode extraction: the ReviewResult is the input of the last
      // submit_review call. A run that never called it, called it without any
      // exploration, or called it with invalid input is retried with a note.
      const allToolCalls = (result.steps as unknown[]).flatMap(
        (step: any) => step?.toolCalls ?? [],
      );
      const submitCall = [...allToolCalls]
        .reverse()
        .find((call: any) => call?.toolName === SUBMIT_TOOL_NAME);
      if (submitCall == null) {
        throw new InvalidReviewOutputError(
          'the review ended without calling submit_review; finish by calling submit_review with your final ReviewResult',
        );
      }
      const explored = allToolCalls.some((call: any) => explorationToolNames.has(call?.toolName));
      if (!explored) {
        throw new InvalidReviewOutputError(
          'submit_review was called without any source exploration; examine the relevant files with the read tools first',
        );
      }
      const parsed = reviewSchema.safeParse(submitCall.input ?? submitCall.args);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .slice(0, 5)
          .map(issue => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
        throw new InvalidReviewOutputError(
          `submit_review input failed ReviewResult schema validation: ${issues}`,
        );
      }
      const output = parsed.data as ReviewOutput;

      const problems: string[] = [];
      if (output.outcome === 'finding_identified' && output.finding == null) {
        problems.push('outcome is finding_identified but the finding object is missing');
      }
      if (output.category_ids.some(id => !id.startsWith('FC-'))) {
        problems.push('category_ids must contain FC-* taxonomy IDs');
      }
      if (looksLikePlaceholder(output.evidence) || output.evidence.trim().length < MIN_EVIDENCE_LENGTH) {
        problems.push(`evidence must be the full auditable record (${MIN_EVIDENCE_LENGTH}+ characters, no placeholders)`);
      }
      if (looksLikePlaceholder(output.notes)) {
        problems.push('notes must contain real content, not a placeholder');
      }
      if (output.finding != null) {
        for (const [field, value] of Object.entries(output.finding)) {
          if (typeof value === 'string' && looksLikePlaceholder(value)) {
            problems.push(`finding.${field} must contain real content, not a placeholder`);
          }
        }
        if (output.finding.affected_inventory_ids.some(id => !/^[A-Z]+-\d+$/.test(id))) {
          problems.push('finding.affected_inventory_ids must contain inventory IDs like HTTP-058');
        }
      }
      if (problems.length > 0) {
        throw new InvalidReviewOutputError(problems.join('; '));
      }

      const review: ItemReview = {
        output,
        attempts: attempt,
        steps: result.steps.length,
        usage,
        elapsedMs: Date.now() - startedAt,
      };
      writeLine({
        type: 'result',
        ts: iso(),
        attempts: review.attempts,
        steps: review.steps,
        usage: review.usage,
        outcome: review.output.outcome,
        category_ids: review.output.category_ids,
        reminders: reminderCount,
      });
      return review;
    } catch (error) {
      lastError = error;
      writeLine({
        type: 'attempt-error',
        ts: iso(),
        attempt,
        error: truncate(error instanceof Error ? error.message : String(error), 800),
      });
      if (isAbortError(deps.abortSignal)) throw error;
      if (!(error instanceof InvalidReviewOutputError)) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
