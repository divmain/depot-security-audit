import type { LanguageModel } from 'ai';
import { z } from 'zod';
import type { FindingOutput } from './agent';
import {
  looksLikePlaceholder,
  MIN_RECORD_LENGTH,
  runAgentLoop,
  type AgentUsage,
} from './agent-loop';
import {
  buildRemediationSystemPrompt,
  buildRemediationTaskPrompt,
  type ItemRef,
  type RevisionInfo,
} from './prompt';
import { buildAuditTools } from './tools';
import type { FsTools } from './fs-tools';

export const remediationSchema = z.object({
  title: z.string().min(1).describe('Short, specific name for this remediation option.'),
  primaryRecommendation: z
    .boolean()
    .describe('True only for the single primary recommended remediation.'),
  description: z
    .string()
    .min(1)
    .describe(
      'How to fix the issue, in 2-5 paragraphs: exactly what to change, where (files, functions, lines), ' +
        'and why the change restores the violated invariant.',
    ),
  scope: z
    .enum(['targeted', 'single-file', 'multi-file', 'requires-redesign'])
    .describe(
      'Invasiveness ladder: targeted = minimal localized patch, typically a few lines at one site; ' +
        'single-file = substantial but contained change within one module; ' +
        'multi-file = coordinated change across modules; ' +
        'requires-redesign = the invariant needs architectural rework.',
    ),
  tradeOffs: z
    .string()
    .optional()
    .describe('When to prefer this option over the others (cost, risk, coverage, compatibility).'),
  residualRisk: z
    .string()
    .optional()
    .describe('What this option deliberately leaves unfixed (e.g. sibling sites, related attack classes).'),
});

export const remediationOutputSchema = z.object({
  remediations: z
    .array(remediationSchema)
    .min(1)
    .max(3)
    .describe(
      '1-3 remediation options, exactly one marked primary. Offer multiple options only when genuinely ' +
        'distinct approaches exist.',
    ),
  evidence: z
    .string()
    .min(1)
    .describe(
      'The auditable record of this remediation pass: files/functions/lines examined to ground the ' +
        'proposals in real code.',
    ),
  notes: z.string().optional().describe('Residual limits and notes for the next reviewer.'),
});

export type Remediation = z.infer<typeof remediationSchema>;
export type RemediationOutput = z.infer<typeof remediationOutputSchema>;

/** Verdicts that count as a confirmed finding and trigger the remediation pass. */
const CONFIRMING_VERDICTS = new Set(['upheld', 'overstated', 'understated']);

export function isConfirmingVerdict(verdict: string): boolean {
  return CONFIRMING_VERDICTS.has(verdict);
}

export interface RemediationDeps {
  model: LanguageModel;
  modelId: string;
  fs: FsTools;
  revision: RevisionInfo;
  maxSteps: number;
  tokenBudget: number;
  virtualRoot: string;
  transcriptsDir: string;
  abortSignal: AbortSignal;
  /** Reasoning effort forwarded to the provider (e.g. reasoning_effort); empty/undefined sends nothing. */
  reasoningEffort?: string;
  /** Provider-options namespace key the endpoint expects (cfg.providerName). */
  providerOptionsKey: string;
}

export interface RemediationReview {
  output: RemediationOutput;
  attempts: number;
  steps: number;
  usage: AgentUsage;
  elapsedMs: number;
}

/**
 * The adjudicated material the remediation designer works from: the effective
 * finding (the primary finding with the adversarial corrections applied),
 * the verdict that confirmed it, and both prior agents' records.
 */
export interface RemediationSubject {
  verdict: string;
  finding: FindingOutput;
  adversarialRationale: string;
  primaryEvidence: string;
  notes: string;
}

