/**
 * Resolve and read per-phase script-path fields (`gate.script`,
 * `agent.script`, and the equivalents that ship in later phases —
 * `container.startup`, `container.cedar`, `runner.test-script`,
 * `runner.stage-script`, etc.).
 *
 * Path semantics (per-phase-config design §4.3):
 *   1. `<phase dir>/<relativePath>`
 *   2. `<feature dir>/<relativePath>`
 *   3. `<projectDir>/<relativePath>`
 * The first one that exists wins. If none exist, throws
 * {@link ScriptNotFoundError}. If the resolved file is outside the
 * project root after symlink resolution, throws
 * {@link ScriptOutsideProjectError}.
 *
 * Two entry points:
 * - {@link resolveScriptPath} — returns the absolute path. Used by
 *   `validate.ts` to surface missing-file / out-of-project errors at
 *   validate time, before compile runs.
 * - {@link resolveAndReadScript} — calls the above, then reads the file
 *   as UTF-8. Used by `compile.ts` to inline script content into
 *   `RunSubtaskInput.gateScript` / `.agentScript`.
 *
 * The relative path itself must already pass the schema-time
 * `..`-segment / absolute-path guard (see `schema.ts:relativePathSchema`).
 * This module assumes that guard has run; it doesn't re-check the
 * schema-shape of the input string.
 */

import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { pathExists, readUtf8 } from '../../utils/io.js';

/** Where a script path resolved against — used for diagnostics / logs. */
export type ScriptResolutionSource = 'phase' | 'feature' | 'project';

/** Inputs to {@link resolveScriptPath} / {@link resolveAndReadScript}. */
export interface ScriptResolverOptions {
  /** Absolute path to the phase dir (e.g. `<project>/saifctl/features/foo/phases/01`). */
  phaseAbsolutePath: string;
  /** Absolute path to the feature dir (e.g. `<project>/saifctl/features/foo`). */
  featureAbsolutePath: string;
  /** Absolute path to the project root. */
  projectDir: string;
  /**
   * YAML field path used in error messages (e.g. `'gate.script'`).
   * Lets the validator / compiler emit diagnostics that name the
   * exact YAML key the user needs to fix.
   */
  fieldPath: string;
  /**
   * Optional source label for the *config layer* the value came from
   * (e.g. `phases/01-core/phase.yml`, `feature.yml.phases.defaults`).
   * Folded into error messages so users can locate the offending
   * declaration. Optional — defaults to a generic "in <feature>" form.
   */
  sourceLabel?: string;
}

/** Result of {@link resolveScriptPath}: absolute path + which root it resolved against. */
export interface ResolvedScriptPath {
  /** Absolute path to the resolved file (after `realpath`). */
  absolutePath: string;
  /** Which root the relative path resolved against. */
  resolvedFrom: ScriptResolutionSource;
}

/** Result of {@link resolveAndReadScript}: resolution metadata + UTF-8 file content. */
export interface ResolvedScriptContent extends ResolvedScriptPath {
  /** UTF-8 content of the script. */
  content: string;
}

/**
 * Thrown when a relative path doesn't resolve against any of the three
 * roots (phase / feature / project). Caller catches this to format a
 * single per-source error message.
 */
export class ScriptNotFoundError extends Error {
  override readonly name = 'ScriptNotFoundError';
  /** YAML field path the relative path came from. */
  readonly fieldPath: string;
  /** The relative path the user wrote. */
  readonly relativePath: string;
  /** Roots we searched, in order. */
  readonly searched: readonly string[];
  constructor(opts: {
    fieldPath: string;
    relativePath: string;
    searched: readonly string[];
    sourceLabel?: string;
  }) {
    const where = opts.sourceLabel ? ` (set at ${opts.sourceLabel})` : '';
    super(
      `\`${opts.fieldPath}: ${opts.relativePath}\`${where} could not be located. Searched (in order): ${opts.searched.join(', ')}.`,
    );
    this.fieldPath = opts.fieldPath;
    this.relativePath = opts.relativePath;
    this.searched = opts.searched;
  }
}

/**
 * Thrown when the resolved file (after `realpath`) is outside the
 * project root. This catches symlinks that leave the project as well
 * as race conditions where the path itself was clean but a parent
 * symlink took us out.
 */
