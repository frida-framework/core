import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runFridaGeneration } from './runtime.ts';
import { applyBootstrapPlan, renderBootstrapPlan } from './bootstrap-apply.ts';
import { detectFridaDeployment } from './bootstrap-detect.ts';
import { loadBootstrapPackageManifest, BootstrapManifestLoadError } from './bootstrap-manifest.ts';
import { buildBootstrapPlan, BootstrapPlanBuildError } from './bootstrap-plan.ts';
import { APP_CONTRACT_INBOX_INDEX_REL_PATH, assertAppContractInboxSource, ContractMirrorError } from './contract-mirror.ts';
import { validateFridaRootLayout } from './frida-layout.ts';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const BOOTSTRAP_DEMO_ASSETS_ROOT = path.resolve(REPO_ROOT, 'scaffold');

type BootstrapCliMode = 'warm' | 'cold-engine' | 'demo' | 'component' | 'help' | 'invalid';

interface BootstrapArgs {
  mode: BootstrapCliMode;
  targetDir: string | null;
  componentName: string | null;
  dryRun: boolean;
  requestedMode: string | null;
  error?: string;
}

function parseArgs(args: string[]): BootstrapArgs {
  const readFlag = (flag: string): string | null => {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) return null;
    return args[idx + 1];
  };

  if (args.includes('--help') || args.includes('-h')) {
    return {
      mode: 'help',
      targetDir: null,
      componentName: null,
      dryRun: false,
      requestedMode: null,
    };
  }

  const requestedMode = readFlag('--mode');
  const componentName = readFlag('--component');
  const targetDir = readFlag('--target');
  const dryRun = args.includes('--dry-run');

  if (componentName) {
    return {
      mode: 'component',
      targetDir: targetDir || process.cwd(),
      componentName,
      dryRun,
      requestedMode,
    };
  }

  const normalizedMode = (requestedMode || 'warm').trim().toLowerCase();
  if (normalizedMode !== 'warm' && normalizedMode !== 'cold-engine' && normalizedMode !== 'demo') {
    return {
      mode: 'invalid',
      targetDir: null,
      componentName: null,
      dryRun,
      requestedMode,
      error: `Invalid --mode value: ${requestedMode}. Expected warm|cold-engine|demo.`,
    };
  }

  if (!targetDir) {
    return {
      mode: 'invalid',
      targetDir: null,
      componentName: null,
      dryRun,
      requestedMode,
      error: 'Missing required flags: use --target <dir> (default warm) or --component <name> [--target <dir>].',
    };
  }

  return {
    mode: normalizedMode as BootstrapCliMode,
    targetDir,
    componentName: null,
    dryRun,
    requestedMode,
  };
}

function showHelp(): void {
  console.log(`frida-core bootstrap

Usage:
  frida-core bootstrap --target <dir>
  frida-core bootstrap --target <dir> --mode warm
  frida-core bootstrap --target <dir> --mode cold-engine
  frida-core bootstrap --target <dir> --mode demo
  frida-core bootstrap --component <name> [--target <dir>]
  frida-core bootstrap --dry-run --target <dir> [--mode warm|cold-engine|demo]
  frida-core bootstrap --help

Modes:
  - warm (default): reconcile Frida-managed surfaces to package reference, prune managed drift, then run generation.
  - cold-engine: explicit engine-only onboarding (no app-contract writes), then run generation.
  - demo: explicit zero-deploy-only demo/reference seed flow (demo app + demo app-contract seed), if assets are available.

Rules:
  - bootstrap is manual-only and must not be auto-invoked transitively.
  - warm/cold-engine MUST NOT modify app-contract files.
  - app-side contract source for post-generation is inbox-only: .frida/inbox/app-contract/contract.index.yaml.
  - retired path markers are detected only for one-way cleanup; bootstrap never regenerates retired surfaces.
  - demo mode is explicit-only and zero-deploy-only.
  - user-owned runtime config (.frida/config.yaml) and reports (.frida/reports/**) are preserved.
`);
}

function listYamlFilesRecursive(dirPath: string): string[] {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return [];
  }

  const result: string[] = [];
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
        result.push(absolute);
      }
    }
  }

  result.sort();
  return result;
}