/** Remediation cross-checks on an otherwise schema-valid plan. */
function validateRemediationOutput(output: RemediationOutput): string[] {
  const problems: string[] = [];
  const primaries = output.remediations.filter(r => r.primaryRecommendation);
  if (primaries.length !== 1) {
    problems.push(
      `exactly one remediation must be the primary recommendation (got ${primaries.length})`,
    );
  }
  if (looksLikePlaceholder(output.evidence) || output.evidence.trim().length < MIN_RECORD_LENGTH) {
    problems.push(`evidence must be the full remediation record (${MIN_RECORD_LENGTH}+ characters, no placeholders)`);
  }
  for (const remediation of output.remediations) {
    if (looksLikePlaceholder(remediation.title) || remediation.title.trim().length < 8) {
      problems.push('each remediation needs a real, specific title');
    }
    if (looksLikePlaceholder(remediation.description) || remediation.description.trim().length < MIN_RECORD_LENGTH) {
      problems.push(
        `remediation "${remediation.title}" description must be the full 2-5 paragraph fix write-up ` +
          `(${MIN_RECORD_LENGTH}+ characters, no placeholders)`,
      );
    }
    for (const field of ['tradeOffs', 'residualRisk'] as const) {
      const value = remediation[field];
      if (value != null && looksLikePlaceholder(value)) {
        problems.push(`remediation "${remediation.title}" ${field} must contain real content, not a placeholder`);
      }
    }
  }
  return problems;
}

/**
 * Designs remediations for one confirmed finding: same read-only tools as the
 * earlier agents, fresh context, and a solution-design mandate. It receives
 * the effective finding (corrections applied) and must ground its proposals
 * in the actual source rather than re-litigating the finding.
 */
export async function remediationReview(
  item: ItemRef,
  bullet: string,
  subject: RemediationSubject,
  deps: RemediationDeps,
): Promise<RemediationReview> {
  const systemPrompt = buildRemediationSystemPrompt({
    revision: deps.revision,
    maxSteps: deps.maxSteps,
    tokenBudget: deps.tokenBudget,
    virtualRoot: deps.virtualRoot,
  });
  const taskPrompt = buildRemediationTaskPrompt({
    item,
    bullet,
    subject,
    revision: deps.revision,
    virtualRoot: deps.virtualRoot,
  });

  const providerOptions =
    deps.reasoningEffort != null && deps.reasoningEffort !== ''
      ? { [deps.providerOptionsKey]: { reasoningEffort: deps.reasoningEffort } }
      : undefined;

  const result = await runAgentLoop({
    phase: 'remediation',
    model: deps.model,
    modelId: deps.modelId,
    tools: buildAuditTools(deps.fs),
    submitToolName: 'submit_remediation',
    submitToolDescription:
      'Submit your final remediation plan and end the remediation pass. Call this exactly once, after your ' +
      'design work is complete. The input is the remediation plan: 1-3 remediations (exactly one marked ' +
      'primary) plus the evidence record. The input is recorded verbatim as the final result — there is no ' +
      'follow-up turn to refine it, so never submit placeholder values.',
    submitSchema: remediationOutputSchema,
    resultNoun: 'remediation plan',
    systemPrompt,
    taskPrompt,
    maxSteps: deps.maxSteps,
    tokenBudget: deps.tokenBudget,
    transcriptsDir: deps.transcriptsDir,
    transcriptFile: `${item.inventory_id}.remediation.jsonl`,
    abortSignal: deps.abortSignal,
    providerOptions,
    meta: { inventory_id: item.inventory_id, revision: deps.revision },
    validate: validateRemediationOutput,
    resultMeta: output => {
      const primary = (output.remediations as Remediation[]).find(
        (r: Remediation) => r.primaryRecommendation,
      );
      return {
        remediation_count: output.remediations.length,
        primary_scope: primary?.scope ?? null,
      };
    },
  });

  return {
    output: result.output as RemediationOutput,
    attempts: result.attempts,
    steps: result.steps,
    usage: result.usage,
    elapsedMs: result.elapsedMs,
  };
}
