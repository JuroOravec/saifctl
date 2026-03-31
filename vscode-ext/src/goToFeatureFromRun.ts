/**
 * Resolve a Run to a feature folder under saifctl/features and reveal it in the Features tree
 * or in the workspace Explorer (fallback).
 */

import * as path from 'node:path';

import * as vscode from 'vscode';

import { type SaifctlCliService } from './cliService';
import {
  type FeatureItem,
  type FeaturesTreeProvider,
  type SaifctlTreeItem,
} from './FeaturesTreeProvider';
import { type SaifctlRunData } from './RunsTreeProvider';

function featureLabelString(item: FeatureItem): string {
  const { label } = item;
  return typeof label === 'string' ? label : (label?.label ?? '');
}

function uniqueNonEmptyStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const s = raw.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * specRef from run artifacts is often a path like `saifctl/features/my-feat` or a relative key
 * `group/sub`. Produce ordered match keys (relative path under saifctl/features).
 */
export function specRefToCandidateRelativeKeys(specRef: string): string[] {
  const normalized = specRef.replace(/\\/g, '/').trim();
  if (!normalized) return [];

  const candidates: string[] = [];
  const featuresIdx = normalized.indexOf('features/');
  if (featuresIdx >= 0) {
    const tail = normalized
      .slice(featuresIdx + 'features/'.length)
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    if (tail) candidates.push(tail);
  }

  if (normalized.includes('/')) {
    const base = path.posix.basename(normalized);
    if (base && base !== normalized) candidates.push(base);
  }

  candidates.push(normalized);
  return uniqueNonEmptyStrings(candidates);
}

export function buildFeatureMatchCandidates(opts: {
  fullSpecRef: string;
  runSpecRefDisplay: string;
  runFeatureName: string;
}): string[] {
  return uniqueNonEmptyStrings([
    ...specRefToCandidateRelativeKeys(opts.fullSpecRef),
    ...specRefToCandidateRelativeKeys(opts.runSpecRefDisplay),
    opts.runFeatureName.trim(),
  ]);
}

export function findFeatureItemByCandidates(
  features: FeatureItem[],
  candidates: string[],
): FeatureItem | null {
  for (const key of candidates) {
    const exact = features.find((f) => featureLabelString(f) === key);
    if (exact) return exact;
  }
  for (const key of candidates) {
    const lower = key.toLowerCase();
    const ci = features.find((f) => featureLabelString(f).toLowerCase() === lower);
    if (ci) return ci;
  }
  for (const key of candidates) {
    const base = path.basename(key);
    const byBase = features.find((f) => {
      const lab = featureLabelString(f);
      return lab === base || path.basename(lab) === base || lab.endsWith(`/${base}`);
    });
    if (byBase) return byBase;
  }
  return null;
}

async function resolveFullSpecRef(cli: SaifctlCliService, run: SaifctlRunData): Promise<string> {
  const info = await cli.getRunInfo(run.id, run.projectPath);
  const raw = info?.specRef;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return '';
}

/**
 * Focus SaifCTL sidebar, reveal the feature in the Features tree; on failure, reveal the folder
 * in the workspace Explorer.
 */
export async function goToFeatureForRun(opts: {
  run: SaifctlRunData;
  featuresProvider: FeaturesTreeProvider;
  featuresTreeView: vscode.TreeView<SaifctlTreeItem>;
  cli: SaifctlCliService;
}): Promise<void> {
  const { run, featuresProvider, featuresTreeView, cli } = opts;

  const fullSpecRef = await resolveFullSpecRef(cli, run);
  const candidates = buildFeatureMatchCandidates({
    fullSpecRef,
    runSpecRefDisplay: run.specRef,
    runFeatureName: run.name,
  });

  const features = await featuresProvider.listFeatureItemsForProject(run.projectPath);
  const featureItem = findFeatureItemByCandidates(features, candidates);

  if (!featureItem) {
    const tried = candidates.length > 0 ? candidates.join(', ') : '(no spec / name)';
    void vscode.window.showWarningMessage(
      `SaifCTL: No matching feature under saifctl/features for this run (tried: ${tried}).`,
    );
    return;
  }

  const folderUri = vscode.Uri.file(featureItem.featurePath);

  try {
    await vscode.commands.executeCommand('workbench.view.extension.saifctl-explorer');
    await featuresTreeView.reveal(featureItem, {
      focus: true,
      select: true,
      expand: true,
    });
  } catch {
    await vscode.commands.executeCommand('workbench.view.explorer');
    await vscode.commands.executeCommand('revealInExplorer', folderUri);
  }
}
