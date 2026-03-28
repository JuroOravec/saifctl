/**
 * LocalEngine — runs the coding agent on the host (no container / Leash).
 *
 * Used when `environments.coding.engine` is `local` (e.g. via `--engine local`).
 * Staging and tests still use {@link DockerEngine} or a future HelmEngine.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { consola } from '../../logger.js';
import type {
  AgentResult,
  CoderInspectSessionHandle,
  Engine,
  EngineSetupOpts,
  EngineTeardownOpts,
  RunAgentOpts,
  RunTestsOpts,
  StagingHandle,
  StartInspectOpts,
  StartStagingOpts,
  TestsResult,
} from '../types.js';

export class LocalEngine implements Engine {
  /** Set in {@link setup}; used for logs matching {@link DockerEngine.runAgent}. */
  private runId = '';

  async setup(opts: EngineSetupOpts): Promise<void> {
    this.runId = opts.runId;
  }

  async teardown(_opts: EngineTeardownOpts): Promise<void> {
    // Nothing to tear down.
  }

  async startStaging(_opts: StartStagingOpts): Promise<StagingHandle> {
    throw new Error(
      '[engine] LocalEngine does not support staging. Use docker or helm for environments.staging.',
    );
  }

  async runTests(_opts: RunTestsOpts): Promise<TestsResult> {
    throw new Error(
      '[engine] LocalEngine does not support tests. Use docker or helm for environments.staging.',
    );
  }

  async runAgent(opts: RunAgentOpts): Promise<AgentResult> {
    const { codePath, containerEnv, saifacPath, signal, onAgentStdout, onAgentStdoutEnd, onLog } =
      opts;

    const coderStartHost = join(saifacPath, 'coder-start.sh');
    const cmd = 'bash';
    const args = [coderStartHost];
    const argsForPrint = [coderStartHost];

    consola.log('[agent-runner] Mode: local engine (host execution, filesystem sandbox only)');

    consola.debug(`[agent-runner] containerEnv (public): ${JSON.stringify(containerEnv.env)}`);
    consola.debug(
      `[agent-runner] containerEnv.secret keys: ${Object.keys(containerEnv.secretEnv).sort().join(', ')}`,
    );

    consola.log(`[agent-runner] Starting agent (run ID: ${this.runId})`);
    consola.log(
      `[agent-runner] Command: ${cmd} ${argsForPrint.map((s) => s.slice(0, 100)).join(' ')}`,
    );

    const spawnEnv: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][],
      ),
      ...containerEnv.env,
      ...containerEnv.secretEnv,
    };

    const timeoutMs = 20 * 60 * 1000;

    const { exitCode, output } = await new Promise<{ exitCode: number; output: string }>(
      (resolve, reject) => {
        const child = spawn(cmd, args, {
          cwd: codePath,
          env: spawnEnv,
          stdio: ['inherit', 'pipe', 'pipe'],
        });

        let collected = '';
        const endAgentStdout = (): void => onAgentStdoutEnd?.();

        child.stdout.on('data', (chunk: Buffer) => {
          const text = chunk.toString();
          collected += text;
          onAgentStdout(text);
        });

        child.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString();
          onLog({ source: 'coder', stream: 'stderr', raw: text });
          collected += text;
        });

        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(`Agent timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        const onAbort = () => {
          child.kill();
          clearTimeout(timer);
          reject(new Error('Agent step cancelled via abort signal'));
        };

        if (signal) {
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener('abort', onAbort, { once: true });
          }
        }

        child.on('error', (err) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          endAgentStdout();
          reject(err);
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          endAgentStdout();
          resolve({ exitCode: code ?? 1, output: collected });
        });
      },
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      consola.error(`[agent-runner] Process error: ${msg}`);
      return { exitCode: 1, output: msg };
    });

    consola.log(`[agent-runner] Finished with exit code ${exitCode}`);
    return { success: exitCode === 0, exitCode, output };
  }

  async startInspect(_opts: StartInspectOpts): Promise<CoderInspectSessionHandle> {
    throw new Error(
      '[engine] run inspect needs a container coding engine. Use --engine coding=docker (or omit --engine local) for inspect.',
    );
  }
}
