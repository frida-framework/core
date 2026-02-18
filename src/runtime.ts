import * as fs from 'fs';
import * as path from 'path';
import { runLegacyFridaGenerator } from './legacy-generator.ts';
import { resolveSelectors } from './selector.ts';
import { collectMigrationIssues, normalizeCanonModel, validateFridaSchemaModel } from './schema.ts';
import { loadCanonDocument } from './canon-path.ts';
import type {
  CanonNormalizationResult,
  MigrationIssue,
  ResolvedSelectorResult,
  RunFridaCoreOptions,
  SourceSelectorSpec,
} from './types.ts';

interface LoadedCanon {
  rootDir: string;
  canonPath: string;
  raw: string;
  parsed: Record<string, any>;
}

function loadCanon(options: RunFridaCoreOptions): LoadedCanon {
  const loaded = loadCanonDocument(path.resolve(options.rootDir || process.cwd()), options.canonPath);
  return loaded;
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

function collectSelectors(normalized: CanonNormalizationResult): SourceSelectorSpec[] {
  const selectors: SourceSelectorSpec[] = [];

  for (const block of normalized.model.core.canonicalSourceBlocks) {
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
  const loaded = loadCanon(options);
  process.env.FRIDA_REPO_ROOT = loaded.rootDir;
  process.env.FRIDA_CANON_PATH = loaded.canonPath;

  const normalized = normalizeCanonModel(loaded.parsed);
  validateFridaSchemaModel(normalized.model);
  if (options.strictSchema && normalized.telemetry.deprecatedFieldCount > 0) {
    throw new Error(
      `strict schema mode failed: ${normalized.telemetry.deprecatedFieldCount} deprecated field(s) are still present`
    );
  }

  const selectors = collectSelectors(normalized);
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

  await runLegacyFridaGenerator({});
}

function formatIssue(issue: MigrationIssue): string {
  return `${issue.severity.toUpperCase()}: ${issue.field} -> ${issue.replacement} (${issue.message})`;
}

export function runFridaMigrationReport(options: RunFridaCoreOptions = {}): number {
  const loaded = loadCanon(options);
  process.env.FRIDA_REPO_ROOT = loaded.rootDir;
  process.env.FRIDA_CANON_PATH = loaded.canonPath;
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
