import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { loadContractDocument } from './contract-path.ts';
import { FRIDA_CLI_NAME } from './identity.ts';

interface VisualizerModuleConfig {
  enabled: boolean;
  moduleRootDir: string | null;
  moduleRootAbs: string | null;
  moduleDistAbs: string | null;
}

const VISUAL_VIEWER_COMMAND = `${FRIDA_CLI_NAME} visual-viewer`;
const VISUALIZER_COMMAND = `${FRIDA_CLI_NAME} visualizer`;

const LEGAL_APP_CONTRACT_ROOT = '.frida/inbox/app-contract/contract.index.yaml';
const FRIDA_PACKAGE_NAME = '@sistemado/frida';

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolvePathRef(paths: Record<string, unknown> | undefined, ref: string | null): string | null {
  if (!isObjectLike(paths) || typeof ref !== 'string' || !ref.trim()) {
    return null;
  }

  const parts = ref.split('.');
  if (parts[0] !== 'PATHS') {
    return null;
  }

  let cursor: Record<string, unknown> | unknown = { PATHS: paths };
  for (const part of parts) {
    if (!isObjectLike(cursor) || !(part in cursor)) {
      return null;
    }
    cursor = cursor[part];
  }

  return typeof cursor === 'string' && cursor.trim() ? cursor : null;
}

function loadVisualizerModuleConfig(): VisualizerModuleConfig {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const loaded = loadContractDocument(packageRoot, 'contract/contract.index.yaml');
  const referenceViewer = isObjectLike(loaded.parsed?.FRIDA_VISUAL?.reference_viewer)
    ? loaded.parsed.FRIDA_VISUAL.reference_viewer
    : null;
  const moduleRootDirRef = referenceViewer && typeof referenceViewer.module_rootDirRef === 'string'
    ? referenceViewer.module_rootDirRef
    : null;
  const moduleRootDir = resolvePathRef(
    isObjectLike(loaded.parsed?.PATHS) ? (loaded.parsed.PATHS as Record<string, unknown>) : undefined,
    moduleRootDirRef,
  );
  const moduleRootAbs = moduleRootDir ? path.join(packageRoot, moduleRootDir) : null;

  return {
    enabled: Boolean(moduleRootDir),
    moduleRootDir,
    moduleRootAbs,
    moduleDistAbs: moduleRootAbs ? path.join(moduleRootAbs, 'dist') : null,
  };
}

// ---------------------------------------------------------------------------
// Legality gate
// ---------------------------------------------------------------------------

interface LegalityResult {
  legal: boolean;
  reason: string;
}

function isFridaRepo(cwd: string): boolean {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return false;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg?.name === FRIDA_PACKAGE_NAME;
  } catch {
    return false;
  }
}

function checkVisualizerLegality(cwd: string): LegalityResult {
  // Gate 1: Frida repo is never a legal execution context
  if (isFridaRepo(cwd)) {
    return {
      legal: false,
      reason: `The Frida core package repository (${FRIDA_PACKAGE_NAME}) is not a legal visualizer execution environment.\nThe visualizer may only run inside a target application repository with a legal app contract.`,
    };
  }

  // Gate 2: Legal app contract root must exist
  const appContractPath = path.join(cwd, LEGAL_APP_CONTRACT_ROOT);
  if (!fs.existsSync(appContractPath)) {
    return {
      legal: false,
      reason: `Missing legal app contract root: ${LEGAL_APP_CONTRACT_ROOT}\nThe visualizer requires a seeded app contract. Run zero-start bootstrap first:\n  ${FRIDA_CLI_NAME} bootstrap --target . --mode zero-start`,
    };
  }

  // Gate 3: Reject template_app_basic contracts
  try {
    const content = fs.readFileSync(appContractPath, 'utf8');
    if (content.includes('template_app_basic')) {
      return {
        legal: false,
        reason: `The app contract at ${LEGAL_APP_CONTRACT_ROOT} appears to be a raw template_app_basic contract.\nReplace template placeholders with real application contract content before running the visualizer.`,
      };
    }
  } catch {
    return {
      legal: false,
      reason: `Cannot read app contract at ${LEGAL_APP_CONTRACT_ROOT}.`,
    };
  }

  // Gate 4: Reject fixture/demo overlay references
  const fixtureOverlayDir = path.join(cwd, 'templates', 'tooling', 'verify', 'fixtures', 'visual-overlay');
  if (fs.existsSync(fixtureOverlayDir)) {
    return {
      legal: false,
      reason: `Illegal fixture overlay directory detected: templates/tooling/verify/fixtures/visual-overlay/\nVisualization must use real app-contract inputs, not fixtures or demos.`,
    };
  }

  return { legal: true, reason: '' };
}