export class ScriptOutsideProjectError extends Error {
  override readonly name = 'ScriptOutsideProjectError';
  readonly fieldPath: string;
  readonly relativePath: string;
  readonly resolvedAbsolutePath: string;
  readonly projectDir: string;
  constructor(opts: {
    fieldPath: string;
    relativePath: string;
    resolvedAbsolutePath: string;
    projectDir: string;
    sourceLabel?: string;
  }) {
    const where = opts.sourceLabel ? ` (set at ${opts.sourceLabel})` : '';
    super(
      `\`${opts.fieldPath}: ${opts.relativePath}\`${where} resolves to a path outside the project root after symlink resolution: ${opts.resolvedAbsolutePath} is not inside ${opts.projectDir}.`,
    );
    this.fieldPath = opts.fieldPath;
    this.relativePath = opts.relativePath;
    this.resolvedAbsolutePath = opts.resolvedAbsolutePath;
    this.projectDir = opts.projectDir;
  }
}

/**
 * Thrown when the resolved path exists but isn't a regular file (e.g. it's
 * a directory, a socket, a FIFO). Without this check, the eventual
 * `readUtf8` would fail with a less-helpful `EISDIR` (or similar). Surfacing
 * a typed error lets the validator / compiler print "must be a regular
 * file" with the field name attached.
 */
export class ScriptNotARegularFileError extends Error {
  override readonly name = 'ScriptNotARegularFileError';
  readonly fieldPath: string;
  readonly relativePath: string;
  readonly resolvedAbsolutePath: string;
  constructor(opts: {
    fieldPath: string;
    relativePath: string;
    resolvedAbsolutePath: string;
    sourceLabel?: string;
  }) {
    const where = opts.sourceLabel ? ` (set at ${opts.sourceLabel})` : '';
    super(
      `\`${opts.fieldPath}: ${opts.relativePath}\`${where} resolves to ${opts.resolvedAbsolutePath} which is not a regular file. Script-path fields must point at a file (e.g. a shell script), not a directory.`,
    );
    this.fieldPath = opts.fieldPath;
    this.relativePath = opts.relativePath;
    this.resolvedAbsolutePath = opts.resolvedAbsolutePath;
  }
}

/**
 * Resolve a relative script path against the three roots and return the
 * absolute path of the first one that exists. Throws
 * {@link ScriptNotFoundError} when none exist;
 * {@link ScriptOutsideProjectError} when the resolved file (after symlinks)
 * escapes the project root; {@link ScriptNotARegularFileError} when the
 * resolved path exists but isn't a regular file (e.g. a directory).
 *
 * `relativePath` must already pass the schema-time `..` / absolute-path
 * guard. If an absolute path slips through (e.g. from a non-validated
 * code path), we still reject it here as out-of-project.
 */
export async function resolveScriptPath(
  relativePath: string,
  opts: ScriptResolverOptions,
): Promise<ResolvedScriptPath> {
  const { phaseAbsolutePath, featureAbsolutePath, projectDir, fieldPath, sourceLabel } = opts;

  // Defence in depth: an absolute path here would mean the schema-time
  // guard didn't run. Reject by treating it as out-of-project (any path
  // we didn't construct is suspect).
  if (isAbsolute(relativePath)) {
    throw new ScriptOutsideProjectError({
      fieldPath,
      relativePath,
      resolvedAbsolutePath: relativePath,
      projectDir,
      sourceLabel,
    });
  }

  const candidates: { source: ScriptResolutionSource; path: string }[] = [
    { source: 'phase', path: join(phaseAbsolutePath, relativePath) },
    { source: 'feature', path: join(featureAbsolutePath, relativePath) },
    { source: 'project', path: join(projectDir, relativePath) },
  ];

  // Hoist the project-root realpath out of the candidate loop — it's the
  // same value every iteration, and `realpath` is a syscall.
  const projectReal = await realpath(projectDir);

  for (const cand of candidates) {
    if (!(await pathExists(cand.path))) continue;
    // realpath resolves symlinks; the result must still be inside the project.
    const resolved = await realpath(cand.path);
    const rel = relative(projectReal, resolved);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new ScriptOutsideProjectError({
        fieldPath,
        relativePath,
        resolvedAbsolutePath: resolved,
        projectDir: projectReal,
        sourceLabel,
      });
    }
    // Reject directories / sockets / FIFOs early so the caller doesn't
    // hit a cryptic EISDIR from `readUtf8` later. Symlinks already
    // resolved through `realpath` above, so `stat` (not `lstat`) sees
    // the underlying file type.
    const st = await stat(resolved);
    if (!st.isFile()) {
      throw new ScriptNotARegularFileError({
        fieldPath,
        relativePath,
        resolvedAbsolutePath: resolved,
        sourceLabel,
      });
    }
    return { absolutePath: resolved, resolvedFrom: cand.source };
  }

  throw new ScriptNotFoundError({
    fieldPath,
    relativePath,
    searched: candidates.map((c) => c.path),
    sourceLabel,
  });
}

