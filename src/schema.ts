import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ContractNormalizationResult, FridaContractSchema, GenerationTelemetry, MigrationIssue } from './types.ts';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(MODULE_DIR, '../schemas/frida-contract.schema.json');

function readSchema(schemaPath = SCHEMA_PATH): Record<string, unknown> {
  const raw = fs.readFileSync(schemaPath, 'utf-8');
  return JSON.parse(raw);
}

export function validateFridaSchemaModel(model: FridaContractSchema, schemaPath = SCHEMA_PATH): void {
  const AjvCtor: any = (Ajv2020 as any).default || Ajv2020;
  const addFormatsFn: any = (addFormats as any).default || addFormats;
  const ajv = new AjvCtor({ allErrors: true, strict: false });
  addFormatsFn(ajv);
  const validate = ajv.compile(readSchema(schemaPath));

  if (!validate(model)) {
    const message = (validate.errors || [])
      .map((error: any) => `${error.instancePath || '/'} ${error.message || 'invalid'}`)
      .join('; ');
    throw new Error(`frida-contract schema validation failed: ${message}`);
  }
}

function buildTelemetry(warnings: string[], deprecatedFields: string[]): GenerationTelemetry {
  return {
    deprecatedFieldCount: deprecatedFields.length,
    deprecatedFields,
    warnings,
  };
}

const LEGACY_PATH_FIELDS: Array<{ field: string; ref: string }> = [
  { field: 'agents_bootloader', ref: 'agents_bootloaderFileRef' },
  { field: 'specs_root', ref: 'specs_rootRef' },
  { field: 'profiles_root', ref: 'profiles_rootRef' },
  { field: 'docs_policy', ref: 'docs_policyDirRef' },
  { field: 'docs_reference', ref: 'docs_referenceDirRef' },
  { field: 'frida_internal', ref: 'frida_internalRef' },
  { field: 'templates_frida', ref: 'templates_fridaRef' },
  { field: 'templates_docs', ref: 'templates_docsRef' },
];

export function normalizeContractModel(contract: Record<string, any>): ContractNormalizationResult {
  const warnings: string[] = [];
  const deprecatedFields: string[] = [];

  const hasSchemaShape = typeof contract.meta === 'object' && !!contract.meta && typeof contract.core === 'object' && !!contract.core;

  if (!hasSchemaShape) {
    throw new Error("schema-native contract required: top-level 'meta' and 'core' blocks are missing");
  }

  const fridaPaths = contract?.FRIDA_CONFIG?.paths || {};
  for (const legacy of LEGACY_PATH_FIELDS) {
    if (typeof fridaPaths[legacy.field] === 'string') {
      deprecatedFields.push(`FRIDA_CONFIG.paths.${legacy.field}`);
      warnings.push(`Deprecated key FRIDA_CONFIG.paths.${legacy.field} used. Prefer ${legacy.ref}.`);
    }
  }

  if (Array.isArray(contract.FRIDA_EXTENSIONS)) {
    deprecatedFields.push('FRIDA_EXTENSIONS');
    warnings.push("Deprecated block FRIDA_EXTENSIONS is present. Move extension data to top-level 'extensions'.");
  }

  if (typeof contract.meta?.mode === 'string' && contract.meta.mode !== 'schema') {
    deprecatedFields.push('meta.mode');
    warnings.push("meta.mode must be 'schema' in wave 2 strict mode.");
  }

  const model = contract as unknown as FridaContractSchema;

  return {
    model,
    telemetry: buildTelemetry(warnings, deprecatedFields),
  };
}

export function collectMigrationIssues(contract: Record<string, any>, strict = false): MigrationIssue[] {
  const issues: MigrationIssue[] = [];
  const fridaPaths = contract?.FRIDA_CONFIG?.paths || {};

  for (const item of LEGACY_PATH_FIELDS) {
    if (typeof fridaPaths[item.field] === 'string') {
      issues.push({
        field: `FRIDA_CONFIG.paths.${item.field}`,
        replacement: `FRIDA_CONFIG.paths.${item.ref}`,
        severity: strict ? 'error' : 'warning',
        message: `Deprecated path key is still used: FRIDA_CONFIG.paths.${item.field}`,
      });
    }
  }

  if (!contract.meta || !contract.core) {
    issues.push({
      field: 'root.meta/core',
      replacement: 'root.meta + root.core',
      severity: strict ? 'error' : 'warning',
      message: 'Schema-native top-level blocks are missing.',
    });
  }

  if (Array.isArray(contract.FRIDA_EXTENSIONS)) {
    issues.push({
      field: 'FRIDA_EXTENSIONS',
      replacement: 'extensions',
      severity: strict ? 'error' : 'warning',
      message: "Deprecated extension block is still present. Use top-level 'extensions'.",
    });
  }

  if (typeof contract.meta?.mode === 'string' && contract.meta.mode !== 'schema') {
    issues.push({
      field: 'meta.mode',
      replacement: "meta.mode='schema'",
      severity: strict ? 'error' : 'warning',
      message: 'Only schema mode is supported in wave 2 strict mode.',
    });
  }

  return issues;
}
