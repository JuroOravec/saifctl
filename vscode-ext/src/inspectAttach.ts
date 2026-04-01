/**
 * Poll run storage for {@link RunInspectSession} after `saifctl run inspect`, then attach via
 * Dev Containers. Attach order: `remote-containers.attachToRunningContainer` → `vscode.openFolder`
 * (vscode-remote:// URI) → `vscode.newWindow` (authority only) → `vscode.env.openExternal`.
 */

import { hostname } from 'node:os';

import * as vscode from 'vscode';

import { type SaifctlCliService } from './cliService';
import { logger } from './logger';

/**
 * Dev Containers (`ms-vscode-remote.remote-containers`) command namespace is shared by Cursor Dev
 * Containers. Reverse-engineered from extension bundle ~0.452.x:
 *
 * - `remote-containers.attachToRunningContainer` / `attachToRunningContainerFromViewlet` — Microsoft:
 *   first arg is a **string** (container name/id) or a tree item with **`containerDesc.Id`**.
 *   **Cursor (anysphere.remote-containers):** both commands share one handler that, if the argument is
 *   **truthy**, requires **`{ containerId: string }`** (see `dist/main.js`). A bare string is treated
 *   like a broken viewlet event → “No container id found”. Omit the arg to fall through to a docker
 *   `ps` quick-pick (not what we want). So on Cursor we pass `{ containerId: ref }` where `ref` is
 *   name or full id (Docker inspect accepts either).
 * - `remote-containers.attachToContainerInNewWindow` / `attachToContainerInCurrentWindow` — used by
 *   Remote Explorer (`targetsContainers`): require Dev Containers’ **container tree item** shape
 *   (`isContainerItem` → `.container`), not a plain string. This matches the “attach in new window”
 *   icon on that view, not Container Tools (`ms-azuretools.vscode-containers`), which has **no**
 *   “open VS Code in container” command — only shell attach, browse URL, open files via `containers:`
 *   FS.
 *
 * Internal attach flow (minified `fC`): if a workspace folder path `o` is known,
 * `vscode.openFolder(vscode-remote URI, { forceNewWindow | forceReuseWindow })`; else
 * `vscode.newWindow({ remoteAuthority, reuseWindow? })`.
 */
const ATTACH_TO_RUNNING_CONTAINER_COMMAND = 'remote-containers.attachToRunningContainer';
const OPEN_FOLDER_COMMAND = 'vscode.openFolder';
const NEW_WINDOW_COMMAND = 'vscode.newWindow';

function isLikelyMissingAttachCommand(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('not found') ||
    m.includes('not registered') ||
    m.includes('unknown command') ||
    (m.includes('command') && m.includes('does not exist'))
  );
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 180_000;

export interface RunInspectSessionPayload {
  containerName: string;
  /** Full Docker container ID when present in `run info` (preferred for Dev Containers attach). */
  containerId: string | null;
  workspacePath: string;
  startedAt: string;
}

function parseInspectSession(
  info: Record<string, unknown> | null,
): RunInspectSessionPayload | null {
  if (!info) return null;
  if (info.status !== 'inspecting') return null;
  const session = info.inspectSession;
  if (!session || typeof session !== 'object' || Array.isArray(session)) return null;
  const o = session as Record<string, unknown>;
  const containerName = o.containerName;
  const rawContainerId = o.containerId;
  const workspacePath = o.workspacePath;
  const startedAt = o.startedAt;
  if (typeof containerName !== 'string' || !containerName.trim()) return null;
  if (typeof workspacePath !== 'string' || !workspacePath.trim()) return null;
  if (typeof startedAt !== 'string' || !startedAt.trim()) return null;
  let containerId: string | null = null;
  if (typeof rawContainerId === 'string' && rawContainerId.trim()) {
    containerId = rawContainerId.trim();
  }
  return {
    containerName: containerName.trim(),
    containerId,
    workspacePath: workspacePath.trim(),
    startedAt: startedAt.trim(),
  };
}

