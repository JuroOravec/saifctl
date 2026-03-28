/**
 * Engine interface — lifecycle contract for infrastructure adaptors.
 *
 * An Engine manages the full lifecycle of an isolated SAIFAC run environment:
 *   1. setup()        — create an isolated network + start background services (databases, etc.)
 *   2. startStaging() — build & boot the application under test (Container A) with sidecar
 *   3. runTests()     — run test runner (black-box tests) (Container B) and return results
 *   4. runAgent()     — spawn the AI coding agent container and return when it exits
 *   4b. startInspect() — idle coder container for `run inspect` (same mounts/network as runAgent)
 *   5. teardown()     — stop and remove all resources created during this run
 *
 * DockerEngine is the concrete implementation for Docker (with optional Compose services).
 * A HelmEngine would implement the same interface using Kubernetes.
 */

import type { SupportedSandboxProfileId } from '../sandbox-profiles/types.js';
import type { Feature } from '../specs/discover.js';
import type { EngineOnLog } from './logs.js';

export type { EngineLogEvent, EngineLogSource, EngineOnLog } from './logs.js';

// ---------------------------------------------------------------------------
// Shared value objects (implementation-agnostic)
// ---------------------------------------------------------------------------

/**
 * Returned by startStaging(). Carries the abstract addressing information
 * (URLs) the test runner needs to talk to the staging app.
 * Implementation-agnostic.
 */
export interface StagingHandle {
  /** URL where the staging app can be reached (from inside the environment). */
  targetUrl: string;
  /** URL where the injected sidecar HTTP server can be reached. */
  sidecarUrl: string;
}

/** Outcome of a test run (mutually exclusive). */
export type TestRunStatus = 'passed' | 'failed' | 'aborted';

/** Raw test result from an engine. */
export interface TestsResult {
  status: TestRunStatus;
  stderr: string;
  stdout: string;
  /**
   * Set when the test runner itself crashed before producing any test signal
   * (e.g. missing test files, syntax errors, missing imports).
   */
  runnerError?: string;
  /**
   * Raw JUnit XML from the test report file, if read successfully.
   * Orchestrator parses with `parseJUnitXmlString`.
   */
  rawJunitXml: string | null;
}

export interface AssertionSuiteResult {
  name: string;
  status: string;
  assertionResults: AssertionResult[];
}

export interface AssertionResult {
  title: string;
  fullName: string;
  status: 'passed' | 'failed' | 'pending' | 'todo';
  ancestorTitles: string[];
  /** Raw failure message — NOT forwarded to the vague-specs-check (prompt-injection risk). */
  failureMessages: string[];
  /** Error types from JUnit <failure type="...">. Safe to pass to the vague-specs-check. */
  failureTypes: string[];
}

export interface AgentResult {
  success: boolean;
  exitCode: number;
  /** Combined stdout + stderr from the agent process. */
  output: string;
}

// ---------------------------------------------------------------------------
// Method option types
// ---------------------------------------------------------------------------

export interface EngineSetupOpts {
  runId: string;
  projectName: string;
  featureName: string;
  /** Absolute path to the host project root (used to resolve relative compose files, etc.). */
  projectDir: string;
}

/** NormalizedStagingEnvironment shape re-declared inline to avoid circular deps. */
export interface StagingAppConfig {
  sidecarPort: number;
  sidecarPath: string;
  baseUrl?: string;
  build?: { dockerfile?: string };
}

export interface NormalizedStagingEnvironmentRef {
  engine: string;
  app: StagingAppConfig;
  appEnvironment: Record<string, string>;
  /** Present when a Docker Compose file is configured for ephemeral services. */
  file?: string;
}

export interface StartStagingOpts {
  sandboxProfileId: SupportedSandboxProfileId;
  /** Absolute path to the sandbox code directory on the host. */
  codePath: string;
  /** Absolute path to the project directory (used to resolve custom Dockerfiles). */
  projectDir: string;
  stagingEnvironment: NormalizedStagingEnvironmentRef;
  feature: Feature;
  projectName: string;
  /**
   * Absolute host path to the sandbox `saifac/` bundle directory.
   * Mounted read-only at `/saifac` in the staging container (same layout as coder).
   */
  saifacPath: string;
  /** Infra log lines from the staging container "follow" (-f) stream (stdout/stderr). */
  onLog: EngineOnLog;
}

/**
 * Environment variables for the coder container, split by log sensitivity.
 * Engines merge both into the real process/container; logging may show
 * public `env` key+value and only secret key names for `secretEnv`.
 */
export interface ContainerEnv {
  env: Record<string, string>;
  secretEnv: Record<string, string>;
}

export interface RunTestsOpts {
  /** Absolute path to the feature's tests/ directory on the host. */
  testsDir: string;
  /**
   * Absolute path to a host directory where the test runner writes results.xml
   * (bind-mounted to /test-runner-output inside the container).
   */
  reportDir: string;
  /** Test runner image tag (e.g. 'saifac-test-node-vitest:latest'). */
  testImage: string;
  /**
   * Absolute host path to test.sh, always bind-mounted at
   * /usr/local/bin/test.sh inside the Test Runner container (read-only).
   */
  testScriptPath: string;
  /** Used to derive SAIFAC_TARGET_URL and SAIFAC_SIDECAR_URL for the test runner. */
  stagingHandle: StagingHandle;
  feature: Feature;
  projectName: string;
  runId: string;
  /**
   * Optional abort signal. When fired, the test runner container is stopped
   * immediately and the result is returned with status='aborted'.
   */
  signal?: AbortSignal;
  /** Infra log lines from the test-runner container "follow" (-f) stream (stdout/stderr). */
  onLog: EngineOnLog;
}

