import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { findingSchema, type FindingOutput } from './agent';
import {
  looksLikePlaceholder,
  MIN_RECORD_LENGTH,
  runAgentLoop,
  type AgentUsage,
} from './agent-loop';
import {
  buildAdversarialSystemPrompt,
  buildAdversarialTaskPrompt,
  type ItemRef,
  type RevisionInfo,
} from './prompt';
import { buildAuditTools } from './tools';
import type { FsTools } from './fs-tools';

export const adversarialSchema = z.object({
  verdict: z
    .enum(['upheld', 'overstated', 'understated', 'refuted', 'undecidable'])
    .describe(
      'upheld = re-derived and accurate as stated; overstated = real issue but severity/impact/access/disposition is wrong; ' +
        'understated = real issue and worse than stated; refuted = erroneous (path unreachable, guard exists, invariant holds, or cited lines do not support the claim); ' +
        'undecidable = source reading cannot decide.',
    ),
  rationale: z
    .string()
    .describe(
      'The decisive reasoning for the verdict: which links of the finding survived adversarial attack, which broke, with exact files/functions/lines.',
    ),
  evidence: z
    .string()
    .min(1)
    .describe(
      'The auditable record of this adversarial pass: files/functions/lines examined, which mitigations you hunted for and where you looked, and the contrasts you exercised.',
    ),
  corrections: findingSchema
    .partial()
    .optional()
    .describe(
      'Corrected values for every disputed finding field. Required when the verdict is overstated, understated, or refuted; omit otherwise.',
    ),
  experiment: z
    .string()
    .optional()
    .describe(
      'The decisive experiment a human with an environment would run to decide the question. Required when the verdict is undecidable.',
    ),
  notes: z.string().optional().describe('Residual limits and notes for the next reviewer.'),
});

export type AdversarialOutput = z.infer<typeof adversarialSchema>;

export type FinalOutcome =
  | 'finding_upheld'
  | 'finding_overstated'
  | 'finding_understated'
  | 'finding_refuted'
  | 'needs_validation';

export function finalOutcomeFor(verdict: AdversarialOutput['verdict']): FinalOutcome {
  switch (verdict) {
    case 'upheld':
      return 'finding_upheld';
    case 'overstated':
      return 'finding_overstated';
    case 'understated':
      return 'finding_understated';
    case 'refuted':
      return 'finding_refuted';
    case 'undecidable':
      return 'needs_validation';
  }
}

export interface AdversarialDeps {
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

export interface AdversarialReview {
  output: AdversarialOutput;
  attempts: number;
  steps: number;
  usage: AgentUsage;
  elapsedMs: number;
}

/** The primary result a finding is drawn from, as passed to the adversary. */
export interface AdversarialSubject {
  outcome: string;
  evidence: string;
  notes: string;
  finding: FindingOutput;
}

/** Adversarial cross-checks on an otherwise schema-valid verdict. */
function validateAdversarialOutput(output: AdversarialOutput): string[] {
  const problems: string[] = [];
  if (looksLikePlaceholder(output.rationale) || output.rationale.trim().length < MIN_RECORD_LENGTH) {
    problems.push(`rationale must be the full decisive reasoning (${MIN_RECORD_LENGTH}+ characters, no placeholders)`);
  }
  if (looksLikePlaceholder(output.evidence) || output.evidence.trim().length < MIN_RECORD_LENGTH) {
    problems.push(`evidence must be the full adversarial record (${MIN_RECORD_LENGTH}+ characters, no placeholders)`);
  }
  const needsCorrections =
    output.verdict === 'overstated' || output.verdict === 'understated' || output.verdict === 'refuted';
  if (needsCorrections && (output.corrections == null || Object.keys(output.corrections).length === 0)) {
    problems.push(`verdict ${output.verdict} requires corrections naming the disputed finding fields`);
  }
  if (output.verdict === 'undecidable' && (output.experiment == null || looksLikePlaceholder(output.experiment))) {
    problems.push('verdict undecidable requires a decisive experiment');
  }
  if (output.verdict === 'upheld' && output.corrections != null) {
    problems.push('corrections must be omitted when the verdict is upheld');
  }
  if (output.corrections != null) {
    for (const [field, value] of Object.entries(output.corrections)) {
      if (typeof value === 'string' && looksLikePlaceholder(value)) {
        problems.push(`corrections.${field} must contain real content, not a placeholder`);
      }
    }
    const ids = output.corrections.affected_inventory_ids;
    if (ids != null && ids.some(id => !/^[A-Z]+-\d+$/.test(id))) {
      problems.push('corrections.affected_inventory_ids must contain inventory IDs like HTTP-058');
    }
  }
  return problems;
}

/**
 * Adversarially reviews one primary finding: same read-only tools as the primary
 * reviewer, fresh context, a different (stronger) model, and a mandate to
 * break the finding. The primary reviewer's transcript is deliberately not
 * shared — the adversary must re-derive the evidence itself.
 */
export async function adversarialReview(
  item: ItemRef,
  bullet: string,
  primary: AdversarialSubject,
  deps: AdversarialDeps,
): Promise<AdversarialReview> {
  const systemPrompt = buildAdversarialSystemPrompt({
    revision: deps.revision,
    maxSteps: deps.maxSteps,
    tokenBudget: deps.tokenBudget,
    virtualRoot: deps.virtualRoot,
  });
  const taskPrompt = buildAdversarialTaskPrompt({
    item,
    bullet,
    primary,
    revision: deps.revision,
    virtualRoot: deps.virtualRoot,
  });

  const providerOptions =
    deps.reasoningEffort != null && deps.reasoningEffort !== ''
      ? { [deps.providerOptionsKey]: { reasoningEffort: deps.reasoningEffort } }
      : undefined;

  const result = await runAgentLoop({
    phase: 'adversarial',
    model: deps.model,
    modelId: deps.modelId,
    tools: buildAuditTools(deps.fs),
    submitToolName: 'submit_verdict',
    submitToolDescription:
      'Submit your final verdict and end the adversarial pass. Call this exactly once, after your ' +
      'verification is complete. The input is the full verdict object from the result contract: verdict, ' +
      'rationale, evidence, corrections (when disputing the finding), experiment (when undecidable), and optional notes.',
    submitSchema: adversarialSchema,
    resultNoun: 'adversarial verdict',
    systemPrompt,
    taskPrompt,
    maxSteps: deps.maxSteps,
    tokenBudget: deps.tokenBudget,
    transcriptsDir: deps.transcriptsDir,
    transcriptFile: `${item.inventory_id}.adversary.jsonl`,
    abortSignal: deps.abortSignal,
    providerOptions,
    meta: { inventory_id: item.inventory_id, revision: deps.revision },
    validate: validateAdversarialOutput,
    resultMeta: output => ({ verdict: output.verdict, final_outcome: finalOutcomeFor(output.verdict) }),
  });

  return {
    output: result.output as AdversarialOutput,
    attempts: result.attempts,
    steps: result.steps,
    usage: result.usage,
    elapsedMs: result.elapsedMs,
  };
}
