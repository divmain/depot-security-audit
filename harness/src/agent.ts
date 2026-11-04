import type { LanguageModel } from 'ai';
import { z } from 'zod';
import type { FsTools } from './fs-tools';
import { buildAuditTools } from './tools';
import { buildItemPrompt, buildSystemPrompt, type ItemRef, type RevisionInfo } from './prompt';
import { looksLikePlaceholder, MIN_RECORD_LENGTH, runAgentLoop } from './agent-loop';

const OUTCOMES = ['reviewed_no_finding', 'finding_identified', 'needs_validation'] as const;

export const findingSchema = z.object({
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

export type FindingOutput = z.infer<typeof findingSchema>;

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

/** Primary-reviewer cross-checks on an otherwise schema-valid ReviewResult. */
function validateReviewOutput(output: ReviewOutput): string[] {
  const problems: string[] = [];
  if (output.outcome === 'finding_identified' && output.finding == null) {
    problems.push('outcome is finding_identified but the finding object is missing');
  }
  if (output.category_ids.some(id => !id.startsWith('FC-'))) {
    problems.push('category_ids must contain FC-* taxonomy IDs');
  }
  if (looksLikePlaceholder(output.evidence) || output.evidence.trim().length < MIN_RECORD_LENGTH) {
    problems.push(`evidence must be the full auditable record (${MIN_RECORD_LENGTH}+ characters, no placeholders)`);
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
  return problems;
}

/**
 * Runs one inventory item's primary review on the shared agent loop: tool loop
 * for exploration, a final submit_review call for the structured result.
 */
export async function reviewItem(
  item: ItemRef,
  bullet: string,
  deps: ReviewDeps,
): Promise<ItemReview> {
  const systemPrompt = buildSystemPrompt({
    categoriesDocument: deps.categoriesDocument,
    revision: deps.revision,
    maxSteps: deps.maxSteps,
    tokenBudget: deps.tokenBudget,
    virtualRoot: deps.virtualRoot,
  });
  const taskPrompt = buildItemPrompt({
    item,
    bullet,
    revision: deps.revision,
    virtualRoot: deps.virtualRoot,
  });

  const result = await runAgentLoop({
    phase: 'review',
    model: deps.model,
    modelId: deps.modelId,
    tools: buildAuditTools(deps.fs),
    submitToolName: 'submit_review',
    submitToolDescription:
      'Submit your final ReviewResult and end the review of this inventory item. ' +
      'Call this exactly once, after your evidence gathering is complete. ' +
      'The input is the full ReviewResult object from the result contract: outcome, category_ids, ' +
      'evidence, notes, optional criticality_comment, and the finding object when outcome is finding_identified. ' +
      'The input is recorded verbatim as the final result — there is no follow-up turn to refine it, ' +
      'so never submit placeholder values.',
    submitSchema: reviewSchema,
    resultNoun: 'ReviewResult',
    systemPrompt,
    taskPrompt,
    maxSteps: deps.maxSteps,
    tokenBudget: deps.tokenBudget,
    transcriptsDir: deps.transcriptsDir,
    transcriptFile: `${item.inventory_id}.jsonl`,
    abortSignal: deps.abortSignal,
    meta: { inventory_id: item.inventory_id, revision: deps.revision },
    validate: validateReviewOutput,
    resultMeta: output => ({ outcome: output.outcome, category_ids: output.category_ids }),
  });

  return {
    output: result.output as ReviewOutput,
    attempts: result.attempts,
    steps: result.steps,
    usage: result.usage,
    elapsedMs: result.elapsedMs,
  };
}
