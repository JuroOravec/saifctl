/**
 * Check pipeline — Types, Lint, Dead Code, Format, Tests & Coverage, Custom Constraints.
 * Used by CI and for local verification before commit/push.
 *
 * Runs ALL phases unconditionally, even after one fails — the final report
 * aggregates results from every phase. This is deliberate for the
 * agent-reporter mode: a calling agent (or the saifctl gate that ships the
 * output back into the convergence loop) sees every outstanding failure in
 * one pass and can fix them as a batch, instead of ping-ponging one phase
 * at a time. Exit code is 0 iff every phase passed.
 *
 * Exported as runCheck() for use by the commands CLI.
 */

import { consola } from '../logger.js';
import { spawnUserCmd, spawnUserCmdCapture } from '../utils/io.js';

const phases = [
  { name: 'Types', command: 'npx tsc --noEmit' },
  { name: 'Lint', command: 'npm run lint' },
  { name: 'Lint Workflows', command: 'npm run lint:workflows' },
  { name: 'Dead Code', command: 'npm run knip' },
  { name: 'Format', command: 'npm run format:check' },
  { name: 'Custom Constraints', command: 'npm run validate' },
  { name: 'Tests & Coverage', command: 'npm run coverage' },
];

/** Cap per-phase captured output (agent-reporter mode) at this many trailing
 *  lines. With 7 phases × 60 lines = up to ~420 lines aggregate, still
 *  bounded enough for the agent's prompt budget without losing the actual
 *  failure context that's typically at the tail of a tool's stderr. */
const PHASE_OUTPUT_TAIL_LINES = 60;

/** Per-phase result. `details` carries the captured-output tail on failure
 *  in agent-reporter mode; absent on success and in inherited-stdio mode
 *  (where the user already saw the output stream live). */
interface PhaseResult {
  name: string;
  command: string;
  status: 'PASSED' | 'FAILED';
  details?: string;
  exitCode?: number;
}

async function runPhase(opts: {
  name: string;
  command: string;
  captureOutput: boolean;
}): Promise<PhaseResult> {
  const { name, command, captureOutput } = opts;
  if (captureOutput) {
    try {
      await spawnUserCmdCapture(command, { cwd: process.cwd() });
      return { name, command, status: 'PASSED' };
    } catch (error: unknown) {
      const err = error as { output?: string; code?: number };
      const output = err.output ?? '';
      const tail = output.split('\n').slice(-PHASE_OUTPUT_TAIL_LINES).join('\n').trim();
      return {
        name,
        command,
        status: 'FAILED',
        details: tail || 'No output',
        exitCode: err.code ?? 1,
      };
    }
  }
  try {
    await spawnUserCmd({ script: command, cwd: process.cwd(), stdio: 'inherit' });
    return { name, command, status: 'PASSED' };
  } catch (error: unknown) {
    const err = error as Error & { code?: number };
    return { name, command, status: 'FAILED', exitCode: err.code ?? 1 };
  }
}

/**
 * Run the check pipeline. All phases run unconditionally; the function
 * returns after every phase has executed.
 *
 * - **`reporter === 'agent'`**: stdout is a single JSON object with the
 *   overall status + a `phases` array of per-phase results. Failures carry
 *   a `details` field with the captured-output tail.
 * - **otherwise (human-readable)**: each phase's output streams live via
 *   `stdio: 'inherit'`; per-phase status lines (✅ / ❌) print between
 *   phases; a final summary lists the failed phases by name.
 *
 * Exits 0 iff every phase passed; 1 otherwise.
 */
export async function runCheck(opts: { reporter?: string }): Promise<void> {
  const isAgentReporter = opts.reporter === 'agent';

  const results: PhaseResult[] = [];
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const phaseName = `Phase ${i + 1}: ${phase.name}`;
    if (!isAgentReporter) {
      consola.log(`\n--- Running ${phaseName} ---`);
    }
    const result = await runPhase({
      name: phaseName,
      command: phase.command,
      captureOutput: isAgentReporter,
    });
    results.push(result);
    if (!isAgentReporter) {
      if (result.status === 'PASSED') {
        consola.log(`✅ ${phaseName} passed`);
      } else {
        consola.error(`❌ ${phaseName} failed (exit ${result.exitCode ?? 1})`);
      }
    }
  }

  const anyFailed = results.some((r) => r.status === 'FAILED');

  if (isAgentReporter) {
    consola.log(
      JSON.stringify({
        status: anyFailed ? 'FAILED' : 'PASSED',
        phases: results.map((r) => {
          // Drop undefined fields so the JSON stays compact.
          const out: Record<string, unknown> = {
            name: r.name,
            command: r.command,
            status: r.status,
          };
          if (r.details !== undefined) out.details = r.details;
          if (r.exitCode !== undefined) out.exitCode = r.exitCode;
          return out;
        }),
      }),
    );
  } else if (anyFailed) {
    const failed = results.filter((r) => r.status === 'FAILED');
    consola.error(
      `\n❌ ${failed.length} of ${results.length} phase(s) failed: ${failed.map((r) => r.name).join(', ')}`,
    );
  } else {
    consola.log('\n✅ All phases passed successfully.');
  }

  if (anyFailed) {
    process.exit(1);
  }
}
