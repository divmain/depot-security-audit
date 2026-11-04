import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateText,
  InvalidToolInputError,
  isStepCount,
  NoSuchToolError,
  tool,
  type LanguageModel,
  type ToolSet,
} from 'ai';
import type { z } from 'zod';

/**
 * Floor for long-form record fields (evidence, rationale). Real records in this
 * harness run to thousands of characters (files/lines examined, contrasts
 * exercised, reasoning); anything this short is a stub, not an auditable record.
 */
export const MIN_RECORD_LENGTH = 200;

const PLACEHOLDER_PATTERN = /^(placeholder|place holder|tbd|todo|n\/?a|none|xxx|pending|\.+|…)$/i;

/**
 * Free-text fields must carry real content. Under forced-finalization pressure,
 * flash-tier models fill the long free-text fields with stubs like "placeholder"
 * while still satisfying the schema — that must be rejected, not recorded.
 * Long fields are exempt: real prose may legitimately *mention* placeholders
 * (e.g. evidence quoting a placeholder literal in source code), so only short
 * values are treated as stubs.
 */
export function looksLikePlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length >= 40) return false;
  return trimmed.length < 3 || PLACEHOLDER_PATTERN.test(trimmed) || /place ?holder|lorem ipsum/i.test(trimmed);
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AgentLoopResult {
  /** The schema-validated output of the final submission tool call. */
  output: any;
  attempts: number;
  steps: number;
  usage: AgentUsage;
  elapsedMs: number;
  reminders: number;
}

export interface AgentLoopOptions {
  /** Transcript label, e.g. 'review' or 'adversarial'. */
  phase: string;
  model: LanguageModel;
  modelId: string;
  /** Executable exploration tools; the terminal submit tool is added automatically. */
  tools: ToolSet;
  submitToolName: string;
  submitToolDescription: string;
  submitSchema: z.ZodType<any, any>;
  /** Noun used in guard texts, e.g. "ReviewResult" or "adversarial verdict". */
  resultNoun: string;
  systemPrompt: string;
  taskPrompt: string;
  maxSteps: number;
  tokenBudget: number;
  transcriptsDir: string;
  transcriptFile: string;
  abortSignal: AbortSignal;
  /** Provider-specific options forwarded verbatim (e.g. reasoning effort). */
  providerOptions?: Record<string, Record<string, string>>;
  /** Extra fields merged into the transcript's meta event. */
  meta?: Record<string, unknown>;
  /** Agent-specific cross-checks; returned strings become the corrective-retry reason. */
  validate: (output: any) => string[];
  /** Extra fields merged into the transcript's result event, derived from the output. */
  resultMeta: (output: any) => Record<string, unknown>;
}

/** Cross-check failures and a missing, lazy, or invalid submission are worth one retry with a corrective note. */
class InvalidAgentOutputError extends Error {}

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

