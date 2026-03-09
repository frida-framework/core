import * as path from 'path';
import type {
  BootstrapPackageManifest,
  BootstrapPackageManifestEntry,
  BootstrapPackageMode,
} from './bootstrap-manifest.ts';
import { entryAppliesToMode } from './bootstrap-manifest.ts';

export type BootstrapReconcileMode = 'warm' | 'cold-engine' | 'zero-start' | 'component';

export type BootstrapPlanOperation =
  | {
    kind: 'reset_dir';
    targetPath: string;
    absolutePath: string;
    reason: string;
  }
  | {
    kind: 'delete_dir';
    targetPath: string;
    absolutePath: string;
    reason: string;
  }
  | {
    kind: 'delete_file';
    targetPath: string;
    absolutePath: string;
    reason: string;
  }
  | {
    kind: 'ensure_dir';
    targetPath: string;
    absolutePath: string;
    reason: string;
  }
  | {
    kind: 'copy_file';
    sourcePath: string;
    sourceAbsolutePath: string;
    targetPath: string;
    targetAbsolutePath: string;
    reason: string;
  }
  | {
    kind: 'seed_file';
    sourcePath: string;
    sourceAbsolutePath: string;
    targetPath: string;
    targetAbsolutePath: string;
    reason: string;
  }
  | {
    kind: 'note';
    message: string;
  };

export interface BootstrapOperationPlan {
  mode: BootstrapReconcileMode;
  targetDir: string;
  operations: BootstrapPlanOperation[];
  applicableEntries: string[];
  requiresGeneration: boolean;
}

export interface BuildBootstrapPlanOptions {
  packageRoot: string;
  targetDir: string;
  manifest: BootstrapPackageManifest;
  mode: BootstrapPackageMode;
  componentName?: string | null;
}

export class BootstrapPlanBuildError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

function toPosixRelativePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function toAbsoluteTargetPath(targetDir: string, targetPath: string): string {
  return path.resolve(targetDir, targetPath);
}

function comparePathAsc(a: string, b: string): number {
  return a.localeCompare(b);
}