/**
 * Resolve and read a script. Same as {@link resolveScriptPath} plus a
 * UTF-8 read of the resolved file. Caller throws on the same error
 * types; this function does not catch them.
 */
export async function resolveAndReadScript(
  relativePath: string,
  opts: ScriptResolverOptions,
): Promise<ResolvedScriptContent> {
  const resolved = await resolveScriptPath(relativePath, opts);
  const content = await readUtf8(resolved.absolutePath);
  return { ...resolved, content };
}

/**
 * Feature-level variant of {@link resolveScriptPath}: searches `<feature dir>`
 * then `<projectDir>` (no phase root). Used by the run-level baseline path in
 * `options.ts` for `feature.yml` top-level / `phases.defaults` declarations of
 * `container.cedar`, `container.startup`, `agent.install` (per-phase-config
 * phase 7.5c). Without this, those values would be passed through
 * `readUtf8` / `resolve(projectDir, ...)` raw — which only works when the
 * file happens to live at the project root, not at the feature root the
 * design.md §4.3 contract promises.
 *
 * Same symlink + project-containment + regular-file guards as
 * {@link resolveScriptPath}. The feature-level form is structurally a
 * two-root subset of the three-root form; we keep them as separate
 * functions so the per-phase compile path doesn't accidentally lose its
 * phase root, and so this path's error messages don't list a redundant
 * "<feature>/<rel>" candidate twice.
 */
export async function resolveFeatureLevelScriptPath(
  relativePath: string,
  opts: {
    /** Absolute path to the feature dir (e.g. `<project>/saifctl/features/foo`). */
    featureAbsolutePath: string;
    /** Absolute path to the project root. */
    projectDir: string;
    /** YAML field path used in error messages (e.g. `'container.cedar'`). */
    fieldPath: string;
    /** Source label for the *config layer* the value came from. */
    sourceLabel?: string;
  },
): Promise<ResolvedScriptPath> {
  const { featureAbsolutePath, projectDir, fieldPath, sourceLabel } = opts;

  // Defence in depth — same guard as {@link resolveScriptPath}.
  if (isAbsolute(relativePath)) {
    throw new ScriptOutsideProjectError({
      fieldPath,
      relativePath,
      resolvedAbsolutePath: relativePath,
      projectDir,
      sourceLabel,
    });
  }

  const candidates: { source: ScriptResolutionSource; path: string }[] = [
    { source: 'feature', path: join(featureAbsolutePath, relativePath) },
    { source: 'project', path: join(projectDir, relativePath) },
  ];

  const projectReal = await realpath(projectDir);

  for (const cand of candidates) {
    if (!(await pathExists(cand.path))) continue;
    const resolved = await realpath(cand.path);
    const rel = relative(projectReal, resolved);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new ScriptOutsideProjectError({
        fieldPath,
        relativePath,
        resolvedAbsolutePath: resolved,
        projectDir: projectReal,
        sourceLabel,
      });
    }
    const st = await stat(resolved);
    if (!st.isFile()) {
      throw new ScriptNotARegularFileError({
        fieldPath,
        relativePath,
        resolvedAbsolutePath: resolved,
        sourceLabel,
      });
    }
    return { absolutePath: resolved, resolvedFrom: cand.source };
  }

  throw new ScriptNotFoundError({
    fieldPath,
    relativePath,
    searched: candidates.map((c) => c.path),
    sourceLabel,
  });
}

/**
 * Helper for places that have already done the work of joining a path
 * against the project dir but want the same inside-project guard. Used
 * by tests; rarely needed by production code (which goes through
 * {@link resolveScriptPath}).
 */
export async function isInsideProject(absolutePath: string, projectDir: string): Promise<boolean> {
  const resolved = await realpath(absolutePath);
  const projectReal = await realpath(projectDir);
  const rel = relative(projectReal, resolve(resolved));
  return !rel.startsWith('..') && !isAbsolute(rel);
}