/**
 * The shared tool-loop agent core: exploration tools plus one terminal
 * submission tool (tool-mode structured output), budget guards at turn
 * boundaries (soft wrap-up reminders past the token budget, forced submission
 * near the step cap), a repair path for invalid tool inputs, and one
 * corrective retry. Used by both the primary reviewer and the adversarial
 * reviewer. Fresh context per invocation by construction.
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const transcriptPath = join(options.transcriptsDir, options.transcriptFile);
  const writeLine = (obj: Record<string, unknown>): void => {
    appendFileSync(transcriptPath, `${JSON.stringify(obj)}\n`);
  };

  /**
   * Terminal submission tool. It has no execute on purpose: the SDK stops the
   * tool loop as soon as the model calls it, and the harness reads the result
   * out of the call's input. This is tool-mode structured output — it works on
   * any tool-calling model, unlike responseFormat-based structured output.
   */
  const submitTool = tool({
    description: options.submitToolDescription,
    inputSchema: options.submitSchema,
  });
  const explorationToolNames = new Set(Object.keys(options.tools));
  const tools = { ...options.tools, [options.submitToolName]: submitTool };

  writeLine({
    type: 'meta',
    ts: iso(),
    phase: options.phase,
    model: options.modelId,
    maxSteps: options.maxSteps,
    tokenBudget: options.tokenBudget,
    ...options.meta,
  });

  // Force submission two steps before the hard cap so the model still has room
  // to deliver its final result instead of being cut off mid-exploration.
  const toolStepBudget = Math.max(1, options.maxSteps - 2);
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
        : `\n\nNOTE: your previous attempt failed to produce a valid ${options.resultNoun} (${
            lastError instanceof Error ? lastError.message : String(lastError)
          }). Explore less if needed, then call ${options.submitToolName} with your final ${options.resultNoun}, filling every field with real content — no placeholders.`;

    try {
      const result = await generateText({
        model: options.model,
        tools,
        instructions: options.systemPrompt,
        prompt: options.taskPrompt + correction,
        stopWhen: isStepCount(options.maxSteps),
        maxRetries: 2,
        abortSignal: options.abortSignal,
        providerOptions: options.providerOptions,

        // Budget guards, applied at turn boundaries:
        // - token budget (conversation size = largest step's input+output): soft
        //   interrupt — steer the model to wrap up; tools stay available;
        // - step cap: hard force — only the submit tool remains, so a structured
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
              activeTools: [options.submitToolName],
              toolChoice: { type: 'tool', toolName: options.submitToolName },
              instructions:
                `${initialInstructions}\n\nSTEP CAP REACHED — the exploration tools are no longer available. ` +
                `Call ${options.submitToolName} now with your best ${options.resultNoun} based on the evidence you have already gathered. ` +
                'Write the complete record in full; placeholder values are rejected.',
            };
          }
          if (contextTokens >= options.tokenBudget) {
            if (!announced.wrapUp) {
              announced.wrapUp = true;
              writeLine({
                type: 'step-guard',
                ts: iso(),
                kind: 'wrap-up',
                stepNumber,
                contextTokens,
                tokenBudget: options.tokenBudget,
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
                `${options.resultNoun} via ${options.submitToolName} now. ` +
                `Submission will be forced after ${stepsLeft} more step${stepsLeft === 1 ? '' : 's'}.`,
            };
            const nextMessages: any[] = [...((messages as any[] | undefined) ?? []), reminder];
            return {
              instructions:
                `${initialInstructions}\n\nTOKEN BUDGET REACHED — this conversation has grown to the per-item token budget ` +
                `(${options.tokenBudget.toLocaleString('en-US')} tokens). Wrap up now: at most one or two more targeted ` +
                `tool calls if strictly necessary, then call ${options.submitToolName} with your final ${options.resultNoun} written out ` +
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
              model: options.model,
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

      // Tool-mode extraction: the result is the input of the last submit call. A
      // run that never called it, called it without any exploration, or called
      // it with invalid input is retried with a corrective note.
      const allToolCalls = (result.steps as unknown[]).flatMap(
        (step: any) => step?.toolCalls ?? [],
      );
      const submitCall = [...allToolCalls]
        .reverse()
        .find((call: any) => call?.toolName === options.submitToolName);
      if (submitCall == null) {
        throw new InvalidAgentOutputError(
          `the run ended without calling ${options.submitToolName}; finish by calling ${options.submitToolName} with your final ${options.resultNoun}`,
        );
      }
      const explored = allToolCalls.some((call: any) => explorationToolNames.has(call?.toolName));
      if (!explored) {
        throw new InvalidAgentOutputError(
          `${options.submitToolName} was called without any source exploration; examine the relevant files with the read tools first`,
        );
      }
      const parsed = options.submitSchema.safeParse(submitCall.input ?? submitCall.args);
      if (!parsed.success) {
        const issues = (parsed.error as any).issues
          .slice(0, 5)
          .map((issue: any) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
        throw new InvalidAgentOutputError(
          `${options.submitToolName} input failed schema validation: ${issues}`,
        );
      }
      const output = parsed.data;

      const problems: string[] = options.validate(output);
      if (problems.length > 0) {
        throw new InvalidAgentOutputError(problems.join('; '));
      }

      const loopResult: AgentLoopResult = {
        output,
        attempts: attempt,
        steps: result.steps.length,
        usage,
        elapsedMs: Date.now() - startedAt,
        reminders: reminderCount,
      };
      writeLine({
        type: 'result',
        ts: iso(),
        phase: options.phase,
        attempts: loopResult.attempts,
        steps: loopResult.steps,
        usage: loopResult.usage,
        reminders: loopResult.reminders,
        ...options.resultMeta(output),
      });
      return loopResult;
    } catch (error) {
      lastError = error;
      writeLine({
        type: 'attempt-error',
        ts: iso(),
        phase: options.phase,
        attempt,
        error: truncate(error instanceof Error ? error.message : String(error), 800),
      });
      if (options.abortSignal.aborted) throw error;
      if (!(error instanceof InvalidAgentOutputError)) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