function isSameOrChildPath(candidatePath: string, rootPath: string): boolean {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`);
}

function normalizeComponentName(componentName: string): string {
  return componentName.trim().toLowerCase();
}

function entryMatchesComponent(entry: BootstrapPackageManifestEntry, componentName: string): boolean {
  const component = normalizeComponentName(componentName);
  const target = toPosixRelativePath(entry.target);

  switch (component) {
    case 'all':
      return true;
    case 'playbooks':
      return (
        target === '.frida/contract/playbooks' ||
        target.startsWith('.frida/contract/playbooks/') ||
        target === '.frida/playbooks' ||
        target.startsWith('.frida/playbooks/')
      );
    case 'bootloader':
    case 'agents':
      return target === 'AGENTS.md';
    case 'generated':
      return entry.ownership_class === 'engine_generated';
    case 'runtime-config-template':
    case 'config-template':
      return target === '.frida/templates/config.template.yaml';
    default:
      return false;
  }
}

function validateNoForbiddenTargets(entries: BootstrapPackageManifestEntry[], mode: BootstrapReconcileMode): void {
  for (const entry of entries) {
    const target = toPosixRelativePath(entry.target);
    if (target.startsWith('contract/')) {
      throw new BootstrapPlanBuildError(
        'APP_CONTRACT_WRITE_FORBIDDEN',
        `bootstrap manifest entry ${entry.id} targets app contract path (${target}); this is forbidden in ${mode} mode`
      );
    }
  }
}

function addNote(ops: BootstrapPlanOperation[], seen: Set<string>, message: string): void {
  const key = `note:${message}`;
  if (seen.has(key)) return;
  seen.add(key);
  ops.push({ kind: 'note', message });
}

function addEnsureDir(
  ops: BootstrapPlanOperation[],
  seen: Set<string>,
  targetDir: string,
  relPath: string,
  reason: string
): void {
  const normalizedRel = toPosixRelativePath(relPath);
  const key = `ensure_dir:${normalizedRel}`;
  if (seen.has(key)) return;
  seen.add(key);
  ops.push({
    kind: 'ensure_dir',
    targetPath: normalizedRel,
    absolutePath: toAbsoluteTargetPath(targetDir, normalizedRel),
    reason,
  });
}

function addResetDir(
  ops: BootstrapPlanOperation[],
  seen: Set<string>,
  targetDir: string,
  relPath: string,
  reason: string
): void {
  const normalizedRel = toPosixRelativePath(relPath);
  const key = `reset_dir:${normalizedRel}`;
  if (seen.has(key)) return;
  seen.add(key);
  ops.push({
    kind: 'reset_dir',
    targetPath: normalizedRel,
    absolutePath: toAbsoluteTargetPath(targetDir, normalizedRel),
    reason,
  });
}

function addDeleteDir(
  ops: BootstrapPlanOperation[],
  seen: Set<string>,
  targetDir: string,
  relPath: string,
  reason: string
): void {
  const normalizedRel = toPosixRelativePath(relPath);
  const key = `delete_dir:${normalizedRel}`;
  if (seen.has(key)) return;
  seen.add(key);
  ops.push({
    kind: 'delete_dir',
    targetPath: normalizedRel,
    absolutePath: toAbsoluteTargetPath(targetDir, normalizedRel),
    reason,
  });
}

function addDeleteFile(
  ops: BootstrapPlanOperation[],
  seen: Set<string>,
  targetDir: string,
  relPath: string,
  reason: string
): void {
  const normalizedRel = toPosixRelativePath(relPath);
  const key = `delete_file:${normalizedRel}`;
  if (seen.has(key)) return;
  seen.add(key);
  ops.push({
    kind: 'delete_file',
    targetPath: normalizedRel,
    absolutePath: toAbsoluteTargetPath(targetDir, normalizedRel),
    reason,
  });
}

function addCopyFile(
  ops: BootstrapPlanOperation[],
  seen: Set<string>,
  packageRoot: string,
  manifest: BootstrapPackageManifest,
  targetDir: string,
  entry: BootstrapPackageManifestEntry,
  reason: string
): void {
  const targetPath = toPosixRelativePath(entry.target);
  const key = `copy_file:${targetPath}`;
  if (seen.has(key)) return;
  if (!entry.source) {
    throw new BootstrapPlanBuildError(
      'BOOTSTRAP_RECONCILE_PLAN_CONFLICT',
      `copy entry ${entry.id} is missing source while building plan`
    );
  }
  seen.add(key);
  ops.push({
    kind: 'copy_file',
    sourcePath: toPosixRelativePath(entry.source),
    sourceAbsolutePath: path.resolve(packageRoot, manifest.assets_root, entry.source),
    targetPath,
    targetAbsolutePath: toAbsoluteTargetPath(targetDir, targetPath),
    reason,
  });
}

function resolveManifestEntries(
  manifest: BootstrapPackageManifest,
  mode: BootstrapPackageMode,
  componentName?: string | null
): { entries: BootstrapPackageManifestEntry[]; modeOut: BootstrapReconcileMode } {
  const baseEntries = manifest.entries.filter((entry) => entryAppliesToMode(entry, mode));
  if (!componentName) {
    const modeOut: BootstrapReconcileMode =
      mode === 'warm' ? 'warm'
        : mode === 'zero-start' ? 'zero-start'
          : 'cold-engine';
    return { entries: baseEntries, modeOut };
  }

  const selected = baseEntries.filter((entry) => entryMatchesComponent(entry, componentName));
  if (selected.length === 0) {
    throw new BootstrapPlanBuildError(
      'BOOTSTRAP_COMPONENT_UNKNOWN',
      `unknown or unsupported bootstrap component: ${componentName}`
    );
  }
  return { entries: selected, modeOut: 'component' };
}

function checkPreservePruneConflicts(entries: BootstrapPackageManifestEntry[], fullMode: boolean): void {
  if (!fullMode) return;

  const pruneRoots = entries
    .filter((entry) => entry.prune_scope && (entry.kind === 'dir' || entry.kind === 'tree'))
    .map((entry) => toPosixRelativePath(entry.target));

  const preserves = entries
    .filter((entry) => entry.ownership_class === 'user_owned' || entry.ownership_class === 'user_data')
    .map((entry) => toPosixRelativePath(entry.target));

  for (const preserve of preserves) {
    for (const pruneRoot of pruneRoots) {
      if (isSameOrChildPath(preserve, pruneRoot)) {
        throw new BootstrapPlanBuildError(
          'BOOTSTRAP_RECONCILE_PLAN_CONFLICT',
          `preserve path ${preserve} falls under prune scope ${pruneRoot}`
        );
      }
    }
  }
}

function sortOperations(ops: BootstrapPlanOperation[]): BootstrapPlanOperation[] {
  const rank = (op: BootstrapPlanOperation): number => {
    switch (op.kind) {
      case 'reset_dir':
        return 1;
      case 'delete_dir':
        return 2;
      case 'delete_file':
        return 3;
      case 'ensure_dir':
        return 4;
      case 'copy_file':
        return 5;
      case 'seed_file':
        return 6;
      case 'note':
        return 7;
    }
  };

  return [...ops].sort((a, b) => {
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;

    const aKey = a.kind === 'note' ? a.message : a.targetPath;
    const bKey = b.kind === 'note' ? b.message : b.targetPath;
    return comparePathAsc(aKey, bKey);
  });
}

export function buildBootstrapPlan(options: BuildBootstrapPlanOptions): BootstrapOperationPlan {
  const targetDir = path.resolve(options.targetDir);
  const { entries, modeOut } = resolveManifestEntries(options.manifest, options.mode, options.componentName);
  validateNoForbiddenTargets(entries, modeOut);

  const fullMode = modeOut !== 'component';
  checkPreservePruneConflicts(entries, fullMode);

  const ops: BootstrapPlanOperation[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const target = toPosixRelativePath(entry.target);
    if (entry.kind === 'dir' && entry.apply_mode === 'ensure_dir' && target === '.frida') {
      addEnsureDir(ops, seen, targetDir, target, 'Bootstrap root for Frida-managed artifacts');
    }
  }

  if (fullMode) {
    for (const entry of entries) {
      if (!entry.prune_scope) continue;
      if (entry.kind === 'file') {
        addDeleteFile(
          ops,
          seen,
          targetDir,
          entry.target,
          `Strict reconcile removes declared cleanup-only file (${entry.id})`
        );
        continue;
      }
      if (entry.kind !== 'dir' && entry.kind !== 'tree') continue;
      if (entry.cleanup_only) {
        addDeleteDir(
          ops,
          seen,
          targetDir,
          entry.target,
          `Strict reconcile removes declared cleanup-only directory (${entry.id})`
        );
        continue;
      }
      addResetDir(ops, seen, targetDir, entry.target, `Strict reconcile resets managed scope (${entry.id})`);
    }
  }

  for (const entry of entries) {
    const target = toPosixRelativePath(entry.target);

    if (entry.cleanup_only) {
      continue;
    }

    if (entry.apply_mode === 'ensure_dir') {
      if (entry.kind !== 'dir' && entry.kind !== 'tree') {
        throw new BootstrapPlanBuildError(
          'BOOTSTRAP_RECONCILE_PLAN_CONFLICT',
          `ensure_dir entry ${entry.id} must be kind=dir|tree`
        );
      }
      addEnsureDir(ops, seen, targetDir, target, `Ensure managed directory (${entry.id})`);
      continue;
    }

    if (entry.apply_mode === 'copy') {
      addEnsureDir(ops, seen, targetDir, path.posix.dirname(target), `Parent directory for ${entry.id}`);
      addCopyFile(
        ops,
        seen,
        options.packageRoot,
        options.manifest,
        targetDir,
        entry,
        `Deploy package reference file (${entry.id})`
      );
      continue;
    }

    if (entry.apply_mode === 'seed_if_absent') {
      if (entry.kind !== 'file') {
        throw new BootstrapPlanBuildError(
          'BOOTSTRAP_RECONCILE_PLAN_CONFLICT',
          `seed_if_absent entry ${entry.id} must be kind=file`
        );
      }
      if (!entry.source) {
        throw new BootstrapPlanBuildError(
          'BOOTSTRAP_RECONCILE_PLAN_CONFLICT',
          `seed_if_absent entry ${entry.id} is missing source`
        );
      }
      const sourcePath = toPosixRelativePath(entry.source);
      const key = `seed_file:${target}`;
      if (!seen.has(key)) {
        seen.add(key);
        addEnsureDir(ops, seen, targetDir, path.posix.dirname(target), `Parent directory for ${entry.id}`);
        ops.push({
          kind: 'seed_file',
          sourcePath,
          sourceAbsolutePath: path.resolve(options.packageRoot, options.manifest.assets_root, entry.source),
          targetPath: target,
          targetAbsolutePath: toAbsoluteTargetPath(targetDir, target),
          reason: `Seed template file if absent (${entry.id})`,
        });
      }
      continue;
    }

    if (entry.ownership_class === 'user_owned') {
      addNote(ops, seen, `PRESERVE user-owned runtime config: ${target}`);
      continue;
    }

    if (entry.ownership_class === 'user_data') {
      if (entry.kind === 'dir' || entry.kind === 'tree') {
        addEnsureDir(ops, seen, targetDir, target, `Preserve user data scope (${entry.id})`);
      }
      addNote(ops, seen, `PRESERVE user data: ${target}`);
      continue;
    }

    if (entry.apply_mode === 'generated') {
      if (entry.kind === 'dir' && !entry.prune_scope) {
        addEnsureDir(ops, seen, targetDir, target, `Ensure generated directory root (${entry.id})`);
      }
      continue;
    }
  }

  const requiresGeneration = modeOut === 'warm' || modeOut === 'cold-engine' || modeOut === 'zero-start'
    ? true
    : entries.some((entry) => entry.ownership_class === 'engine_generated');

  if (requiresGeneration) {
    addNote(ops, seen, 'POSTGEN run Frida generation (rebuild generated artifacts and runtime config template)');
  }

  return {
    mode: modeOut,
    targetDir,
    operations: sortOperations(ops),
    applicableEntries: entries.map((entry) => entry.id),
    requiresGeneration,
  };
}
