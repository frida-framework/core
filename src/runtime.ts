import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { runLegacyFridaGenerator } from './legacy-generator.ts';
import { InMemoryAdapterGeneratorRegistry } from './generator-registry.ts';
import { resolveSelectors } from './selector.ts';
import { collectMigrationIssues, normalizeCanonModel, validateFridaSchemaModel } from './schema.ts';
import type {
  CanonNormalizationResult,
  FridaAdapter,
  FridaExtensionSpec,
  MigrationIssue,
  ResolvedSelectorResult,
  RunFridaCoreOptions,
  SourceSelectorSpec,
} from './types.ts';

const DEFAULT_CANON_PATH = 'contract/canon.cbmd.yaml';

interface LoadedCanon {
  rootDir: string;
  canonPath: string;
  raw: string;
  parsed: Record<string, any>;
}

function loadCanon(options: RunFridaCoreOptions): LoadedCanon {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const canonPath = path.resolve(rootDir, options.canonPath || DEFAULT_CANON_PATH);
  const raw = fs.readFileSync(canonPath, 'utf-8');
  const parsed = yaml.parse(raw);

  return {
    rootDir,
    canonPath,
    raw,
    parsed,
  };
}

function resolveRequiredSelectorSemantics(results: ResolvedSelectorResult[]): { warnings: string[]; } {
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

function resolveExtensionSelectors(extensions: FridaExtensionSpec[]): SourceSelectorSpec[] {
  const selectors: SourceSelectorSpec[] = [];
  for (const extension of extensions) {
    for (const selector of extension.sourceSelectors || []) {
      selectors.push({
        id: `${extension.id}.${selector.id}`,
        selector: selector.selector,
        required: selector.required ?? false,
        description: selector.description,
      });
    }
  }
  return selectors;
}

function emitGeneratedAdapterManifest(
  rootDir: string,
  normalized: CanonNormalizationResult,
  adapters: FridaAdapter[],
): void {
  const outputPath = path.join(rootDir, '.frida', 'frida.adapter.generated.json');
  const payload = {
    generatedAt: new Date().toISOString(),
    extensions: normalized.model.extensions || [],
    adapters: adapters.map((adapter) => ({
      id: adapter.id,
      schemaRef: adapter.schemaRef || null,
    })),
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function collectSelectors(normalized: CanonNormalizationResult, adapters: FridaAdapter[]): SourceSelectorSpec[] {
  const selectors: SourceSelectorSpec[] = [];

  for (const block of normalized.model.core.canonicalSourceBlocks) {
    selectors.push({
      id: `core.block.${block}`,
      selector: block,
      required: true,
      description: `Core required block: ${block}`,
    });
  }

  selectors.push(...resolveExtensionSelectors(normalized.model.extensions || []));

  for (const adapter of adapters) {
    const adapterSelectors = adapter.registerSelectors?.() || [];
    selectors.push(...adapterSelectors);
  }

  return selectors;
}

function summarizeAdapterOutputs(registryOutputs: string[]): { policyDocs: number; referenceDocs: number } {
  let policyDocs = 0;
  let referenceDocs = 0;

  for (const output of registryOutputs) {
    if (output.includes('docs/policy/')) {
      policyDocs += 1;
      continue;
    }
    if (output.includes('docs/reference/')) {
      referenceDocs += 1;
    }
  }

  return { policyDocs, referenceDocs };
}

export async function runFridaGeneration(options: RunFridaCoreOptions = {}): Promise<void> {
  const loaded = loadCanon(options);
  process.env.FRIDA_REPO_ROOT = loaded.rootDir;

  const adapters: FridaAdapter[] = [...(options.adapters || [])];
  const normalized = normalizeCanonModel(loaded.parsed);
  validateFridaSchemaModel(normalized.model);
  if (options.strictSchema && normalized.telemetry.deprecatedFieldCount > 0) {
    throw new Error(
      `strict schema mode failed: ${normalized.telemetry.deprecatedFieldCount} deprecated field(s) are still present`
    );
  }

  emitGeneratedAdapterManifest(loaded.rootDir, normalized, adapters);

  const selectors = collectSelectors(normalized, adapters);
  const sources = resolveSelectors(loaded.parsed, selectors);
  const selectorSemantics = resolveRequiredSelectorSemantics(sources.ordered);

  for (const warning of normalized.telemetry.warnings) {
    console.warn(`⚠️  ${warning}`);
  }
  if (normalized.telemetry.deprecatedFieldCount > 0) {
    console.warn(
      `⚠️  Legacy compatibility telemetry: ${normalized.telemetry.deprecatedFieldCount} deprecated field(s) detected`
    );
  }
  for (const warning of selectorSemantics.warnings) {
    console.warn(`⚠️  ${warning}`);
  }

  const adapterRegistry = new InMemoryAdapterGeneratorRegistry();
  for (const adapter of adapters) {
    adapter.registerGenerators(adapterRegistry);
  }

  const registeredGenerators = adapterRegistry.list();
  const adapterOutputs = registeredGenerators.flatMap((generator) => generator.outputs || []);
  const outputSummary = summarizeAdapterOutputs(adapterOutputs);
  const hasExtensionGenerators = registeredGenerators.length > 0;

  await runLegacyFridaGenerator({
    adapter: hasExtensionGenerators
      ? {
        generate: async (context) => {
          await adapterRegistry.runAll(context);
          return {
            policyDocs: outputSummary.policyDocs,
            referenceDocs: outputSummary.referenceDocs,
          };
        },
      }
      : undefined,
  });
}

function formatIssue(issue: MigrationIssue): string {
  return `${issue.severity.toUpperCase()}: ${issue.field} -> ${issue.replacement} (${issue.message})`;
}

export function runFridaMigrationReport(options: RunFridaCoreOptions = {}): number {
  const loaded = loadCanon(options);
  const issues = collectMigrationIssues(loaded.parsed, Boolean(options.strictSchema));

  if (issues.length === 0) {
    console.log('✅ No deprecated canon fields found.');
    return 0;
  }

  console.log('📋 Frida migration report\n');
  for (const issue of issues) {
    console.log(`- ${formatIssue(issue)}`);
  }

  const hasError = issues.some((issue) => issue.severity === 'error');
  return hasError ? 1 : 0;
}