function findExistingContractFiles(targetDir: string): string[] {
  const contractDir = path.join(targetDir, 'contract');
  return listYamlFilesRecursive(contractDir).map((absolute) => path.relative(targetDir, absolute));
}

function printBootstrapFailure(code: string, lines: string[] = []): number {
  console.error(`bootstrap failed: ${code}`);
  for (const line of lines) {
    console.error(`  ${line}`);
  }
  return 1;
}

function unsupportedContractHints(targetDir: string): string[] {
  const hints: string[] = [];
  const retiredRootContract = path.join(targetDir, 'contract', 'contract.cbmd.yaml');
  const retiredInboxContract = path.join(targetDir, '.frida', 'inbox', 'app-contract', 'contract.cbmd.yaml');

  if (fs.existsSync(retiredRootContract)) {
    hints.push(`unsupported assembled contract file present: ${path.relative(targetDir, retiredRootContract)}`);
  }
  if (fs.existsSync(retiredInboxContract)) {
    hints.push(`unsupported assembled inbox contract file present: ${path.relative(targetDir, retiredInboxContract)}`);
  }

  return hints;
}

function ensureCanonicalAppContractInboxOrFail(targetDir: string): number | null {
  try {
    assertAppContractInboxSource(targetDir);
    return null;
  } catch (error) {
    if (error instanceof ContractMirrorError) {
      const details = [
        `target=${targetDir}`,
        `required canonical app contract: ${APP_CONTRACT_INBOX_INDEX_REL_PATH}`,
        error.message,
        ...unsupportedContractHints(targetDir),
      ];
      details.push('Assembled snapshot contracts are not supported for bootstrap input. Migrate to the canonical inbox index first.');
      return printBootstrapFailure(error.code, details);
    }
    throw error;
  }
}

function printDetectionSummary(targetDir: string): void {
  const detection = detectFridaDeployment(targetDir);
  console.log(`Frida markers in target (${targetDir}): ${detection.markerCount}`);
  console.log(`  runtime config template: ${detection.markers.runtimeConfigTemplate ? 'yes' : 'no'}`);
  console.log(`  router (.frida/contract): ${detection.markers.contractSpecsRouter ? 'yes' : 'no'}`);
  console.log(`  router cleanup marker (.frida/specs): ${detection.markers.retiredFridaSpecsRouter ? 'yes' : 'no'}`);
  console.log(`  router cleanup marker (.specs): ${detection.markers.retiredSpecsRouter ? 'yes' : 'no'}`);
  console.log(`  profiles (.frida/contract): ${detection.markers.contractProfilesDir ? 'yes' : 'no'}`);
  console.log(`  profiles cleanup marker (.frida/profiles): ${detection.markers.retiredFridaProfilesDir ? 'yes' : 'no'}`);
  console.log(`  profiles cleanup marker (.specs/profiles): ${detection.markers.retiredSpecsProfilesDir ? 'yes' : 'no'}`);
  console.log(`  bootloader AGENTS.md: ${detection.markers.bootloaderAgents ? 'yes' : 'no'}`);
  console.log(`  bootloader .frida/contract/AGENTS.md: ${detection.markers.fridaContractBootloaderAgents ? 'yes' : 'no'}`);
  console.log(`  zone AGENTS.md (.frida): ${detection.markers.fridaManagedZoneAgents ? 'yes' : 'no'}`);
}

function ensureDemoAssetsOrFail(): { ok: true } | { ok: false; code: number } {
  if (fs.existsSync(BOOTSTRAP_DEMO_ASSETS_ROOT) && fs.statSync(BOOTSTRAP_DEMO_ASSETS_ROOT).isDirectory()) {
    return { ok: true };
  }

  return {
    ok: false,
    code: printBootstrapFailure('BOOTSTRAP_ASSETS_MISSING', [
      `expected assets root: ${BOOTSTRAP_DEMO_ASSETS_ROOT}`,
      'Demo bootstrap assets are not present in this package build.',
    ]),
  };
}

