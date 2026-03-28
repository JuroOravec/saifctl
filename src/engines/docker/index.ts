/**
 * DockerEngine — the single Docker-aware implementation of the Engine interface.
 *
 * Encapsulates Docker Engine usage, selected CLI usage, log demuxing, sidecar injection,
 * and the Leash network attachment workaround.
 *
 * Preferably use the Dockerode — a typed Docker Engine API wrapper. However,
 * there are cases where other options fit better:
 * - `docker compose` is not available through Dockerode
 * - `docker build` would require us to pack the build context into a tar stream
 *    and then consume a progress stream to detect errors. CLI is simpler.
 * - `docker run` - When Leash is enabled, Docker is called indirectly via Leash CLI.
 *   Thus, to keep the overall flow identical, and only swapping the `leash xxx` command
 *   for `docker run`, we invoke `docker run` via CLI.
 *
 * Lifecycle per run:
 *   setup()        → create bridge network + `docker compose up`
 *   startStaging() → docker build + createContainer + putArchive + start + health-wait
 *   runTests()     → createContainer + start + wait + demux logs + read JUnit XML bytes
 *   runAgent()     → spawn Leash CLI + network-attach workaround
 *   startInspect() → idle coder container for `run inspect` (`sleep infinity`)
 *   teardown()     → containers + images + compose down + network
 */

import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { arch } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';

import Docker from 'dockerode';

