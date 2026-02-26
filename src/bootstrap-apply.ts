import * as fs from 'fs';
import * as path from 'path';
import type { BootstrapOperationPlan, BootstrapPlanOperation } from './bootstrap-plan.ts';

export interface BootstrapApplyOptions {
  dryRun?: boolean;
}

export interface BootstrapApplyResult {
  dryRun: boolean;
  resetDirCount: number;
  deleteDirCount: number;
  deleteFileCount: number;
  ensureDirCount: number;
  copyFileCount: number;
}

function isSameOrChildAbsolutePath(candidate: string, root: string): boolean {
  const normalizedCandidate = path.resolve(candidate);
  const normalizedRoot = path.resolve(root);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function dedupeResetOps(ops: BootstrapPlanOperation[]): Array<Extract<BootstrapPlanOperation, { kind: 'reset_dir' }>> {
  const resetOps = ops
    .filter((op): op is Extract<BootstrapPlanOperation, { kind: 'reset_dir' }> => op.kind === 'reset_dir')
    .sort((a, b) => a.absolutePath.length - b.absolutePath.length || a.targetPath.localeCompare(b.targetPath));

  const kept: Array<Extract<BootstrapPlanOperation, { kind: 'reset_dir' }>> = [];
  for (const op of resetOps) {
    const covered = kept.some((ancestor) => isSameOrChildAbsolutePath(op.absolutePath, ancestor.absolutePath));
    if (!covered) kept.push(op);
  }
  return kept;
}

function renderOperation(op: BootstrapPlanOperation): string {
  switch (op.kind) {
    case 'reset_dir':
      return `RESET_DIR  ${op.targetPath}  # ${op.reason}`;
    case 'delete_dir':
      return `DELETE_DIR ${op.targetPath}  # ${op.reason}`;
    case 'delete_file':
      return `DELETE_FILE ${op.targetPath}  # ${op.reason}`;
    case 'ensure_dir':
      return `ENSURE_DIR ${op.targetPath}  # ${op.reason}`;
    case 'copy_file':
      return `COPY_FILE  ${op.sourcePath} -> ${op.targetPath}  # ${op.reason}`;
    case 'note':
      return `NOTE       ${op.message}`;
  }
}

export function renderBootstrapPlan(plan: BootstrapOperationPlan): string {
  const lines: string[] = [];
  lines.push('Bootstrap reconcile plan');
  lines.push(`  mode: ${plan.mode}`);
  lines.push(`  target: ${plan.targetDir}`);
  lines.push(`  entries: ${plan.applicableEntries.length} (${plan.applicableEntries.join(', ')})`);
  lines.push(`  postgen: ${plan.requiresGeneration ? 'yes' : 'no'}`);
  lines.push('');
  for (const op of plan.operations) {
    lines.push(`- ${renderOperation(op)}`);
  }
  return `${lines.join('\n')}\n`;
}

function applyResetDir(op: Extract<BootstrapPlanOperation, { kind: 'reset_dir' }>): void {
  fs.rmSync(op.absolutePath, { recursive: true, force: true });
  fs.mkdirSync(op.absolutePath, { recursive: true });
}

function applyDeleteDir(op: Extract<BootstrapPlanOperation, { kind: 'delete_dir' }>): void {
  fs.rmSync(op.absolutePath, { recursive: true, force: true });
}

function applyDeleteFile(op: Extract<BootstrapPlanOperation, { kind: 'delete_file' }>): void {
  fs.rmSync(op.absolutePath, { force: true });
}

function applyEnsureDir(op: Extract<BootstrapPlanOperation, { kind: 'ensure_dir' }>): void {
  fs.mkdirSync(op.absolutePath, { recursive: true });
}

function applyCopyFile(op: Extract<BootstrapPlanOperation, { kind: 'copy_file' }>): void {
  fs.mkdirSync(path.dirname(op.targetAbsolutePath), { recursive: true });
  fs.copyFileSync(op.sourceAbsolutePath, op.targetAbsolutePath);
}

export function applyBootstrapPlan(
  plan: BootstrapOperationPlan,
  options: BootstrapApplyOptions = {}
): BootstrapApplyResult {
  const dryRun = Boolean(options.dryRun);
  const resetOps = dedupeResetOps(plan.operations);
  const deleteDirOps = plan.operations.filter(
    (op): op is Extract<BootstrapPlanOperation, { kind: 'delete_dir' }> => op.kind === 'delete_dir'
  );
  const deleteFileOps = plan.operations.filter(
    (op): op is Extract<BootstrapPlanOperation, { kind: 'delete_file' }> => op.kind === 'delete_file'
  );
  const ensureOps = plan.operations.filter(
    (op): op is Extract<BootstrapPlanOperation, { kind: 'ensure_dir' }> => op.kind === 'ensure_dir'
  );
  const copyOps = plan.operations.filter(
    (op): op is Extract<BootstrapPlanOperation, { kind: 'copy_file' }> => op.kind === 'copy_file'
  );

  if (!dryRun) {
    for (const op of resetOps) applyResetDir(op);
    for (const op of deleteDirOps) applyDeleteDir(op);
    for (const op of deleteFileOps) applyDeleteFile(op);
    for (const op of ensureOps) applyEnsureDir(op);
    for (const op of copyOps) applyCopyFile(op);
  }

  return {
    dryRun,
    resetDirCount: resetOps.length,
    deleteDirCount: deleteDirOps.length,
    deleteFileCount: deleteFileOps.length,
    ensureDirCount: ensureOps.length,
    copyFileCount: copyOps.length,
  };
}