async function runPostGeneration(targetDir: string): Promise<number> {
  try {
    await runFridaGeneration({
      rootDir: targetDir,
      contractPath: APP_CONTRACT_INBOX_INDEX_REL_PATH,
    });

    const loadedManifest = loadBootstrapPackageManifest(REPO_ROOT);
    const cleanupPlan = buildBootstrapPlan({
      packageRoot: loadedManifest.packageRoot,
      targetDir,
      manifest: loadedManifest.manifest,
      mode: 'warm',
    });
    const cleanupOps = cleanupPlan.operations.filter((op) => op.kind === 'delete_dir' || op.kind === 'delete_file');
    if (cleanupOps.length > 0) {
      const cleanupResult = applyBootstrapPlan(
        {
          ...cleanupPlan,
          operations: cleanupOps,
          requiresGeneration: false,
        },
        { dryRun: false }
      );
      console.log(
        `bootstrap post-gen cleanup completed: delete_dir=${cleanupResult.deleteDirCount}, delete_file=${cleanupResult.deleteFileCount}`
      );
    }

    validateFridaRootLayout(targetDir, 'fail');
    return 0;
  } catch (error) {
    return printBootstrapFailure('BOOTSTRAP_POSTGEN_FAILED', [
      `target=${targetDir}`,
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

async function runReconcileMode(
  mode: 'warm' | 'cold-engine',
  targetDir: string,
  dryRun: boolean
): Promise<number> {
  const absoluteTarget = path.resolve(process.cwd(), targetDir);
  const detection = detectFridaDeployment(absoluteTarget);

  const contractInboxCheck = ensureCanonicalAppContractInboxOrFail(absoluteTarget);
  if (contractInboxCheck !== null) {
    return contractInboxCheck;
  }

  if (mode === 'warm' && !detection.present) {
    return printBootstrapFailure('FRIDA_NOT_DEPLOYED', [
      `target=${absoluteTarget}`,
      'Default bootstrap is warm-first and requires existing Frida markers.',
      'Use --mode cold-engine for explicit first-time Frida engine onboarding, or --mode demo for demo/reference seeding.',
    ]);
  }

  if (mode === 'cold-engine' && detection.present) {
    return printBootstrapFailure('FRIDA_ALREADY_DEPLOYED', [
      `target=${absoluteTarget}`,
      'Frida markers are already present. Use warm mode (default) for reconcile/repair.',
    ]);
  }

  let loadedManifest;
  try {
    loadedManifest = loadBootstrapPackageManifest(REPO_ROOT);
  } catch (error) {
    if (error instanceof BootstrapManifestLoadError) {
      return printBootstrapFailure(error.code, [error.message]);
    }
    return printBootstrapFailure('BOOTSTRAP_PACKAGE_MANIFEST_INVALID', [
      error instanceof Error ? error.message : String(error),
    ]);
  }

  let plan;
  try {
    plan = buildBootstrapPlan({
      packageRoot: loadedManifest.packageRoot,
      targetDir: absoluteTarget,
      manifest: loadedManifest.manifest,
      mode,
    });
  } catch (error) {
    if (error instanceof BootstrapPlanBuildError) {
      return printBootstrapFailure(error.code, [error.message]);
    }
    return printBootstrapFailure('BOOTSTRAP_RECONCILE_PLAN_CONFLICT', [
      error instanceof Error ? error.message : String(error),
    ]);
  }

  printDetectionSummary(absoluteTarget);
  console.log(renderBootstrapPlan(plan));
  const applyResult = applyBootstrapPlan(plan, { dryRun });
  console.log(
    `bootstrap ${dryRun ? 'dry-run' : 'apply'} plan completed: reset=${applyResult.resetDirCount}, delete_dir=${applyResult.deleteDirCount}, delete_file=${applyResult.deleteFileCount}, ensure=${applyResult.ensureDirCount}, copy=${applyResult.copyFileCount}`
  );

  if (dryRun || !plan.requiresGeneration) {
    return 0;
  }

  return runPostGeneration(absoluteTarget);
}

async function runComponentMode(componentName: string, targetDir: string, dryRun: boolean): Promise<number> {
  const absoluteTarget = path.resolve(process.cwd(), targetDir);
  const detection = detectFridaDeployment(absoluteTarget);
  if (!detection.present) {
    return printBootstrapFailure('FRIDA_NOT_DEPLOYED', [
      `target=${absoluteTarget}`,
      'Component reconcile requires an existing Frida deployment.',
    ]);
  }

  const contractInboxCheck = ensureCanonicalAppContractInboxOrFail(absoluteTarget);
  if (contractInboxCheck !== null) {
    return contractInboxCheck;
  }

  let loadedManifest;
  try {
    loadedManifest = loadBootstrapPackageManifest(REPO_ROOT);
  } catch (error) {
    if (error instanceof BootstrapManifestLoadError) {
      return printBootstrapFailure(error.code, [error.message]);
    }
    return printBootstrapFailure('BOOTSTRAP_PACKAGE_MANIFEST_INVALID', [
      error instanceof Error ? error.message : String(error),
    ]);
  }

  let plan;
  try {
    plan = buildBootstrapPlan({
      packageRoot: loadedManifest.packageRoot,
      targetDir: absoluteTarget,
      manifest: loadedManifest.manifest,
      mode: 'warm',
      componentName,
    });
  } catch (error) {
    if (error instanceof BootstrapPlanBuildError) {
      return printBootstrapFailure(error.code, [error.message]);
    }
    return printBootstrapFailure('BOOTSTRAP_RECONCILE_PLAN_CONFLICT', [
      error instanceof Error ? error.message : String(error),
    ]);
  }

  printDetectionSummary(absoluteTarget);
  console.log(renderBootstrapPlan(plan));
  const applyResult = applyBootstrapPlan(plan, { dryRun });
  console.log(
    `bootstrap component ${dryRun ? 'dry-run' : 'apply'} completed: component=${componentName}, reset=${applyResult.resetDirCount}, delete_dir=${applyResult.deleteDirCount}, delete_file=${applyResult.deleteFileCount}, ensure=${applyResult.ensureDirCount}, copy=${applyResult.copyFileCount}`
  );

  if (dryRun || !plan.requiresGeneration) {
    return 0;
  }

  return runPostGeneration(absoluteTarget);
}

function runDemoMode(targetDir: string, dryRun: boolean): number {
  const absoluteTarget = path.resolve(process.cwd(), targetDir);
  const detection = detectFridaDeployment(absoluteTarget);
  const existingContracts = findExistingContractFiles(absoluteTarget);

  if (detection.present || existingContracts.length > 0) {
    const details: string[] = [`target=${absoluteTarget}`];
    if (detection.present) {
      details.push(`frida_markers=${detection.markerCount}`);
    }
    if (existingContracts.length > 0) {
      details.push(`existing_contract=${existingContracts[0]}`);
      if (existingContracts.length > 1) {
        details.push(`more_contract_files=${existingContracts.length - 1}`);
      }
    }
    details.push('Demo bootstrap is explicit-only and zero-deploy-only.');
    return printBootstrapFailure('DEMO_MODE_ZERO_DEPLOY_REQUIRED', details);
  }

  const assetsCheck = ensureDemoAssetsOrFail();
  if (!assetsCheck.ok) return assetsCheck.code;

  if (dryRun) {
    return printBootstrapFailure('BOOTSTRAP_NOT_IMPLEMENTED', [
      `target=${absoluteTarget}`,
      'Demo bootstrap dry-run is not implemented yet because demo deploy mapping is not implemented.',
    ]);
  }

  return printBootstrapFailure('BOOTSTRAP_NOT_IMPLEMENTED', [
    `target=${absoluteTarget}`,
    'Demo bootstrap semantics are declared, but demo deploy mapping is not implemented yet.',
    'Implement demo asset deployment and demo app-contract seed flow in src/bootstrap.ts.',
  ]);
}

export async function runFridaBootstrapCli(args: string[] = []): Promise<number> {
  try {
    const parsed = parseArgs(args);

    if (parsed.mode === 'help') {
      showHelp();
      return 0;
    }

    if (parsed.mode === 'invalid') {
      console.error(`bootstrap failed: ${parsed.error || 'invalid arguments'}`);
      showHelp();
      return 2;
    }

    if (parsed.mode === 'component') {
      return runComponentMode(parsed.componentName!, parsed.targetDir!, parsed.dryRun);
    }

    if (parsed.mode === 'demo') {
      return runDemoMode(parsed.targetDir!, parsed.dryRun);
    }

    return runReconcileMode(parsed.mode, parsed.targetDir!, parsed.dryRun);
  } catch (error) {
    console.error(`bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