import type { DockerEnvironment } from '../../config/schema.js';
import { getSaifRoot } from '../../constants.js';
import { consola } from '../../logger.js';
import {
  resolveSandboxCoderDockerfilePath,
  type SupportedSandboxProfileId,
} from '../../sandbox-profiles/index.js';
import { createTarArchive } from '../../utils/archive.js';
import {
  pathExists,
  readFileBuffer,
  readUtf8,
  spawnAsync,
  spawnWait,
  writeUtf8,
} from '../../utils/io.js';
import { type EngineLogSource, type EngineOnLog } from '../logs.js';
import type {
  AgentResult,
  CoderInspectSessionHandle,
  ContainerEnv,
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
import { detectRunnerError } from '../utils/test-parser.js';
import { resolveLeashCliPath } from './resolve-leash-cli.js';

/** In-container workspace path that Leash bind-mounts the sandbox into. */
const CONTAINER_WORKSPACE = '/workspace';

// Docker client singleton
const docker = new Docker();

// ---------------------------------------------------------------------------
// runDocker — compose + build only (no shell, avoids injection)
// ---------------------------------------------------------------------------

interface RunDockerOptions {
  /** 'inherit' streams output to parent; 'pipe' captures stdout/stderr */
  stdio?: 'inherit' | 'pipe';
}

/**
 * Runs Docker CLI commands that have no good dockerode equivalent: `docker compose`, `docker build`.
 * No shell invocation — avoids injection. Throws on non-zero exit.
 * Returns { stdout, stderr } when stdio is 'pipe'.
 */
async function runDocker(
  args: string[],
  options: RunDockerOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const { stdio = 'pipe' } = options;
  if (stdio === 'inherit') {
    await spawnAsync({
      command: 'docker',
      args,
      cwd: process.cwd(),
      stdio: 'inherit',
    });
    return { stdout: '', stderr: '' };
  }
  const r = await spawnWait({ command: 'docker', args, cwd: process.cwd() });
  if (r.code !== 0) {
    const msg = r.stderr.trim() || r.stdout.trim() || `docker exited with ${r.code}`;
    throw new Error(msg);
  }
  return { stdout: r.stdout, stderr: r.stderr };
}

// ---------------------------------------------------------------------------
// DockerEngine
// ---------------------------------------------------------------------------

export class DockerEngine implements Engine {
  private readonly composeFile?: string;

  // State set during setup(), read by later methods
  private networkName = '';
  private runId = '';
  private projectDir = '';
  private composeProjectName = '';

  private readonly registry = new DockerRegistry();

  constructor(private readonly config: DockerEnvironment) {
    this.composeFile = config.file;
  }

  // ── 1. setup ──────────────────────────────────────────────────────────────

  async setup(opts: EngineSetupOpts): Promise<void> {
    const { runId, projectName, featureName, projectDir } = opts;
    this.runId = runId;
    this.projectDir = projectDir;

    // Create an isolated bridge network for this run
    this.networkName = `saifac-net-${projectName}-${featureName}-${runId}`;
    await ensureCreateNetwork(this.networkName);
    this.registry.registerNetwork(this.networkName);
    consola.log(`[docker] Bridge network ready: ${this.networkName}`);

    // Bring up compose services (if configured)
    if (this.composeFile) {
      this.composeProjectName = `saifac-${runId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
      const absoluteFile = resolve(projectDir, this.composeFile);

      if (!(await pathExists(absoluteFile))) {
        throw new Error(
          `[docker] Compose file not found: "${this.composeFile}" (resolved: ${absoluteFile}). ` +
            `Check environments.coding.file or environments.staging.file in saifac/config.ts.`,
        );
      }

      consola.log(
        `[docker] Starting compose project "${this.composeProjectName}" (file: ${absoluteFile})`,
      );
      await runDocker(
        ['compose', '-p', this.composeProjectName, '-f', absoluteFile, 'up', '-d', '--wait'],
        { stdio: 'inherit' },
      );

      // Attach every compose service to the SAIFAC bridge network
      await attachComposeSvcToNetwork({
        composeProjectName: this.composeProjectName,
        absoluteFile,
        networkName: this.networkName,
      });

      const serviceNames = await listComposeServices({
        composeProjectName: this.composeProjectName,
        absoluteFile,
      });
      consola.log(
        `[docker] Compose project "${this.composeProjectName}" up — services: ${serviceNames.join(', ')}`,
      );
    }
  }

  // ── 2. startStaging ───────────────────────────────────────────────────────

  async startStaging(opts: StartStagingOpts): Promise<StagingHandle> {
    const {
      sandboxProfileId,
      codePath,
      projectDir,
      stagingEnvironment,
      feature,
      projectName,
      saifacPath,
      onLog,
    } = opts;

    const containerConfig = stagingEnvironment.app;
    const containerName = `saifac-stage-${projectName}-${feature.name}-${this.runId}`;
    const imageTag = `saifac-stage-${projectName}-${feature.name}-img-${this.runId}`;

    // Build ephemeral staging image
    await buildStagingImage({
      sandboxProfileId: sandboxProfileId as SupportedSandboxProfileId,
      codePath,
      projectDir,
      dockerfile: containerConfig.build?.dockerfile,
      imageTag,
    });
    this.registry.registerImage(imageTag);

    consola.log(`[docker] Starting staging container: ${containerName}`);

    const appEnvEntries = Object.entries(stagingEnvironment.appEnvironment ?? {}).map(
      ([k, v]) => `${k}=${v}`,
    );

    const container = await docker.createContainer({
      Image: imageTag,
      name: containerName,
      Cmd: ['/bin/sh', '/saifac/staging-start.sh'],
      HostConfig: {
        NetworkMode: this.networkName,
        // Writable: putArchive injects sidecar into /saifac before start.
        Binds: [`${codePath}:/workspace`, `${saifacPath}:/saifac`],
        SecurityOpt: ['no-new-privileges'],
        CapDrop: ['ALL'],
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [this.networkName]: { Aliases: ['staging'] },
        },
      },
      Env: [
        ...appEnvEntries,
        `SAIFAC_FEATURE_NAME=${feature.name}`,
        `SAIFAC_SIDECAR_PORT=${containerConfig.sidecarPort}`,
        `SAIFAC_SIDECAR_PATH=${containerConfig.sidecarPath}`,
        `SAIFAC_STARTUP_SCRIPT=/saifac/startup.sh`,
        `SAIFAC_STAGE_SCRIPT=/saifac/stage.sh`,
      ],
      WorkingDir: '/workspace',
    });

    // Inject sidecar binary only via putArchive (not baked into user images).
    const sidecarBinary = await getSidecarBinary();
    const tarBuffer = createTarArchive([
      { filename: 'sidecar', content: sidecarBinary, mode: '0000755' },
    ]);
    await container.putArchive(tarBuffer, { path: '/saifac' });

    await container.start();
    consola.log(`[docker] ${containerName} started`);

    await logStagingContainerNetworkAliases({
      container,
      networkName: this.networkName,
      containerName,
    });

    const handle: ContainerHandle = { id: container.id, name: containerName, container };
    this.registry.registerContainers([handle]);

    streamContainerLogs({
      container,
      source: 'staging',
      containerLabel: containerName,
      forwardLog: onLog,
    });

    // Wait for sidecar health endpoint
    await waitForContainerReady({ containerName, container, port: containerConfig.sidecarPort });

    const sidecarUrl = `http://staging:${containerConfig.sidecarPort}${containerConfig.sidecarPath}`;
    const targetUrl = containerConfig.baseUrl ?? sidecarUrl;

    return { targetUrl, sidecarUrl };
  }

  // ── 3. runTests ───────────────────────────────────────────────────────────

  async runTests(opts: RunTestsOpts): Promise<TestsResult> {
    const {
      testsDir,
      reportDir,
      testImage,
      testScriptPath,
      stagingHandle,
      feature,
      projectName,
      runId,
      signal,
      onLog,
    } = opts;

    assertSafeImageTag(testImage);

    const containerName = `saifac-test-${projectName}-${runId}`;
    const containerTestsDir = '/tests';
    const containerOutputFile = '/test-runner-output/results.xml';
    const reportPath = join(reportDir, 'results.xml');

    const publicDir = join(testsDir, 'public');
    const hiddenDir = join(testsDir, 'hidden');
    const helpersFile = join(testsDir, 'helpers.ts');
    const infraFile = join(testsDir, 'infra.spec.ts');

    const [hasPublic, hasHidden, hasHelpers, hasInfra] = await Promise.all([
      pathExists(publicDir),
      pathExists(hiddenDir),
      pathExists(helpersFile),
      pathExists(infraFile),
    ]);
    const binds = [
      ...(hasPublic ? [`${publicDir}:${containerTestsDir}/public:ro`] : []),
      ...(hasHidden ? [`${hiddenDir}:${containerTestsDir}/hidden:ro`] : []),
      ...(hasHelpers ? [`${helpersFile}:${containerTestsDir}/helpers.ts:ro`] : []),
      ...(hasInfra ? [`${infraFile}:${containerTestsDir}/infra.spec.ts:ro`] : []),
      `${testScriptPath}:/usr/local/bin/test.sh:ro`,
    ];

    consola.log(`[docker] Starting test runner container: ${containerName}`);
    consola.log(`[docker] Test image: ${testImage}`);
    consola.log(`[docker] Target URL: ${stagingHandle.targetUrl}`);
    consola.log(`[docker] Sidecar URL: ${stagingHandle.sidecarUrl}`);

    await logBridgeNetworkEndpoints({
      networkName: this.networkName,
      context: `before test runner ${containerName}`,
    });

    const container = await docker.createContainer({
      Image: testImage,
      name: containerName,
      HostConfig: {
        NetworkMode: this.networkName,
        Binds: [...binds, `${reportDir}:/test-runner-output:rw`],
        SecurityOpt: ['no-new-privileges'],
        CapDrop: ['ALL'],
      },
      Env: [
        `SAIFAC_TARGET_URL=${stagingHandle.targetUrl}`,
        `SAIFAC_SIDECAR_URL=${stagingHandle.sidecarUrl}`,
        `SAIFAC_FEATURE_NAME=${feature.name}`,
        `SAIFAC_TESTS_DIR=${containerTestsDir}`,
        `SAIFAC_OUTPUT_FILE=${containerOutputFile}`,
      ],
      WorkingDir: '/workspace',
    });

    // Bail out before starting if already cancelled — avoids a start + immediate stop cycle.
    if (signal?.aborted) {
      await container.remove({ force: true }).catch(() => {});
      return { status: 'aborted', stdout: '', stderr: '', rawJunitXml: null };
    }

    await container.start();
    consola.log(`[docker] ${containerName} started`);

    const handle: ContainerHandle = { id: container.id, name: containerName, container };
    this.registry.registerContainers([handle]);

    streamContainerLogs({
      container,
      source: 'test-runner',
      containerLabel: containerName,
      forwardLog: onLog,
    });

    consola.log(`[docker] Waiting for test runner to complete...`);

    const waitPromise = (container.wait() as Promise<{ StatusCode: number }>).then((r) => {
      signal?.removeEventListener('abort', onAbort);
      return r;
    });

    let aborted = false;

    // When the signal fires, stop the container. container.wait() will then
    // resolve naturally with exit code 137 — no dangling promises.
    const onAbort = () => {
      aborted = true;
      consola.log(`[docker] Abort signal received — stopping test runner ${containerName}`);
      container.stop().catch((err: unknown) => {
        consola.warn(`[docker] Warning: could not stop ${containerName}: ${String(err)}`);
      });
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const { StatusCode } = await waitPromise;

    const logStream = await container.logs({ stdout: true, stderr: true, follow: false });
    const { stdout, stderr } = demuxDockerLogs(logStream as unknown as Buffer);

    consola.log(`[docker] Test runner exit code: ${StatusCode}${aborted ? ' (aborted)' : ''}`);
    if (stdout) consola.log(`[docker] Test runner stdout:\n${stdout}`);
    if (stderr) consola.error(`[docker] Test runner stderr:\n${stderr}`);

    this.registry.deregisterContainers([handle]);
    try {
      await container.remove({ force: true });
    } catch (err) {
      consola.warn(`[docker] Warning: could not remove ${containerName}: ${String(err)}`);
    }

    if (aborted) {
      return { status: 'aborted', stdout, stderr, rawJunitXml: null };
    }

    const runnerError = detectRunnerError({ exitCode: StatusCode, stdout, stderr });
    if (runnerError) {
      consola.error(`[docker] Test runner error detected: ${runnerError}`);
    }

    // Extract raw JUnit XML from the report file.
    let rawJunitXml: string | null = null;
    if (await pathExists(reportPath)) {
      try {
        rawJunitXml = await readUtf8(reportPath);
      } catch {
        rawJunitXml = null;
      }
    }

    return {
      status: StatusCode === 0 ? 'passed' : 'failed',
      stdout,
      stderr,
      runnerError,
      rawJunitXml,
    };
  }

  // ── 4. runAgent ───────────────────────────────────────────────────────────

  async runAgent(opts: RunAgentOpts): Promise<AgentResult> {
    const {
      codePath,
      sandboxBasePath,
      containerEnv,
      dangerousNoLeash,
      cedarPolicyPath,
      coderImage,
      saifacPath,
      reviewer,
      signal,
      onAgentStdout,
      onAgentStdoutEnd,
      onLog,
    } = opts;

    /** Set for `--dangerous-no-leash` so abort/error can `docker rm -f` the named container. */
    let dockerDirectRunContainerToRemove: string | null = null;

    let cmd: string;
    let args: string[];
    let argsForPrint: string[];
    let spawnCwd: string;
    let spawnEnv: Record<string, string>;

    if (dangerousNoLeash) {
      assertSafeImageTag(coderImage);

      const codePathHost = await dockerHostBindPath(codePath);
      const saifacDirHost = await dockerHostBindPath(saifacPath);
      const containerName = leashTargetContainerName(sandboxBasePath);

      const dockerRunArgs: string[] = [
        'run',
        '--rm',
        '-i',
        '--name',
        containerName,
        '-w',
        CONTAINER_WORKSPACE,
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '-v',
        `${codePathHost}:${CONTAINER_WORKSPACE}`,
        '-v',
        `${saifacDirHost}:/saifac:ro`,
      ];

      if (this.networkName) {
        dockerRunArgs.push('--network', this.networkName);
      }

      if (reviewer) {
        const argusBinaryHost = await dockerHostBindPath(reviewer.argusBinaryPath);
        dockerRunArgs.push('-v', `${argusBinaryHost}:/usr/local/bin/argus:ro`);
      }

      dockerRunArgs.push(...dockerRunCoderEnvArgs(containerEnv));
      dockerRunArgs.push(coderImage, 'bash', '/saifac/coder-start.sh');

      argsForPrint = redactDockerRunArgsForPrint(dockerRunArgs, containerEnv);

      cmd = 'docker';
      args = dockerRunArgs;
      spawnCwd = codePathHost;
      spawnEnv = {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][],
        ),
      };

      consola.log('[agent-runner] Mode: dangerous-no-leash (docker run; no Leash/Cedar)');
      consola.log(`[agent-runner] Container name: ${containerName}`);
      consola.log(`[agent-runner] Sandbox mount: ${codePathHost} → ${CONTAINER_WORKSPACE}`);

      await removeDockerContainerForce(containerName);
      dockerDirectRunContainerToRemove = containerName;
    } else {
      // Leash mode
      const codePathHost = await dockerHostBindPath(codePath);
      const saifacDirHost = await dockerHostBindPath(saifacPath);

      const leashArgs: string[] = [
        'leash',
        '--no-interactive',
        '--verbose',
        '--image',
        coderImage,
        '--volume',
        `${codePathHost}:${CONTAINER_WORKSPACE}`,
        '--volume',
        `${saifacDirHost}:/saifac:ro`,
      ];

      if (reviewer) {
        const argusBinaryHost = await dockerHostBindPath(reviewer.argusBinaryPath);
        leashArgs.push('--volume', `${argusBinaryHost}:/usr/local/bin/argus:ro`);
      }

      if (await pathExists(cedarPolicyPath)) {
        const cedarPolicyHost = await dockerHostBindPath(cedarPolicyPath);
        leashArgs.push('--policy', cedarPolicyHost);
        consola.log(`[agent-runner] Cedar policy: ${cedarPolicyHost}`);
      } else {
        throw new Error(`Cedar policy file not found at ${cedarPolicyPath}`);
      }

      pushLeashContainerEnv(leashArgs, containerEnv);
      // Invoke via bash so the script doesn't need +x in the mounted directory.
      // This mirrors how gate.sh and reviewer.sh are invoked inside coder-start.sh.
      leashArgs.push('bash', '/saifac/coder-start.sh');

      argsForPrint = redactLeashArgsForPrint(leashArgs, containerEnv);

      // execPath=`/usr/local/bin/node`
      // leashBin=`/path/to/my-proj/node_modules/@strongdm/leash/bin/leash.js`
      const leashBin = resolveLeashCliPath();
      cmd = process.execPath;
      args = [leashBin, ...leashArgs.slice(1)];
      // Match Leash `callerDir` (getcwd) to canonical workspace path so its `callerDir:callerDir` mount matches ours.
      spawnCwd = codePathHost;

      const workspaceId = leashWorkspaceId(sandboxBasePath);
      spawnEnv = {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][],
        ),
        // WORKAROUND(leash-network): inject a predictable name via Leash's TARGET_CONTAINER,
        // so we know which container to attach to the SAIFAC network after Leash starts it.
        // See other `WORKAROUND(leash-network)` comments in this file.
        ...(this.networkName ? { TARGET_CONTAINER: `leash-target-${workspaceId}` } : {}),
      };

      consola.log(`[agent-runner] Mode: leash (container: ${coderImage})`);
      consola.log(`[agent-runner] Sandbox mount: ${codePathHost} → ${CONTAINER_WORKSPACE}`);
    }

    consola.debug(`[agent-runner] containerEnv (public): ${JSON.stringify(containerEnv.env)}`);
    consola.debug(
      `[agent-runner] containerEnv.secret keys: ${Object.keys(containerEnv.secretEnv).sort().join(', ')}`,
    );

    consola.log(`[agent-runner] Starting agent (run ID: ${this.runId})`);
    consola.log(
      `[agent-runner] Command: ${cmd} ${argsForPrint.map((s) => s.slice(0, 100)).join(' ')}`,
    );

    if (!dangerousNoLeash) {
      await removeDockerContainerForce(leashTargetContainerName(sandboxBasePath));
    }

    const timeoutMs = 20 * 60 * 1000;

    // WORKAROUND(leash-network): See full explanation in the original agent-runner.ts.
    // Leash doesn't support a --network flag, so we poll `docker inspect` until the target
    // container appears and then call `docker network connect` to put it on our network.
    const networkAttach =
      !dangerousNoLeash && this.networkName
        ? startLeashNetworkAttach(this.networkName, leashWorkspaceId(sandboxBasePath))
        : null;

    const removeDirectDockerContainer = (): void => {
      if (!dockerDirectRunContainerToRemove) return;
      const n = dockerDirectRunContainerToRemove;
      void removeDockerContainerForce(n);
    };

    const { exitCode, output } = await new Promise<{ exitCode: number; output: string }>(
      (resolve, reject) => {
        const child = spawn(cmd, args, {
          cwd: spawnCwd,
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
          removeDirectDockerContainer();
          reject(new Error(`Agent timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        const onAbort = () => {
          child.kill();
          clearTimeout(timer);
          networkAttach?.cancel();
          removeDirectDockerContainer();
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
          networkAttach?.cancel();
          removeDirectDockerContainer();
          endAgentStdout();
          reject(err);
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          networkAttach?.cancel();
          if ((code ?? 1) !== 0) removeDirectDockerContainer();
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

  // ── 4b. startInspect ───────────────────────────────────────────────

  async startInspect(opts: StartInspectOpts): Promise<CoderInspectSessionHandle> {
    const {
      codePath,
      sandboxBasePath,
      containerEnv,
      coderImage,
      dangerousNoLeash,
      cedarPolicyPath,
      saifacPath,
      reviewer,
      signal,
      onAgentStdout,
      onAgentStdoutEnd,
      onLog,
    } = opts;

    let dockerDirectRunContainerToRemove: string | null = null;

    const containerName = leashTargetContainerName(sandboxBasePath);

    let cmd: string;
    let args: string[];
    let argsForPrint: string[];
    let spawnCwd: string;
    let spawnEnv: Record<string, string>;

    if (dangerousNoLeash) {
      assertSafeImageTag(coderImage);

      const codePathHost = await dockerHostBindPath(codePath);
      const saifacDirHost = await dockerHostBindPath(saifacPath);

      const dockerRunArgs: string[] = [
        'run',
        '--rm',
        '-i',
        '--name',
        containerName,
        '-w',
        CONTAINER_WORKSPACE,
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '-v',
        `${codePathHost}:${CONTAINER_WORKSPACE}`,
        '-v',
        `${saifacDirHost}:/saifac:ro`,
      ];

      if (this.networkName) {
        dockerRunArgs.push('--network', this.networkName);
      }

      if (reviewer) {
        const argusBinaryHost = await dockerHostBindPath(reviewer.argusBinaryPath);
        dockerRunArgs.push('-v', `${argusBinaryHost}:/usr/local/bin/argus:ro`);
      }

      dockerRunArgs.push(...dockerRunCoderEnvArgs(containerEnv));
      dockerRunArgs.push(coderImage, 'bash', '-c', 'sleep infinity');

      argsForPrint = redactDockerRunArgsForPrint(dockerRunArgs, containerEnv);

      cmd = 'docker';
      args = dockerRunArgs;
      spawnCwd = codePathHost;
      spawnEnv = {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][],
        ),
      };

      consola.log('[inspect-session] Mode: dangerous-no-leash (docker run; idle)');
      consola.log(`[inspect-session] Container name: ${containerName}`);

      dockerDirectRunContainerToRemove = containerName;
    } else {
      const codePathHost = await dockerHostBindPath(codePath);
      const saifacDirHost = await dockerHostBindPath(saifacPath);

      const leashArgs: string[] = [
        'leash',
        '--no-interactive',
        '--verbose',
        '--image',
        coderImage,
        '--volume',
        `${codePathHost}:${CONTAINER_WORKSPACE}`,
        '--volume',
        `${saifacDirHost}:/saifac:ro`,
      ];

      if (reviewer) {
        const argusBinaryHost = await dockerHostBindPath(reviewer.argusBinaryPath);
        leashArgs.push('--volume', `${argusBinaryHost}:/usr/local/bin/argus:ro`);
      }

      if (await pathExists(cedarPolicyPath)) {
        const cedarPolicyHost = await dockerHostBindPath(cedarPolicyPath);
        leashArgs.push('--policy', cedarPolicyHost);
        consola.log(`[inspect-session] Cedar policy: ${cedarPolicyHost}`);
      } else {
        throw new Error(`Cedar policy file not found at ${cedarPolicyPath}`);
      }

      pushLeashContainerEnv(leashArgs, containerEnv);
      leashArgs.push('bash', '-c', 'sleep infinity');

      argsForPrint = redactLeashArgsForPrint(leashArgs, containerEnv);

      const leashBin = resolveLeashCliPath();
      cmd = process.execPath;
      args = [leashBin, ...leashArgs.slice(1)];
      spawnCwd = codePathHost;

      const workspaceId = leashWorkspaceId(sandboxBasePath);
      spawnEnv = {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][],
        ),
        ...(this.networkName ? { TARGET_CONTAINER: `leash-target-${workspaceId}` } : {}),
      };

      consola.log(`[inspect-session] Mode: leash (idle; container: ${coderImage})`);
    }

    consola.debug(`[inspect-session] containerEnv (public): ${JSON.stringify(containerEnv.env)}`);
    consola.debug(
      `[inspect-session] containerEnv.secret keys: ${Object.keys(containerEnv.secretEnv).sort().join(', ')}`,
    );

    consola.log(
      `[inspect-session] Command: ${cmd} ${argsForPrint.map((s) => s.slice(0, 100)).join(' ')}`,
    );

    await removeDockerContainerForce(containerName);

    if (signal?.aborted) {
      throw new Error('inspect-session: aborted before start');
    }

    let networkAttach: NetworkAttachHandle | null = null;
    if (!dangerousNoLeash && this.networkName) {
      networkAttach = startLeashNetworkAttach(this.networkName, leashWorkspaceId(sandboxBasePath));
    }

    const removeDirectDocker = (): void => {
      if (!dockerDirectRunContainerToRemove) return;
      const n = dockerDirectRunContainerToRemove;
      void removeDockerContainerForce(n);
    };

    const child = spawn(cmd, args, {
      cwd: spawnCwd,
      env: spawnEnv,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    const endInspectStdout = (): void => onAgentStdoutEnd?.();
    child.stdout?.on('data', (chunk: Buffer) => {
      onAgentStdout(chunk.toString());
    });
    child.once('close', () => {
      endInspectStdout();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      onLog({
        source: 'inspect',
        stream: 'stderr',
        raw: chunk.toString(),
      });
    });

    let detachAbortListener: (() => void) | null = null;
    let abortPromise: Promise<never> | null = null;
    if (signal) {
      let rejectAbort: ((reason: unknown) => void) | undefined;
      const onAbort = () => {
        networkAttach?.cancel();
        removeDirectDocker();
        child.kill('SIGTERM');
        rejectAbort?.(new Error('inspect-session: cancelled'));
      };
      abortPromise = new Promise<never>((_, reject) => {
        rejectAbort = reject;
        signal.addEventListener('abort', onAbort, { once: true });
      });
      detachAbortListener = () => signal.removeEventListener('abort', onAbort);
    }

    const waitReady = (async () => {
      await waitForContainerRunning(containerName, 180_000);
      if (!dangerousNoLeash && this.networkName) {
        await waitForContainerOnNetwork({
          networkName: this.networkName,
          containerName,
          timeoutMs: 90_000,
        });
      }
    })();

    try {
      if (abortPromise) {
        await Promise.race([waitReady, abortPromise]);
      } else {
        await waitReady;
      }
    } catch (err) {
      networkAttach?.cancel();
      if (detachAbortListener !== null) detachAbortListener();
      if (!child.killed) child.kill('SIGTERM');
      removeDirectDocker();
      throw err;
    }

    if (detachAbortListener !== null) detachAbortListener();
    consola.log(
      `[inspect-session] Ready — container ${containerName}, workspace ${CONTAINER_WORKSPACE}`,
    );

    let stopped = false;
    const stop = async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      networkAttach?.cancel();
      const directName = dockerDirectRunContainerToRemove;
      if (directName) {
        await removeDockerContainerForce(directName);
        dockerDirectRunContainerToRemove = null;
      }
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
          }, 3_000);
          child.once('close', () => {
            clearTimeout(t);
            resolve();
          });
        });
      }
      // Leash path does not set dockerDirectRunContainerToRemove; ensure the target is gone
      // so teardown can remove the bridge (same name as no-leash for Dev Container parity).
      await removeDockerContainerForce(containerName);
    };

    return {
      containerName,
      workspacePath: CONTAINER_WORKSPACE,
      stop,
    };
  }

  // ── 5. teardown ───────────────────────────────────────────────────────────

  async teardown(_opts: EngineTeardownOpts): Promise<void> {
    // 1. Stop/remove Docker containers + images tracked in the registry
    await this.registry.cleanup();

    // 2. Tear down compose stack (if one was started)
    if (this.composeFile && this.composeProjectName) {
      consola.log(`[docker] Tearing down compose project "${this.composeProjectName}"`);
      try {
        await runDocker(
          [
            'compose',
            '-p',
            this.composeProjectName,
            '-f',
            this.composeFile,
            'down',
            '-v',
            '--remove-orphans',
          ],
          { stdio: 'inherit' },
        );
        consola.log(`[docker] Compose project "${this.composeProjectName}" down`);
      } catch (err) {
        consola.warn(
          `[docker] Warning: failed to tear down compose project "${this.composeProjectName}": ${String(err)}`,
        );
      }
    }

    // 3. Remove the bridge network (after containers are gone)
    if (this.networkName) {
      await removeDockerNetwork(this.networkName);
      this.networkName = '';
    }
  }
}

// ---------------------------------------------------------------------------
// Staging container/image
// ---------------------------------------------------------------------------

async function buildStagingImage(opts: {
  sandboxProfileId: SupportedSandboxProfileId;
  codePath: string;
  projectDir: string;
  dockerfile?: string | null;
  imageTag: string;
}): Promise<void> {
  const { sandboxProfileId, codePath, projectDir, dockerfile, imageTag } = opts;
  let dockerfilePath: string;

  if (dockerfile) {
    dockerfilePath = resolve(projectDir, dockerfile);
    if (!(await pathExists(dockerfilePath))) {
      throw new Error(
        `[docker] config environments.staging.app.build.dockerfile "${dockerfile}" not found at ${dockerfilePath}`,
      );
    }
    consola.log(`[docker] Using custom Dockerfile: ${dockerfilePath}`);
  } else {
    dockerfilePath = resolveSandboxCoderDockerfilePath(sandboxProfileId);
    if (!(await pathExists(dockerfilePath))) {
      throw new Error(
        `[docker] Profile "${sandboxProfileId}" requires Dockerfile.coder at ${dockerfilePath} but it is missing.`,
      );
    }
    consola.log(`[docker] Using profile ${sandboxProfileId} Dockerfile.coder`);
  }

  // Write a .dockerignore to keep the build context clean
  await writeUtf8(
    join(codePath, '.dockerignore'),
    ['node_modules', '.git', '*.log', 'dist', 'build', '.cache'].join('\n') + '\n',
  );

  consola.log(`[docker] Building staging container image: ${imageTag}`);
  await runDocker(['build', '-f', dockerfilePath, '-t', imageTag, codePath], {
    stdio: 'inherit',
  });
  consola.log(`[docker] Staging container image built: ${imageTag}`);
}

// ---------------------------------------------------------------------------
// Leash
// ---------------------------------------------------------------------------

function leashWorkspaceId(sandboxBasePath: string): string {
  const segments = sandboxBasePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const tail = segments.slice(-2).join('-');
  return tail
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 40);
}

/**
 * Docker container name for the coder target when `TARGET_CONTAINER` is set for Leash
 * (`leash-target-<workspaceId>`). Used for `--dangerous-no-leash` so names match Leash runs.
 */
function leashTargetContainerName(sandboxBasePath: string): string {
  return `leash-target-${leashWorkspaceId(sandboxBasePath)}`;
}

// ---------------------------------------------------------------------------
// Utility: Networks
// ---------------------------------------------------------------------------

async function ensureCreateNetwork(name: string): Promise<void> {
  try {
    await docker.createNetwork({ Name: name, Driver: 'bridge' });
  } catch (err: unknown) {
    const isConflict =
      err instanceof Error &&
      (err.message.includes('409') || err.message.includes('already exists'));
    if (!isConflict) throw err;

    consola.warn(
      `[docker] Network ${name} already exists (leftover from prior run) — removing and recreating.`,
    );
    await removeDockerNetwork(name);
    await docker.createNetwork({ Name: name, Driver: 'bridge' });
  }
}

async function removeDockerNetwork(networkName: string): Promise<void> {
  try {
    const networks = await docker.listNetworks({ filters: { name: [networkName] } });
    for (const net of networks) {
      const n = docker.getNetwork(net.Id);
      await n.remove();
    }
  } catch (err) {
    consola.warn(`[docker] Warning: could not remove network ${networkName}: ${String(err)}`);
  }
}

async function resolveDockerNetworkByName(networkName: string) {
  const listed = await docker.listNetworks({ filters: { name: [networkName] } });
  const match = listed.find((n) => n.Name === networkName) ?? listed[0];
  if (!match) return null;
  return docker.getNetwork(match.Id);
}

// ---------------------------------------------------------------------------
// Utility: Containers
// ---------------------------------------------------------------------------

/** Best-effort `docker rm -f` equivalent (ignores missing container / races). */
async function removeDockerContainerForce(nameOrId: string): Promise<void> {
  try {
    await docker.getContainer(nameOrId).remove({ force: true });
  } catch {
    /* absent, --rm race, etc. */
  }
}

async function isDockerContainerRunning(nameOrId: string): Promise<boolean> {
  try {
    const info = await docker.getContainer(nameOrId).inspect();
    return Boolean(info.State?.Running);
  } catch {
    return false;
  }
}

async function connectContainerToBridgeNetwork(opts: {
  networkName: string;
  containerIdOrName: string;
  aliases?: string[];
}): Promise<void> {
  const { networkName, containerIdOrName, aliases } = opts;
  const net = await resolveDockerNetworkByName(networkName);
  if (!net) {
    throw new Error(`[docker] Network not found: "${networkName}"`);
  }
  if (aliases?.length) {
    await net.connect({
      Container: containerIdOrName,
      EndpointConfig: { Aliases: aliases },
    });
  } else {
    await net.connect({ Container: containerIdOrName });
  }
}

// ---------------------------------------------------------------------------
// Utility: Images
// ---------------------------------------------------------------------------

function assertSafeImageTag(tag: string): void {
  if (!/^[a-zA-Z0-9_.\-:/@]+$/.test(tag)) {
    throw new Error(
      `[docker] Unsafe image tag rejected: "${tag}". ` +
        `Tags must contain only letters, digits, hyphens, underscores, dots, colons, slashes, and @ signs.`,
    );
  }
}

async function removeDockerImage(imageTag: string): Promise<void> {
  try {
    const image = docker.getImage(imageTag);
    await image.remove({ force: true });
  } catch {
    // Image not found or already removed — not an error
  }
}

// ---------------------------------------------------------------------------
// Utility: Docker compose
// ---------------------------------------------------------------------------

/**
 * Lists service names for a compose project (`docker compose ps --services`).
 * Used to discover which containers to attach to the SAIFAC bridge network.
 */
async function listComposeServices(opts: {
  composeProjectName: string;
  absoluteFile: string;
}): Promise<string[]> {
  const { composeProjectName, absoluteFile } = opts;
  try {
    const { stdout } = await runDocker([
      'compose',
      '-p',
      composeProjectName,
      '-f',
      absoluteFile,
      'ps',
      '--services',
    ]);
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Connects every compose service container to the given bridge network with a stable alias
 * (the service name) so other containers on that network can reach Postgres, Redis, etc. by hostname.
 */
async function attachComposeSvcToNetwork(opts: {
  composeProjectName: string;
  absoluteFile: string;
  networkName: string;
}): Promise<void> {
  const { composeProjectName, absoluteFile, networkName } = opts;
  const serviceNames = await listComposeServices({ composeProjectName, absoluteFile });
  for (const service of serviceNames) {
    try {
      const { stdout } = await runDocker([
        'compose',
        '-p',
        composeProjectName,
        '-f',
        absoluteFile,
        'ps',
        '-q',
        service,
      ]);
      const containerId = stdout.trim();
      if (!containerId) continue;

      await connectContainerToBridgeNetwork({
        networkName,
        containerIdOrName: containerId,
        aliases: [service],
      });
      consola.log(
        `[docker] Connected compose service "${service}" (${containerId}) to network "${networkName}"`,
      );
    } catch (err) {
      consola.warn(
        `[docker] Warning: could not attach compose service "${service}" to network "${networkName}": ${String(err)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// WORKAROUND(leash-network): post-start polling + network attach
//
// Leash doesn't support a --network flag. We set TARGET_CONTAINER (Leash's own env var
// for overriding the target container name) to a predictable value so we know which
// container to attach to the SAIFAC bridge network after Leash starts it. We then
// poll `docker inspect` until the container appears and call `docker network connect`.
//
// See https://github.com/strongdm/leash/issues/69
// ---------------------------------------------------------------------------

interface NetworkAttachHandle {
  cancel(): void;
}

function startLeashNetworkAttach(networkName: string, workspaceId: string): NetworkAttachHandle {
  const containerName = `leash-target-${workspaceId}`;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const poll = async () => {
    if (cancelled) return;
    try {
      if (await isDockerContainerRunning(containerName)) {
        consola.log(
          `[agent-runner] Attaching container "${containerName}" to network "${networkName}"...`,
        );
        await connectContainerToBridgeNetwork({ networkName, containerIdOrName: containerName });
        consola.log(`[agent-runner] Container "${containerName}" attached to "${networkName}".`);
        return;
      }
    } catch {
      // Container doesn't exist yet or connect failed — retry
    }
    if (!cancelled) timer = setTimeout(() => void poll(), 500);
  };

  timer = setTimeout(() => void poll(), 500);

  return {
    cancel() {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

// ---------------------------------------------------------------------------
// Sidecar binary loader
// ---------------------------------------------------------------------------

let sidecarBinaryCache: Buffer | null = null;

async function getSidecarBinary(): Promise<Buffer> {
  // Loaded lazily to avoid blocking startup.
  if (sidecarBinaryCache) return sidecarBinaryCache;

  const hostArch = arch();
  const binaryName = hostArch === 'arm64' ? 'sidecar-linux-arm64' : 'sidecar-linux-amd64';
  const binaryPath = join(
    getSaifRoot(),
    'src',
    'orchestrator',
    'sidecars',
    'cli-over-http',
    'out',
    binaryName,
  );

  if (!(await pathExists(binaryPath))) {
    throw new Error(
      `[sidecar] Pre-compiled sidecar binary not found at ${binaryPath}. ` +
        `Run: cd src/orchestrator/sidecars/cli-over-http && ` +
        `GOOS=linux GOARCH=${hostArch === 'arm64' ? 'arm64' : 'amd64'} CGO_ENABLED=0 go build -o out/${binaryName} .`,
    );
  }

  sidecarBinaryCache = await readFileBuffer(binaryPath);
  return sidecarBinaryCache;
}

// ---------------------------------------------------------------------------
// Utility: Container polling
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls container inspect (dockerode) until `State.Running` is true.
 * Used right after `docker run` / Leash starts the coder target: the process may return before
 * the container transitions to running, and inspect can briefly fail if the name is not visible yet.
 */
async function waitForContainerRunning(containerName: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isDockerContainerRunning(containerName)) return;
    await sleep(300);
  }
  throw new Error(
    `[inspect-session] Timeout after ${timeoutMs}ms waiting for container "${containerName}" to run`,
  );
}

/**
 * Waits until Docker reports the given container as connected to the named bridge network.
 * After `docker network connect` (or equivalent), attachment can lag; staging/compose services
 * on that network are only reachable once the endpoint appears on the network’s container list.
 */
async function waitForContainerOnNetwork(opts: {
  networkName: string;
  containerName: string;
  timeoutMs: number;
}): Promise<void> {
  const { networkName, containerName, timeoutMs } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const listed = await docker.listNetworks({ filters: { name: [networkName] } });
      const match = listed.find((n) => n.Name === networkName) ?? listed[0];
      if (!match) {
        await sleep(250);
        continue;
      }
      const data = await docker.getNetwork(match.Id).inspect();
      const containers = data.Containers ?? {};
      const connected = Object.values(containers).some(
        (c) => (c.Name ?? '').replace(/^\//, '') === containerName,
      );
      if (connected) return;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  throw new Error(
    `[inspect-session] Timeout after ${timeoutMs}ms waiting for "${containerName}" on network "${networkName}"`,
  );
}

/**
 * Waits until the container is ready.
 *
 * Checks the container's health endpoint.
 */
async function waitForContainerReady(opts: {
  containerName: string;
  container: Docker.Container;
  port: number;
  timeoutMs?: number;
}): Promise<void> {
  const { containerName, container, port, timeoutMs = 180_000 } = opts;
  const healthCmd = [
    'node',
    '-e',
    `fetch('http://localhost:${port}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
  ];

  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  consola.log(`[docker] Waiting for ${containerName} to be ready on port ${port}...`);

  while (Date.now() < deadline) {
    attempt++;
    try {
      const info = await container.inspect();
      if (!info.State.Running) {
        throw new Error(
          `[docker] ${containerName} exited (code ${info.State.ExitCode ?? '?'}) before the sidecar became ready. ` +
            `Check the container logs above for startup errors.`,
        );
      }
      const exec = await container.exec({
        Cmd: healthCmd,
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ hijack: true, stdin: false });
      await new Promise<void>((res) => stream.on('end', res));
      const inspect = await exec.inspect();
      if ((inspect.ExitCode ?? -1) === 0) {
        consola.log(`[docker] ${containerName} is ready (attempt ${attempt})`);
        return;
      }
    } catch (err) {
      consola.log(`[docker] Health check error (attempt ${attempt}): ${String(err)}`);
    }
    await sleep(500);
  }

  consola.warn(`[docker] ${containerName} did not become ready within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Utility: Logging
// ---------------------------------------------------------------------------

/**
 * Split a single Docker API log buffer into stdout vs stderr text.
 *
 * Docker multiplexes both streams into one binary payload: each frame is an 8-byte header
 * (stream type + payload length) followed by UTF-8 bytes. This is used when logs are fetched
 * as a bounded buffer (e.g. after a container exits), not for live `follow: true` streaming
 * where we already demux via `dockerode.modem.demuxStream`.
 */
function demuxDockerLogs(buffer: Buffer): { stdout: string; stderr: string } {
  if (!Buffer.isBuffer(buffer)) return { stdout: String(buffer), stderr: '' };

  let stdout = '';
  let stderr = '';
  let offset = 0;

  while (offset < buffer.length) {
    // Docker frame: 8-byte header (stream id byte + padding, then big-endian payload length).
    if (offset + 8 > buffer.length) break;
    const streamType = buffer[offset]; // 1 = stdout, 2 = stderr (other types ignored)
    const size = buffer.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + size > buffer.length) break; // truncated buffer — stop cleanly
    const payload = buffer.slice(offset, offset + size).toString('utf8');
    offset += size;
    if (streamType === 1) stdout += payload;
    else if (streamType === 2) stderr += payload;
  }

  return { stdout, stderr };
}

/**
 * Builds a one-line summary of `NetworkSettings.Networks` for logs: whether the SAIFAC bridge
 * is present, DNS aliases, and IP (helps debug “staging not reachable” / wrong network).
 */
function formatContainerNetworkEndpoint(
  networks: Record<string, { Aliases?: string[]; IPAddress?: string }> | undefined,
  preferredNetwork: string,
): string {
  if (!networks || Object.keys(networks).length === 0) {
    return '(no networks in container inspect)';
  }
  const preferred = networks[preferredNetwork];
  if (preferred) {
    const aliases = Array.isArray(preferred.Aliases) ? preferred.Aliases : [];
    return `on "${preferredNetwork}" aliases=${JSON.stringify(aliases)} ip=${preferred.IPAddress ?? '?'}`;
  }
  const summary = Object.entries(networks).map(([k, v]) => ({
    networkKey: k,
    aliases: Array.isArray(v.Aliases) ? v.Aliases : [],
    ip: v.IPAddress ?? '?',
  }));
  return `expected key "${preferredNetwork}" missing; attached: ${JSON.stringify(summary)}`;
}

/**
 * After staging starts, logs how that container is attached to the SAIFAC network (aliases + IP).
 * Confirms DNS names like `staging` resolve as expected for the test runner.
 */
async function logStagingContainerNetworkAliases(opts: {
  container: Docker.Container;
  networkName: string;
  containerName: string;
}): Promise<void> {
  const { container, networkName, containerName } = opts;
  try {
    const info = await container.inspect();
    const nets = info.NetworkSettings?.Networks as
      | Record<string, { Aliases?: string[]; IPAddress?: string }>
      | undefined;
    const detail = formatContainerNetworkEndpoint(nets, networkName);
    consola.log(`[docker] ${containerName} — ${detail}`);
  } catch (err) {
    consola.warn(
      `[docker] Could not inspect staging container "${containerName}" for network aliases: ${String(err)}`,
    );
  }
}

/**
 * Logs all endpoints on a bridge network (container name + IPv4) before tests or similar steps.
 * High-signal when debugging ENOTFOUND/ECONNREFUSED between compose services, staging, and runners.
 */
async function logBridgeNetworkEndpoints(opts: {
  networkName: string;
  context: string;
}): Promise<void> {
  const { networkName, context } = opts;
  try {
    const listed = await docker.listNetworks({ filters: { name: [networkName] } });
    const match = listed.find((n) => n.Name === networkName) ?? listed[0];
    if (!match) {
      consola.warn(`[docker] (${context}) No Docker network matched filter name="${networkName}"`);
      return;
    }
    if (match.Name !== networkName) {
      consola.warn(
        `[docker] (${context}) listNetworks returned "${match.Name}" (wanted exact "${networkName}")`,
      );
    }
    const net = docker.getNetwork(match.Id);
    const data = await net.inspect();
    const containers = data.Containers ?? {};
    const rows = Object.values(containers).map((c) => ({
      name: c.Name.replace(/^\//, ''),
      ipv4: c.IPv4Address,
    }));
    consola.log(
      `[docker] (${context}) Bridge "${data.Name}" id=${data.Id.slice(0, 12)}… driver=${data.Driver} endpointCount=${rows.length}:`,
    );
    consola.log(`[docker] (${context})   ${JSON.stringify(rows)}`);
  } catch (err) {
    consola.warn(
      `[docker] (${context}) Could not inspect network "${networkName}": ${String(err)}`,
    );
  }
}

function streamContainerLogs(opts: {
  container: Docker.Container;
  source: EngineLogSource;
  containerLabel: string;
  forwardLog: EngineOnLog;
}): void {
  const { container, source, containerLabel, forwardLog } = opts;
  void container
    .logs({ follow: true, stdout: true, stderr: true, timestamps: false })
    .then((stream: NodeJS.ReadableStream) => {
      const out = new PassThrough();
      const err = new PassThrough();
      docker.modem.demuxStream(stream, out, err);

      const makeHandler = (streamKind: 'stdout' | 'stderr') => {
        let buf = '';
        const onData = (chunk: Buffer | string) => {
          buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (line) {
              forwardLog({
                source,
                stream: streamKind,
                containerLabel,
                raw: line,
              });
            }
          }
        };
        const onEnd = () => {
          if (buf) {
            forwardLog({
              source,
              stream: streamKind,
              containerLabel,
              raw: buf,
            });
            buf = '';
          }
        };
        return { onData, onEnd };
      };

      const stdoutH = makeHandler('stdout');
      const stderrH = makeHandler('stderr');
      out.on('data', stdoutH.onData);
      out.on('end', stdoutH.onEnd);
      err.on('data', stderrH.onData);
      err.on('end', stderrH.onEnd);
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Internal container/network tracking
// ---------------------------------------------------------------------------

interface ContainerHandle {
  id: string;
  name: string;
  container: Docker.Container;
}

/**
 * Tracks Docker resources created during a single engine lifecycle (containers, ephemeral images).
 * {@link DockerRegistry.cleanup} removes tracked containers and images; bridge networks are torn down
 * separately in `teardown()` after compose and ad-hoc containers are gone to avoid “active endpoints” races.
 */
class DockerRegistry {
  private containers: ContainerHandle[] = [];
  private networks: string[] = [];
  private images: string[] = [];

  registerContainers(handles: ContainerHandle[]): void {
    this.containers.push(...handles);
  }
  registerNetwork(name: string): void {
    if (name) this.networks.push(name);
  }
  registerImage(tag: string): void {
    if (tag) this.images.push(tag);
  }
  deregisterContainers(handles: ContainerHandle[]): void {
    const ids = new Set(handles.map((h) => h.id));
    this.containers = this.containers.filter((h) => !ids.has(h.id));
  }
  deregisterNetwork(name: string): void {
    this.networks = this.networks.filter((n) => n !== name);
  }
  deregisterImage(tag: string): void {
    this.images = this.images.filter((t) => t !== tag);
  }

  /** Force-removes tracked containers and deletes tracked images; does not remove networks (see class doc). */
  async cleanup(): Promise<void> {
    const containersToStop = [...this.containers];
    const imagesToRemove = [...this.images];
    this.containers = [];
    this.networks = [];
    this.images = [];

    for (const handle of containersToStop) {
      try {
        await handle.container.remove({ force: true });
      } catch (err) {
        consola.warn(`[docker] Warning: could not remove ${handle.name}: ${String(err)}`);
      }
    }
    // Bridge networks are removed only from teardown() after `compose down` and after
    // ad-hoc containers (e.g. inspect `docker run`) are gone. Removing networks
    // here would race them and yield "active endpoints" errors.
    for (const tag of imagesToRemove) {
      await removeDockerImage(tag);
    }
  }
}

// ---------------------------------------------------------------------------
// Utility: Environment variables
// ---------------------------------------------------------------------------

/** `-eKEY=VALUE` flags for `docker run`. */
function dockerRunCoderEnvArgs(c: ContainerEnv): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(c.env)) out.push(`-e${k}=${v}`);
  for (const [k, v] of Object.entries(c.secretEnv)) out.push(`-e${k}=${v}`);
  return out;
}

function pushLeashContainerEnv(leashArgs: string[], c: ContainerEnv): void {
  for (const [k, v] of Object.entries(c.env)) {
    leashArgs.push('--env', `${k}=${v}`);
  }
  for (const [k, v] of Object.entries(c.secretEnv)) {
    leashArgs.push('--env', `${k}=${v}`);
  }
}

/** Log / debug copy of `docker run` `-eKEY=VALUE` flags: secrets → `****`, task body → length only. */
function redactDockerRunArgsForPrint(args: string[], c: ContainerEnv): string[] {
  const secretKeys = new Set(Object.keys(c.secretEnv));
  return args.map((a) => {
    if (!a.startsWith('-e')) return a;
    const eq = a.indexOf('=');
    if (eq <= 2) return a;
    const k = a.slice(2, eq);
    if (secretKeys.has(k)) return `-e${k}=****`;
    if (k === 'SAIFAC_INITIAL_TASK') return `-e${k}=<task (${a.length - eq - 1} chars)>`;
    return a;
  });
}

/** Log-safe view of Leash argv env fragments (`KEY=VALUE` tokens): same redaction rules as {@link redactDockerRunArgsForPrint}. */
function redactLeashArgsForPrint(leashArgs: string[], c: ContainerEnv): string[] {
  const secretKeys = new Set(Object.keys(c.secretEnv));
  return leashArgs.map((a) => {
    if (!a.includes('=')) return a;
    const eq = a.indexOf('=');
    const k = a.slice(0, eq);
    if (secretKeys.has(k)) return `${k}=****`;
    if (k === 'SAIFAC_INITIAL_TASK') return `${k}=<task (${a.length - eq - 1} chars)>`;
    return a;
  });
}

// ---------------------------------------------------------------------------
// Other utilities
// ---------------------------------------------------------------------------

/**
 * Resolve symlinks on the host path before passing to `docker run -v`.
 * On macOS, `/tmp` often symlinks to `/private/tmp`; mixing non-canonical paths with
 * Colima/Docker Desktop bind mounts can yield empty mounts (e.g. `/saifac/startup.sh` missing).
 * Leash also uses `getcwd()` as `callerDir`; keep {@link spawn} `cwd` aligned with the same path.
 */
async function dockerHostBindPath(hostPath: string): Promise<string> {
  try {
    return await realpath(hostPath);
  } catch {
    return hostPath;
  }
}