/** Docker `inspect` accepts container ID or name; prefer persisted ID when present. */
function devContainerAttachRef(session: RunInspectSessionPayload): string {
  const id = session.containerId?.trim();
  return id && id.length > 0 ? id : session.containerName;
}

/**
 * When running inside an SSH Remote session, return the SSH host name so it can be injected into
 * the `attached-container` payload as `settings.host`, directing Dev Containers to contact Docker
 * on the remote machine rather than locally.
 *
 * The extension host runs **on the remote** (`mac`), so workspace folder URIs are local file paths
 * — not `ssh-remote+…` encoded. Instead we:
 *   1. Try to parse the host from the first workspace folder URI authority (works in UI-side runs).
 *   2. Fall back to `os.hostname()` (the extension is already running on the target host, so its
 *      hostname is the SSH host Cursor connected to).
 */
function currentSshHost(): string | undefined {
  if (vscode.env.remoteName !== 'ssh-remote') return undefined;

  // Attempt 1: URI authority (works when extension runs on UI side).
  const uriAuth = vscode.workspace.workspaceFolders?.[0]?.uri.authority ?? '';
  if (uriAuth.startsWith('ssh-remote+')) {
    try {
      const hex = uriAuth.slice('ssh-remote+'.length);
      const json = Buffer.from(hex, 'hex').toString('utf8');
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const host = parsed.hostName;
      if (typeof host === 'string' && host.trim()) {
        logger.debug(`[inspect-attach] sshHost from URI authority: ${host.trim()}`);
        return host.trim();
      }
    } catch {
      // Malformed authority — fall through to os.hostname()
    }
  }

  // Attempt 2: os.hostname() — extension is on the remote host, hostname IS the SSH target.
  const h = hostname().trim();
  if (h) {
    logger.debug(`[inspect-attach] sshHost from os.hostname(): ${h}`);
    return h;
  }

  return undefined;
}

/**
 * Remote authority for attach-to-running-container without Dev Containers' viewlet event object.
 * When running over SSH remote, `settings.host` is injected so Dev Containers contacts Docker on
 * the remote host rather than on the local machine.
 *
 * @see https://github.com/microsoft/vscode-remote-release/issues/5171
 */
function buildAttachedContainerRemoteAuthority(session: RunInspectSessionPayload): string {
  const ref = devContainerAttachRef(session);
  const sshHost = currentSshHost();
  const payload: Record<string, unknown> = { containerName: ref };
  if (sshHost) {
    payload.settings = { host: `ssh://${sshHost}` };
  }
  const hex = Buffer.from(JSON.stringify(payload), 'utf8').toString('hex');
  return `attached-container+${hex}`;
}

