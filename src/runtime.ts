import * as path from 'path';
import { fileURLToPath } from 'url';
import { runFridaArtifactGenerator } from './generator.ts';
import { resolveSelectors } from './selector.ts';
import { collectMigrationIssues, normalizeContractModel, validateFridaSchemaModel } from './schema.ts';
import { loadContractDocument } from './contract-path.ts';
import { ensureRuntimeConfigArtifacts, getContractReportingSettings } from './reporting-contract.ts';
import {
  APP_CONTRACT_INBOX_INDEX_REL_PATH,
  assertAppContractInboxSource,
  emitAppContractSourceMirror,
  emitCoreToolingEntrypoints,
  emitFridaContractSourceMirror,
  emitTemplatesMirror,
  ContractMirrorError,
} from './contract-mirror.ts';
import { validateFridaRootLayout } from './frida-layout.ts';
import type {
  ContractNormalizationResult,
  MigrationIssue,
  ResolvedSelectorResult,
  RunFridaCoreOptions,
  SourceSelectorSpec,
} from './types.ts';

interface LoadedContract {
  rootDir: string;
  contractPath: string;
  raw: string;
  parsed: Record<string, any>;
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_PACKAGE_ROOT = path.resolve(MODULE_DIR, '..');

function isEngineSelfRepo(rootDir: string): boolean {
  return path.resolve(rootDir) === ENGINE_PACKAGE_ROOT;
}

function loadContract(options: RunFridaCoreOptions): LoadedContract {
  const effectiveRootDir = path.resolve(options.rootDir || process.cwd());
  const appSide = !isEngineSelfRepo(effectiveRootDir);
  const effectiveContractPath = appSide
    ? (options.contractPath || APP_CONTRACT_INBOX_INDEX_REL_PATH)
    : options.contractPath;

  if (appSide) {
    const absoluteContractPath = path.resolve(effectiveRootDir, effectiveContractPath!);
    assertAppContractInboxSource(effectiveRootDir, absoluteContractPath);
  }

  return loadContractDocument(effectiveRootDir, effectiveContractPath);
}

function resolveRequiredSelectorSemantics(results: ResolvedSelectorResult[]): { warnings: string[] } {
  const warnings: string[] = [];

  for (const result of results) {
    if (result.spec.required && result.matches.length === 0) {
      throw new Error(`required selector '${result.spec.id}' returned no matches (${result.spec.selector})`);
    }
    if (!result.spec.required && result.matches.length === 0) {
      warnings.push(`optional selector '${result.spec.id}' returned no matches (${result.spec.selector})`);
    }
  }

  return { warnings };
}

function collectSelectors(normalized: ContractNormalizationResult): SourceSelectorSpec[] {
  const selectors: SourceSelectorSpec[] = [];
  const blocks = normalized.model.core?.contracticalSourceBlocks || [];

  for (const block of blocks) {
    selectors.push({
      id: `core.block.${block}`,
      selector: block,
      required: true,
      description: `Core required block: ${block}`,
    });
  }

  return selectors;
}

export async function runFridaGeneration(options: RunFridaCoreOptions = {}): Promise<void> {
  let loaded: LoadedContract;
  try {
    loaded = loadContract(options);
  } catch (error) {
    if (error instanceof ContractMirrorError) {
      throw new Error(`${error.code}: ${error.message}`);
    }
    throw error;
  }

  process.env.FRIDA_REPO_ROOT = loaded.rootDir;
  process.env.FRIDA_CONTRACT_PATH = loaded.contractPath;

  const normalized = normalizeContractModel(loaded.parsed);
  validateFridaSchemaModel(normalized.model);

  if (normalized.telemetry.deprecatedFieldCount > 0) {
    throw new Error(
      `unsupported contract fields detected: ${normalized.telemetry.deprecatedFieldCount} deprecated field(s) present`
    );
  }

  const selectors = collectSelectors(normalized);
  const sources = resolveSelectors(loaded.parsed, selectors);
  const selectorSemantics = resolveRequiredSelectorSemantics(sources.ordered);

  for (const warning of normalized.telemetry.warnings) {
    console.warn(warning);
  }
  for (const warning of selectorSemantics.warnings) {
    console.warn(warning);
  }

  await runFridaArtifactGenerator({});

  const runtimeConfigArtifacts = ensureRuntimeConfigArtifacts(loaded.rootDir, getContractReportingSettings(loaded.parsed));
  if (runtimeConfigArtifacts.createdRuntimeConfig) {
    console.log(`Runtime config created: ${path.relative(loaded.rootDir, runtimeConfigArtifacts.runtimeConfigPath)}`);
  } else {
    console.log(`Runtime config preserved: ${path.relative(loaded.rootDir, runtimeConfigArtifacts.runtimeConfigPath)}`);
  }
  console.log(`Runtime config template written: ${path.relative(loaded.rootDir, runtimeConfigArtifacts.templatePath)}`);
  for (const warning of runtimeConfigArtifacts.warnings) {
    console.warn(warning);
  }

  if (!isEngineSelfRepo(loaded.rootDir)) {
    const fridaMirrorDir = emitFridaContractSourceMirror(loaded.rootDir, ENGINE_PACKAGE_ROOT);
    console.log(`Frida contract mirror written: ${path.relative(loaded.rootDir, fridaMirrorDir)}`);
    const appMirrorDir = emitAppContractSourceMirror(loaded.rootDir);
    console.log(`App contract working copy written: ${path.relative(loaded.rootDir, appMirrorDir)}`);

    const templatesDir = emitTemplatesMirror(loaded.rootDir, ENGINE_PACKAGE_ROOT);
    console.log(`Frida templates distributed: ${path.relative(loaded.rootDir, templatesDir)}`);

    const projectedEntrypoints = emitCoreToolingEntrypoints(loaded.rootDir, loaded.parsed);
    for (const entrypointPath of projectedEntrypoints) {
      console.log(`Core tooling entrypoint written: ${path.relative(loaded.rootDir, entrypointPath)}`);
    }
  }

  validateFridaRootLayout(loaded.rootDir, 'warn');
}

function formatIssue(issue: MigrationIssue): string {
  return `${issue.severity.toUpperCase()}: ${issue.field} -> ${issue.replacement} (${issue.message})`;
}

export function runFridaMigrationReport(options: RunFridaCoreOptions = {}): number {
  const loaded = loadContract(options);
  process.env.FRIDA_REPO_ROOT = loaded.rootDir;
  process.env.FRIDA_CONTRACT_PATH = loaded.contractPath;
  const issues = collectMigrationIssues(loaded.parsed, Boolean(options.strictSchema));

  if (issues.length === 0) {
    console.log('No deprecated contract fields found.');
    return 0;
  }

  console.log('Frida migration report\n');
  for (const issue of issues) {
    console.log(`- ${formatIssue(issue)}`);
  }

  const hasError = issues.some((issue) => issue.severity === 'error');
  return hasError ? 1 : 0;
}
