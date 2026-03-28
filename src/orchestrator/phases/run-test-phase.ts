/**
 * Phase: run-test-phase
 *
 * Spins up the staging engine, runs the test suite, tears down, and returns
 * the result. Handles inner test-retry logic (flaky test environments).
 */

import { createEngine } from '../../engines/index.js';
import { defaultEngineLog } from '../../engines/logs.js';
import type { TestsResult } from '../../engines/types.js';
import { consola } from '../../logger.js';
import type { CleanupRegistry } from '../../utils/cleanup.js';
import { type IterativeLoopOpts, prepareTestRunnerOpts } from '../loop.js';
import type { Sandbox } from '../sandbox.js';

export interface RunTestPhaseInput {
  sandbox: Sandbox;
  /** Outer attempt index (1-indexed) */
  attempt: number;
  opts: Pick<
    IterativeLoopOpts,
    | 'sandboxProfileId'
    | 'feature'
    | 'projectDir'
    | 'projectName'
    | 'testImage'
    | 'testScript'
    | 'testRetries'
    | 'stagingEnvironment'
  >;
  registry: CleanupRegistry | null;
  /** Optional abort signal forwarded to runTests(). */
  signal?: AbortSignal;
}

export interface RunTestPhaseOutput {
  result: TestsResult;
  /** Run ID used for the final test attempt */
  testRunId: string;
}

export async function runTestPhase(input: RunTestPhaseInput): Promise<RunTestPhaseOutput> {
  const { sandbox, attempt, opts, registry, signal } = input;
  const {
    sandboxProfileId,
    feature,
    projectDir,
    projectName,
    testImage,
    testScript,
    testRetries,
    stagingEnvironment,
  } = opts;

  const testRunnerOpts = await prepareTestRunnerOpts({
    feature,
    sandboxBasePath: sandbox.sandboxBasePath,
    testScript,
  });

  let lastResult: TestsResult = { status: 'failed', stderr: '', stdout: '', rawJunitXml: null };
  let testRunId = '';

  for (let testAttempt = 1; testAttempt <= testRetries; testAttempt++) {
    testRunId = `${sandbox.runId}-${attempt}-${testAttempt}`;
    consola.log(
      `\n[orchestrator] Test attempt ${testAttempt}/${testRetries} (outer attempt ${attempt})`,
    );

    const stagingEngine = createEngine(stagingEnvironment);
    registry?.registerEngine(stagingEngine, testRunId);

    lastResult = await (async (): Promise<TestsResult> => {
      try {
        const stagingHandle = await stagingEngine.startStaging({
          sandboxProfileId,
          codePath: sandbox.codePath,
          projectDir,
          stagingEnvironment,
          feature,
          projectName,
          saifacPath: sandbox.saifacPath,
          onLog: defaultEngineLog,
        });

        return await stagingEngine.runTests({
          ...testRunnerOpts,
          stagingHandle,
          testImage,
          runId: testRunId,
          feature,
          projectName,
          signal,
          onLog: defaultEngineLog,
        });
      } finally {
        registry?.deregisterEngine(stagingEngine);
        await stagingEngine.teardown({ runId: testRunId });
      }
    })();

    if (lastResult.runnerError) {
      throw new Error(
        `Test runner error on attempt ${attempt}: ${lastResult.runnerError}\n` +
          `Check that runner.spec.ts and tests.json are present and valid.\n` +
          `Stderr:\n${lastResult.stderr}`,
      );
    }

    if (lastResult.status === 'passed' || lastResult.status === 'aborted') break;
  }

  return { result: lastResult, testRunId };
}
