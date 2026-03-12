/**
 * Results Judge — judges whether tests failures are caused by ambiguous specs
 * or genuine implementation errors.
 *
 * When the Test Runner container reports test failures, the Judge receives:
 *   - The feature specification (specification.md)
 *   - The failing test details from results.xml (JUnit XML report)
 *
 * SECURITY: The Judge does NOT receive the implementation patch (git diff).
 * Agent-controlled content would allow prompt-injection attacks to bias the Judge
 * toward spec changes that no longer reflect user intent.
 *
 * It then decides:
 *   - `isAmbiguous: false` → genuine implementation error; provide a sanitized hint
 *   - `isAmbiguous: true`  → spec was too vague; propose a clarifying addition
 *
 * The sanitized hint is safe to send back to the OpenHands agent because it describes
 * the failure in behavioral terms (never quoting hidden test code).
 */

import { Agent } from '@mastra/core/agent';
import { z } from 'zod';

import { type ModelOverrides, resolveAgentModel } from '../../llm-config.js';
import { type DrainableChunk, drainFullStream } from '../../utils/drain-stream.js';
import type { AssertionResult, AssertionSuiteResult } from '../docker/test-runner.js';

// ---------------------------------------------------------------------------
// Results Judge agent
// ---------------------------------------------------------------------------

const RESULTS_JUDGE_INSTRUCTIONS = `You are an impartial Results Judge for an AI Software Factory.

Your job is to determine whether a test failure is caused by:
  A) An ambiguous or incomplete feature specification (the test is unfair because the spec didn't define the behavior clearly enough), OR
  B) A genuine implementation error (the spec was clear, but the agent's code is wrong)

You will receive:
1. The feature specification (specification.md content)
2. A list of failing test cases with their titles and error types (e.g. AssertionError, SyntaxError)

Decision criteria:
- If the spec explicitly or strongly implies the expected behavior → GENUINE FAILURE (isAmbiguous: false)
- If the expected behavior is nowhere in the spec, or requires interpretation that a reasonable engineer could make differently → AMBIGUOUS SPEC (isAmbiguous: true)
- When in doubt, lean toward AMBIGUOUS SPEC.

Your output must be a JSON object with these fields:
{
  "isAmbiguous": boolean,
  "reason": "1-3 sentences explaining the verdict",
  "proposedSpecAddition": "If isAmbiguous=true: a concise sentence or two to ADD to the spec to remove the ambiguity. If isAmbiguous=false: empty string.",
  "sanitizedHintForAgent": "A behavioral hint to feed back to the agent (never quote or reveal hidden test code). Describe WHAT is wrong (e.g. 'The command exits with code 1 when no arguments are provided, but should exit with code 0') not HOW you know (never say 'the test checks...'). If isAmbiguous=true: empty string."
}

Output ONLY valid JSON, no other text.`;

function createResultsJudgeAgent(overrides: ModelOverrides = {}) {
  return new Agent({
    id: 'results-judge',
    name: 'ResultsJudge',
    instructions: RESULTS_JUDGE_INSTRUCTIONS,
    model: resolveAgentModel('results-judge', overrides),
  });
}

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

export const ResultsJudgeResultSchema = z.object({
  isAmbiguous: z.boolean(),
  reason: z.string(),
  proposedSpecAddition: z.string(),
  sanitizedHintForAgent: z.string(),
});

export type ResultsJudgeResult = z.infer<typeof ResultsJudgeResultSchema>;

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface RunResultsJudgeOpts {
  /** Full content of specification.md (or any spec files joined together) */
  specContent: string;
  /** Failing test cases from the vitest JSON report */
  failingSuites: AssertionSuiteResult[];
  /** CLI-level model overrides (--model). */
  overrides?: ModelOverrides;
  /** Called with each text delta from the LLM (for live display) */
  onThought?: (delta: string) => void;
  /** Called with every fullStream chunk */
  onEvent?: (chunk: DrainableChunk) => void;
  abortSignal?: AbortSignal;
}

/**
 * Formats the failing assertions into a human-readable block for the Results Judge prompt.
 *
 * SECURITY: We pass ONLY test name and error type. We NEVER pass failureMessages, stack traces,
 * or assertion expected/actual values. Those contain agent-controlled output and can be used for
 * prompt injection attacks against the Judge. See docs/security.md.
 */
function formatFailures(suites: AssertionSuiteResult[]): string {
  const lines: string[] = [];
  for (const suite of suites) {
    const failing: AssertionResult[] = suite.assertionResults.filter((a) => a.status === 'failed');
    if (failing.length === 0) continue;

    lines.push(`Suite: ${suite.name}`);
    for (const a of failing) {
      lines.push(`  Test: ${a.fullName}`);
      if (a.failureTypes.length > 0) {
        lines.push(`  Error Type: ${a.failureTypes.join(', ')}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n') || '(no structured failure details available)';
}

/**
 * Runs the Results Judge and returns its verdict.
 *
 * - If the Judge cannot be reached or its output fails schema validation,
 *   falls back to `{ isAmbiguous: false, ... }` so the loop continues normally.
 */
export async function runResultsJudge(opts: RunResultsJudgeOpts): Promise<ResultsJudgeResult> {
  const { specContent, failingSuites, overrides = {}, onThought, onEvent, abortSignal } = opts;
  const resultsJudgeAgent = createResultsJudgeAgent(overrides);

  const failureBlock = formatFailures(failingSuites);

  const prompt = `=== FEATURE SPECIFICATION ===
${specContent}

=== FAILING TESTS ===
${failureBlock}

Produce your JSON verdict now.`;

  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let text = '';
    try {
      const output = await resultsJudgeAgent.stream([{ role: 'user', content: prompt }], {
        ...(abortSignal ? { abortSignal } : {}),
      });

      const [, resultText] = await Promise.all([
        drainFullStream(output.fullStream as ReadableStream<DrainableChunk>, {
          onThought: (delta) => {
            text += delta;
            onThought?.(delta);
          },
          onEvent,
        }),
        output.text,
      ]);

      if (!text) text = resultText;

      // Strip markdown fences if the model wraps the JSON
      let jsonStr = text.trim();
      const blockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      const extracted = blockMatch?.[1];
      if (extracted) jsonStr = extracted.trim();

      const parsed = JSON.parse(jsonStr) as unknown;
      const result = ResultsJudgeResultSchema.safeParse(parsed);
      if (!result.success) {
        lastErr = new Error(
          `Schema validation failed: ${JSON.stringify(result.error.issues, null, 2)}`,
        );
        console.warn(
          `[results-judge] Attempt ${attempt}/${MAX_ATTEMPTS}: invalid JSON schema, retrying...`,
        );
        continue;
      }

      return result.data;
    } catch (err) {
      lastErr = err;
      console.warn(`[results-judge] Attempt ${attempt}/${MAX_ATTEMPTS} failed: ${String(err)}`);
    }
  }

  console.warn(`[results-judge] All ${MAX_ATTEMPTS} attempts failed. Last: ${String(lastErr)}`);
  return fallback();
}

function fallback(): ResultsJudgeResult {
  return {
    isAmbiguous: false,
    reason:
      'Results Judge could not produce a verdict; treating as genuine implementation failure.',
    proposedSpecAddition: '',
    sanitizedHintForAgent: '',
  };
}
