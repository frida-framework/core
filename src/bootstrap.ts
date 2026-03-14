import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runFridaGeneration } from './runtime.ts';
import { applyBootstrapPlan, renderBootstrapPlan } from './bootstrap-apply.ts';
import { detectFridaDeployment } from './bootstrap-detect.ts';
import {
  BootstrapManifestLoadError,
  getManifestEntryTargetOrThrow,
  loadBootstrapPackageManifest,
} from './bootstrap-manifest.ts';
import { buildBootstrapPlan, BootstrapPlanBuildError } from './bootstrap-plan.ts';
import { APP_CONTRACT_INBOX_INDEX_REL_PATH, assertAppContractInboxSource, ContractMirrorError } from './contract-mirror.ts';
import { validateFridaRootLayout } from './frida-layout.ts';
import { FRIDA_CLI_NAME } from './identity.ts';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const BOOTSTRAP_APP_TEMPLATE_ROOT = path.resolve(REPO_ROOT, 'templates', 'template_app_basic');
const ZERO_START_GENERATED_AT = '1970-01-01T00:00:00.000Z';

type BootstrapCliMode = 'warm' | 'cold-engine' | 'demo' | 'zero-start' | 'component' | 'help' | 'invalid';

interface BootstrapArgs {
  mode: BootstrapCliMode;
  targetDir: string | null;
  componentName: string | null;
  dryRun: boolean;
  requestedMode: string | null;
  error?: string;
}