/** `vscode-remote://attached-container+<hex>/<path>` — same as CLI `--folder-uri`. */
function buildAttachedContainerFolderUri(session: RunInspectSessionPayload): vscode.Uri {
  const authority = buildAttachedContainerRemoteAuthority(session);
  const p = session.workspacePath.trim();
  const path = p.startsWith('/') ? p : `/${p}`;
  return vscode.Uri.from({ scheme: 'vscode-remote', authority, path });
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Dev Containers / `vscode.openFolder` often return a Promise that never settles after spawning a
 * new window, which would leave {@link vscode.window.withProgress} stuck on "Attaching…".
 */
const ATTACH_COMMAND_SETTLE_MS = 800;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeAttachCommand(branch: string, fn: () => Thenable<unknown>): Promise<void> {
  let rejection: unknown;
  let settled = false;
  const p = Promise.resolve()
    .then(() => fn())
    .then(() => {
      settled = true;
    })
    .catch((e: unknown) => {
      settled = true;
      rejection = e;
    });

  await Promise.race([p, sleepMs(ATTACH_COMMAND_SETTLE_MS)]);

  if (rejection !== undefined) {
    throw rejection;
  }
  if (!settled) {
    void p.catch((e) =>
      logger.warn(`[inspect-attach] ${branch}: late error after settle timeout: ${errText(e)}`),
    );
    logger.info(
      `[inspect-attach] ${branch}: no resolution within ${ATTACH_COMMAND_SETTLE_MS}ms — treating as dispatched`,
    );
  }
}

/** Cursor's Dev Containers fork expects a viewlet-shaped `{ containerId }` when an argument is passed. */
function attachToRunningContainerCommandArg(ref: string): string | { containerId: string } {
  const app = (vscode.env.appName ?? '').toLowerCase();
  if (app.includes('cursor') || vscode.env.uriScheme === 'cursor') {
    return { containerId: ref };
  }
  return ref;
}

/**
 * Opens a new window attached to the running Docker container.
 *
 * Tries in order:
 *  1. `remote-containers.attachToRunningContainer` - native Dev Containers command (now that SSH
 *     host detection works, this should correctly contact Docker on the remote machine).
 *  2. `vscode.openFolder` with full `vscode-remote://attached-container+.../workspace` URI.
 *  3. `vscode.newWindow` with bare `attached-container+...` remote authority.
 *  4. `vscode.env.openExternal` with the same folder URI (OS-level URI handler).
 *
 * **VS Code vs Cursor folder:** When branch 1 resolves without throwing, we never run branch 2, so the
 * opened folder (e.g. `/workspace`) is whatever Dev Containers supplies from globalStorage / internal
 * config - Cursor often omits `workspaceFolder` where Microsoft's `uz()` path has it. See
 * `docs/development/vscode-ext-compat.md` section 3.1.
 */
export async function attachToRunningDevContainer(
  session: RunInspectSessionPayload,
): Promise<boolean> {
  const label = session.containerName;
  const ref = devContainerAttachRef(session);
  const folderUri = buildAttachedContainerFolderUri(session);
  const sshHost = currentSshHost();
  logger.info(
    `[inspect-attach] start container=${JSON.stringify(label)} ref=${JSON.stringify(ref)} remoteName=${JSON.stringify(vscode.env.remoteName ?? '')} sshHost=${sshHost ? JSON.stringify(sshHost) : 'none'} folderUri=${folderUri.toString()}`,
  );

  // Branch 1: native Dev Containers command - MS: string; Cursor: `{ containerId }` (see file header).
  try {
    await executeAttachCommand('attachToRunningContainer', () =>
      vscode.commands.executeCommand(
        ATTACH_TO_RUNNING_CONTAINER_COMMAND,
        attachToRunningContainerCommandArg(ref),
      ),
    );
    logger.info(
      `[inspect-attach] success branch=attachToRunningContainer container=${JSON.stringify(label)}`,
    );
    return true;
  } catch (attachErr) {
    logger.warn(
      `[inspect-attach] attachToRunningContainer failed -> try openFolder container=${JSON.stringify(label)} err=${errText(attachErr)}`,
    );
  }

  // Branch 2: vscode.openFolder with vscode-remote:// URI (includes in-container workspace path).
  try {
    await executeAttachCommand('openFolder', () =>
      vscode.commands.executeCommand(OPEN_FOLDER_COMMAND, folderUri, {
        forceNewWindow: true,
      }),
    );
    logger.info(`[inspect-attach] success branch=openFolder container=${JSON.stringify(label)}`);
    return true;
  } catch (openFolderErr) {
    const openFolderMsg = errText(openFolderErr);
    logger.warn(
      `[inspect-attach] openFolder failed → try newWindow container=${JSON.stringify(label)} err=${openFolderMsg}`,
    );

    // Branch 3: vscode.newWindow with bare attached-container authority.
    try {
      const remoteAuthority = buildAttachedContainerRemoteAuthority(session);
      await executeAttachCommand('newWindow', () =>
        vscode.commands.executeCommand(NEW_WINDOW_COMMAND, { remoteAuthority }),
      );
      logger.info(`[inspect-attach] success branch=newWindow container=${JSON.stringify(label)}`);
      return true;
    } catch (newWindowErr) {
      const newWindowMsg = errText(newWindowErr);
      logger.warn(
        `[inspect-attach] newWindow failed → try openExternal container=${JSON.stringify(label)} err=${newWindowMsg}`,
      );

      // Branch 4: OS-level URI handler via openExternal.
      try {
        const opened = await vscode.env.openExternal(folderUri);
        if (!opened) {
          throw new Error('openExternal returned false (OS or handler declined the URI)');
        }
        logger.info(
          `[inspect-attach] success branch=openExternal container=${JSON.stringify(label)}`,
        );
        return true;
      } catch (openExternalErr) {
        const openExternalMsg = errText(openExternalErr);
        const allMissing =
          isLikelyMissingAttachCommand(openFolderMsg) &&
          isLikelyMissingAttachCommand(newWindowMsg) &&
          isLikelyMissingAttachCommand(openExternalMsg);
        logger.error(
          `[inspect-attach] all branches failed container=${JSON.stringify(label)} openFolder=${openFolderMsg} newWindow=${newWindowMsg} openExternal=${openExternalMsg}`,
        );
        if (allMissing) {
          await vscode.window.showWarningMessage(
            'Could not open an attached-container window. Install **Dev Containers** (VS Code) or **Cursor Dev Containers** (Cursor).',
          );
        } else {
          await vscode.window.showErrorMessage(
            `Could not attach to container "${label}": ${openExternalMsg} ` +
              `(openFolder: ${openFolderMsg}; newWindow: ${newWindowMsg})`,
          );
        }
        return false;
      }
    }
  }
}

export interface WaitAndAttachAfterInspectOpts {
  cli: SaifctlCliService;
  runId: string;
  cwd: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** e.g. refresh Runs tree so status shows `inspecting` and inline attach is available */
  onInspectSessionReady?: () => void;
}

/**
 * Poll `run info` until status is `inspecting` and `inspectSession` is present, then attach.
 * Shows a cancellable progress notification while waiting.
 */
export async function waitAndAttachAfterInspectStart(
  opts: WaitAndAttachAfterInspectOpts,
): Promise<void> {
  const {
    cli,
    runId,
    cwd,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onInspectSessionReady,
  } = opts;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'SaifCTL inspect',
      cancellable: true,
    },
    async (progress, token) => {
      const start = Date.now();
      progress.report({ message: 'Waiting for inspect container…' });

      while (!token.isCancellationRequested) {
        if (Date.now() - start > timeoutMs) {
          await vscode.window.showWarningMessage(
            `Timed out waiting for inspect session metadata for run "${runId}". ` +
              'If the run is inspecting, use **Attach to inspect container** on the run row.',
          );
          return;
        }

        const info = await cli.getRunInfo(runId, cwd);
        const session = parseInspectSession(info);
        if (session) {
          onInspectSessionReady?.();
          progress.report({ message: `Attaching to ${session.containerName}…` });
          const ok = await attachToRunningDevContainer(session);
          if (ok) {
            void vscode.window.showInformationMessage(
              `Attached to inspect container \`${session.containerName}\` (workspace: ${session.workspacePath}).`,
            );
          }
          return;
        }

        await sleep(pollIntervalMs);
      }
    },
  );
}

export interface AttachFromRunInfoOpts {
  cli: SaifctlCliService;
  runId: string;
  cwd: string;
}

/**
 * One-shot attach using current `run info` (for runs already in `inspecting` status).
 */
export async function attachFromRunInfo(opts: AttachFromRunInfoOpts): Promise<void> {
  const { cli, runId, cwd } = opts;
  const info = await cli.getRunInfo(runId, cwd);
  const session = parseInspectSession(info);
  if (!session) {
    await vscode.window.showWarningMessage(
      `Run "${runId}" has no active inspect session. Start inspect first, or wait until status is inspecting.`,
    );
    return;
  }
  const ok = await attachToRunningDevContainer(session);
  if (ok) {
    await vscode.window.showInformationMessage(
      `Attached to \`${session.containerName}\` (workspace: ${session.workspacePath}).`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