// ---------------------------------------------------------------------------
// Target-repo visualizer build
// ---------------------------------------------------------------------------

async function buildVisualizerInTargetRepo(cwd: string, _args: string[]): Promise<number> {
  const config = loadVisualizerModuleConfig();
  if (!config.enabled || !config.moduleRootAbs || !config.moduleDistAbs || !fs.existsSync(config.moduleRootAbs)) {
    console.error(`❌ ${VISUALIZER_COMMAND} failed: VISUALIZER_MODULE_DISABLED`);
    console.error('   The visualizer module is not enabled in the Frida package contract.');
    return 1;
  }

  const entryFile = path.join(config.moduleDistAbs, 'visual-reference-viewer.js');
  if (!fs.existsSync(entryFile)) {
    console.error(
      `❌ ${VISUALIZER_COMMAND} failed: VISUALIZER_MODULE_BUILD_MISSING (${path.relative(process.cwd(), entryFile)})`
    );
    return 1;
  }

  // Resolve overlay path — canonical location in the target repo
  const overlayPath = path.join(cwd, '.frida', 'contract', 'visual', 'canon-overlay.json');
  const outputDir = path.join(cwd, 'dist', 'visualizer');
  const outputFile = path.join(outputDir, 'index.html');

  // Build args for the viewer generator
  const viewerArgs: string[] = [];
  if (fs.existsSync(overlayPath)) {
    viewerArgs.push('--overlay', overlayPath);
  } else {
    // Fall back to contract-based generation
    const contractPath = path.join(cwd, LEGAL_APP_CONTRACT_ROOT);
    viewerArgs.push('--contract', contractPath);
  }
  viewerArgs.push('--out', outputFile);
  viewerArgs.push('--title', 'Application Architecture');

  try {
    const runtime = await import(pathToFileURL(entryFile).href);
    if (typeof runtime.runFridaVisualViewerCli !== 'function') {
      console.error(`❌ ${VISUALIZER_COMMAND} failed: VISUALIZER_MODULE_INVALID`);
      return 1;
    }
    const code = await runtime.runFridaVisualViewerCli(viewerArgs);
    if (code === 0) {
      console.log(`\n✅ Visualizer built: ${path.relative(cwd, outputFile)}`);
    }
    return code;
  } catch (error) {
    console.error(`❌ ${VISUALIZER_COMMAND} failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Canonical visualizer CLI entry point (target-repo only)
// ---------------------------------------------------------------------------

export async function runFridaVisualizerCli(args: string[] = []): Promise<number> {
  const cwd = process.cwd();
  const legality = checkVisualizerLegality(cwd);

  if (!legality.legal) {
    console.error(`❌ ${VISUALIZER_COMMAND} rejected: ILLEGAL_EXECUTION_CONTEXT`);
    console.error(`\n${legality.reason}`);
    return 1;
  }

  return buildVisualizerInTargetRepo(cwd, args);
}

// ---------------------------------------------------------------------------
// Legacy visual-viewer CLI (deprecated, routes through legality gate)
// ---------------------------------------------------------------------------

export async function runFridaVisualViewerCli(args: string[] = []): Promise<number> {
  console.warn(`⚠️  DEPRECATED: '${VISUAL_VIEWER_COMMAND}' is deprecated. Use '${VISUALIZER_COMMAND}' instead.`);
  console.warn(`   The visualizer is now a target-repo-only command.\n`);

  // Route through the same legality gate
  return runFridaVisualizerCli(args);
}