export interface RunAgentOpts {
  /** Absolute path to the sandbox code directory (host path). */
  codePath: string;
  /**
   * Absolute path to the sandbox base directory (host path).
   * Used to derive the Leash workspace id.
   */
  sandboxBasePath: string;
  /**
   * Pre-built container environment (public + secret). Assembled by the orchestrator.
   * The engine only forwards it into Docker/Leash.
   */
  containerEnv: ContainerEnv;
  /**
   * When true, run the coder container via `docker run` (no Leash CLI). Same mounts/env/name as Leash.
   */
  dangerousNoLeash: boolean;
  /** Absolute path to the Cedar policy file. Ignored when dangerousNoLeash=true. */
  cedarPolicyPath: string;
  /** Docker image for the coder container. */
  coderImage: string;
  /**
   * Absolute host path to the sandbox `saifac/` bundle (mounted read-only at `/saifac` in the container).
   */
  saifacPath: string;
  /**
   * Raw stdout chunks from the agent container. Separate from onLog because these logs
   * may have agent-specific log formatting applied to them.
   */
  onAgentStdout: (chunk: string) => void;
  /** When the child stdout stream ends, flush any buffered state. */
  onAgentStdoutEnd?: () => void;
  /**
   * Raw stderr chunks from the agent container + other non-agent logs.
   * These logs are not agent-specific.
   */
  onLog: EngineOnLog;
  /**
   * When set, mount the argus binary for the semantic reviewer. Reviewer LLM env vars live in `containerEnv`.
   */
  reviewer: { argusBinaryPath: string } | null;
  /**
   * Optional abort signal. When fired (e.g. Hatchet step cancellation), the
   * agent child process is killed immediately and teardown() is still called
   * by the caller's finally block.
   */
  signal?: AbortSignal;
}

/**
 * Options for {@link Engine.startInspect}.
 * Use the same `containerEnv` as the first coding round in `runIterativeLoop` / `run resume`.
 */
export interface StartInspectOpts {
  codePath: string;
  sandboxBasePath: string;
  /** Same pre-built env as {@link RunAgentOpts.containerEnv}. */
  containerEnv: ContainerEnv;
  coderImage: string;
  dangerousNoLeash: boolean;
  cedarPolicyPath: string;
  saifacPath: string;
  reviewer: RunAgentOpts['reviewer'];
  signal?: AbortSignal;
  /** Same stdout contract as {@link RunAgentOpts.onAgentStdout}. */
  onAgentStdout: (chunk: string) => void;
  /** Same as {@link RunAgentOpts.onAgentStdoutEnd}. */
  onAgentStdoutEnd?: () => void;
  /** Same as {@link RunAgentOpts.onLog}. */
  onLog: EngineOnLog;
}

/** Handle for an idle coding container started by {@link Engine.startInspect}. */
export interface CoderInspectSessionHandle {
  /** Container name (Leash target / dangerous-no-leash docker run --name). */
  containerName: string;
  /** In-container workspace path (bind-mounted from the sandbox code dir). */
  workspacePath: string;
  /** Stop the idle session: terminate the Leash/docker parent process and clean up direct-run containers. */
  stop(): Promise<void>;
}

export interface EngineTeardownOpts {
  runId: string;
}

// ---------------------------------------------------------------------------
// Core interface
// ---------------------------------------------------------------------------

/** Infrastructure adaptor contract (Docker today, Kubernetes later). */
export interface Engine {
  /**
   * 1. Initialize the isolated environment and start background services.
   *
   * Docker: Creates a bridge network (`saifac-net-…`) and runs
   *   `docker compose -p saifac-<runId> -f <file> up -d --wait`.
   * Attaches compose services to the network via `docker network connect`.
   *
   * Must be called once before any other method.
   */
  setup(opts: EngineSetupOpts): Promise<void>;

  /**
   * 2. Build and start the staging application (Container A).
   *
   * Docker: Runs `docker build` to create an ephemeral image, creates and
   * starts the container with the sidecar injected via `putArchive`, and
   * waits until the sidecar HTTP endpoint is healthy.
   *
   * Returns a StagingHandle with the abstract URLs of the running app.
   */
  startStaging(opts: StartStagingOpts): Promise<StagingHandle>;

  /**
   * 3. Run the black-box test suite (Container B) to completion.
   *
   * Docker: Creates and starts the Test Runner container, waits for it to
   * exit, demuxes the log stream, reads raw JUnit XML from the report file, and returns
   * {@link TestsResult} (orchestrator parses XML).
   */
  runTests(opts: RunTestsOpts): Promise<TestsResult>;

  /**
   * 4. Run the AI coding agent and wait for it to finish.
   *
   * Docker/Leash: Spawns Leash CLI (`node …/leash.js`) as a child process,
   * starts a background polling loop to attach the Leash target container to the
   * SAIFAC network (workaround for missing --network flag in Leash CLI),
   * and resolves when the process exits.
   */
  runAgent(opts: RunAgentOpts): Promise<AgentResult>;

  /**
   * Idle coding container for `run inspect`: same image, mounts, network, and compose stack as
   * {@link runAgent}, but the container runs `sleep infinity` (no agent loop).
   *
   * Requires {@link setup} first. Call {@link CoderInspectSessionHandle.stop}, then {@link teardown}.
   */
  startInspect(opts: StartInspectOpts): Promise<CoderInspectSessionHandle>;

  /**
   * 5. Tear down all resources created during this run.
   *
   * Docker: Stops/removes containers, removes ephemeral staging images,
   * runs `docker compose down -v`, and removes the bridge network.
   * Safe to call even when setup() was never called or partially failed.
   */
  teardown(opts: EngineTeardownOpts): Promise<void>;
}