interface PackageDescriptor {
  name: string;
  version: string;
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
  if (
    normalizedMode !== 'warm' &&
    normalizedMode !== 'cold-engine' &&
    normalizedMode !== 'demo' &&
    normalizedMode !== 'zero-start'
  ) {
    return {
      mode: 'invalid',
      targetDir: null,
      componentName: null,
      dryRun,
      requestedMode,
      error: `Invalid --mode value: ${requestedMode}. Expected warm|cold-engine|demo|zero-start.`,
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
  console.log(`${FRIDA_CLI_NAME} bootstrap

Usage:
  ${FRIDA_CLI_NAME} bootstrap --target <dir>
  ${FRIDA_CLI_NAME} bootstrap --target <dir> --mode warm
  ${FRIDA_CLI_NAME} bootstrap --target <dir> --mode cold-engine
  ${FRIDA_CLI_NAME} bootstrap --target <dir> --mode demo
  ${FRIDA_CLI_NAME} bootstrap --target <dir> --mode zero-start
  ${FRIDA_CLI_NAME} bootstrap --component <name> [--target <dir>]
  ${FRIDA_CLI_NAME} bootstrap --component interface-instructions-reset --target <dir>
  ${FRIDA_CLI_NAME} bootstrap --dry-run --target <dir> [--mode warm|cold-engine|demo|zero-start]
  ${FRIDA_CLI_NAME} bootstrap --help

Modes:
  - warm (default): reconcile Frida-managed surfaces to package reference, prune managed drift, then run generation.
  - cold-engine: explicit engine-only onboarding (no app-contract writes), then run generation.
  - demo: explicit zero-deploy-only demo/reference seed flow (demo app + demo app-contract seed), if assets are available.
  - zero-start: first-time onboarding for a clean repository. Deploys FRIDA infrastructure and seeds template_app_basic
    (README.md, package.json, baseline app-contract layers, and inactive extension layers) under .frida/inbox/app-contract/,
    then runs generation.
    Fails with ZERO_START_ALREADY_DEPLOYED if Frida is already deployed; use warm mode for subsequent reconcile.

Rules:
  - bootstrap is manual-only and must not be auto-invoked transitively.
  - warm/cold-engine MUST NOT modify app-contract files.
  - app-side contract source for post-generation is inbox-only: .frida/inbox/app-contract/contract.index.yaml.
  - retired path markers are detected only for one-way cleanup; bootstrap never regenerates retired surfaces.
  - demo mode is explicit-only and zero-deploy-only.
  - user-owned runtime config (.frida/config.yaml) and reports (.frida/reports/**) are preserved.
  - component=interface-instructions-reset force-restores the packaged baseline for .frida/contract/playbooks/AGENT-app-contract-*.md only.
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

function ensureAppTemplateAssetsOrFail(): { ok: true } | { ok: false; code: number } {
  if (fs.existsSync(BOOTSTRAP_APP_TEMPLATE_ROOT) && fs.statSync(BOOTSTRAP_APP_TEMPLATE_ROOT).isDirectory()) {
    return { ok: true };
  }

  return {
    ok: false,
    code: printBootstrapFailure('BOOTSTRAP_ASSETS_MISSING', [
      `expected app-template root: ${BOOTSTRAP_APP_TEMPLATE_ROOT}`,
      'Zero-start app-template assets are not present in this package build.',
    ]),
  };
}

function readCurrentCorePackageDescriptor(): PackageDescriptor {
  const packageJsonPath = path.join(REPO_ROOT, 'package.json');
  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as Partial<PackageDescriptor>;
  if (!parsed.name || !parsed.version) {
    throw new Error(`invalid core package metadata: ${packageJsonPath}`);
  }
  return {
    name: parsed.name,
    version: parsed.version,
  };
}

function rewriteZeroStartSeedPackageReference(targetDir: string): void {
  const packageJsonPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(packageJsonPath) || !fs.statSync(packageJsonPath).isFile()) {
    return;
  }

  const packageDescriptor = readCurrentCorePackageDescriptor();
  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as Record<string, any>;
  const devDependencies = parsed.devDependencies && typeof parsed.devDependencies === 'object'
    ? parsed.devDependencies
    : {};

  devDependencies[packageDescriptor.name] = `^${packageDescriptor.version}`;
  parsed.devDependencies = Object.fromEntries(
    Object.entries(devDependencies).sort(([left], [right]) => left.localeCompare(right))
  );

  fs.writeFileSync(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
}

async function runPostGeneration(targetDir: string, generatedAtOverride?: string): Promise<number> {
  try {
    const previousGeneratedAt = process.env.FRIDA_GENERATED_AT;
    try {
      if (generatedAtOverride) {
        process.env.FRIDA_GENERATED_AT = generatedAtOverride;
      }

      await runFridaGeneration({
        rootDir: targetDir,
        contractPath: APP_CONTRACT_INBOX_INDEX_REL_PATH,
      });
    } finally {
      if (generatedAtOverride) {
        if (previousGeneratedAt === undefined) {
          delete process.env.FRIDA_GENERATED_AT;
        } else {
          process.env.FRIDA_GENERATED_AT = previousGeneratedAt;
        }
      }
    }

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

async function runZeroStartMode(targetDir: string, dryRun: boolean): Promise<number> {
  const absoluteTarget = path.resolve(process.cwd(), targetDir);

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

  const detection = detectFridaDeployment(absoluteTarget);
  const appContractDir = path.join(
    absoluteTarget,
    getManifestEntryTargetOrThrow(loadedManifest.manifest, 'frida_inbox_app_contract')
  );

  if (detection.present || fs.existsSync(appContractDir)) {
    const details: string[] = [`target=${absoluteTarget}`];
    if (detection.present) {
      details.push(`frida_markers=${detection.markerCount}`);
    } else {
      details.push('zero-start marker: .frida/inbox/app-contract already exists');
    }
    details.push('Frida is already deployed in this repository. Use warm mode (default) for reconcile/repair.');
    return printBootstrapFailure('ZERO_START_ALREADY_DEPLOYED', details);
  }

  let plan;
  try {
    plan = buildBootstrapPlan({
      packageRoot: loadedManifest.packageRoot,
      targetDir: absoluteTarget,
      manifest: loadedManifest.manifest,
      mode: 'zero-start',
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
    `bootstrap zero-start ${dryRun ? 'dry-run' : 'apply'} completed: reset=${applyResult.resetDirCount}, delete_dir=${applyResult.deleteDirCount}, delete_file=${applyResult.deleteFileCount}, ensure=${applyResult.ensureDirCount}, copy=${applyResult.copyFileCount}, seed=${applyResult.seedFileCount}`
  );

  if (!dryRun) {
    rewriteZeroStartSeedPackageReference(absoluteTarget);
    const postGenCode = await runPostGeneration(absoluteTarget, ZERO_START_GENERATED_AT);
    if (postGenCode !== 0) {
      return postGenCode;
    }

    console.log(`
Bootstrap zero-start complete.

FRIDA infrastructure has been deployed to ${absoluteTarget}.
Seeded derivative baseline from template_app_basic: README.md, package.json, .frida/inbox/app-contract/contract.index.yaml, .frida/inbox/app-contract/layers/*, .frida/inbox/app-contract/extensions/*

Next steps:
  1. Install FRIDA package in the new repository:
       cd ${absoluteTarget} && npm install
  2. Verify the seeded repository:
       cd ${absoluteTarget} && npm run frida:check
  3. Review README.md and .frida/inbox/app-contract/ for the seeded baseline app-contract surface.
  4. Edit the seeded app-contract files — keep AL03-host-root as the baseline anchor, replace placeholder values, and expand layers as the repo grows.
  5. For subsequent reconcile/repair:
       npm run frida:bootstrap
`);
  }

  return 0;
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

  const assetsCheck = ensureAppTemplateAssetsOrFail();
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

    if (parsed.mode === 'zero-start') {
      return runZeroStartMode(parsed.targetDir!, parsed.dryRun);
    }

    return runReconcileMode(parsed.mode, parsed.targetDir!, parsed.dryRun);
  } catch (error) {
    console.error(`bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
