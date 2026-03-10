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

const REMOVED_PATH_ALIAS_FIELDS: Array<{ field: string; ref: string }> = [
  { field: 'agents_bootloader', ref: 'agents_bootloaderFileRef' },
  { field: 'specs_root', ref: 'specs_rootRef' },
  { field: 'profiles_root', ref: 'profiles_rootRef' },
  { field: 'docs_policy', ref: 'docs_policyDirRef' },
  { field: 'docs_reference', ref: 'docs_referenceDirRef' },
  { field: 'frida_internal', ref: 'frida_internalRef' },
  { field: 'templates_frida', ref: 'templates_fridaRef' },
  { field: 'templates_docs', ref: 'templates_docsRef' },
];

function hasLegacyPolicyPaths(contract: Record<string, any>): boolean {
  const accessValidation = contract?.FRIDA_CONFIG?.reporting?.access_validation;
  return Boolean(
    accessValidation &&
    typeof accessValidation === 'object' &&
    accessValidation.policy_paths &&
    typeof accessValidation.policy_paths === 'object'
  );
}

export function normalizeContractModel(contract: Record<string, any>): ContractNormalizationResult {
  const warnings: string[] = [];
  const deprecatedFields: string[] = [];

  const hasSchemaShape = typeof contract.meta === 'object' && !!contract.meta && typeof contract.core === 'object' && !!contract.core;

  if (!hasSchemaShape) {
    throw new Error("schema-native contract required: top-level 'meta' and 'core' blocks are missing");
  }

  const fridaPaths = contract?.FRIDA_CONFIG?.paths || {};
  for (const removedAlias of REMOVED_PATH_ALIAS_FIELDS) {
    if (typeof fridaPaths[removedAlias.field] === 'string') {
      deprecatedFields.push(`FRIDA_CONFIG.paths.${removedAlias.field}`);
      warnings.push(`Deprecated key FRIDA_CONFIG.paths.${removedAlias.field} used. Prefer ${removedAlias.ref}.`);
    }
  }

  if (hasLegacyPolicyPaths(contract)) {
    deprecatedFields.push('FRIDA_CONFIG.reporting.access_validation.policy_paths');
    warnings.push(
      'Deprecated key FRIDA_CONFIG.reporting.access_validation.policy_paths used. Prefer FRIDA_CONFIG.reporting.access_validation.repo_policies.<repo_scope>.',
    );
  }

  if (Array.isArray(contract.FRIDA_EXTENSIONS)) {
    deprecatedFields.push('FRIDA_EXTENSIONS');
    warnings.push(
      "Deprecated block FRIDA_EXTENSIONS is present. Activate shipped app extensions by linking their AL## layer files in contract.index.yaml instead.",
    );
  }

  if (Array.isArray(contract.extensions)) {
    deprecatedFields.push('extensions');
    warnings.push(
      "Top-level 'extensions' activation block is no longer supported. Activate shipped app extensions by linking their AL## layer files in contract.index.yaml.",
    );
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

  for (const item of REMOVED_PATH_ALIAS_FIELDS) {
    if (typeof fridaPaths[item.field] === 'string') {
      issues.push({
        field: `FRIDA_CONFIG.paths.${item.field}`,
        replacement: `FRIDA_CONFIG.paths.${item.ref}`,
        severity: strict ? 'error' : 'warning',
        message: `Deprecated path key is still used: FRIDA_CONFIG.paths.${item.field}`,
      });
    }
  }

  if (hasLegacyPolicyPaths(contract)) {
    issues.push({
      field: 'FRIDA_CONFIG.reporting.access_validation.policy_paths',
      replacement: 'FRIDA_CONFIG.reporting.access_validation.repo_policies.<repo_scope>',
      severity: strict ? 'error' : 'warning',
      message: 'Deprecated access-validation policy_paths block is still used.',
    });
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
      replacement: 'contract.index.yaml layer links',
      severity: strict ? 'error' : 'warning',
      message: 'Deprecated extension block is still present. Activate shipped app extensions by linking their AL## layer files in contract.index.yaml.',
    });
  }

  if (Array.isArray(contract.extensions)) {
    issues.push({
      field: 'extensions',
      replacement: 'contract.index.yaml layer links',
      severity: strict ? 'error' : 'warning',
      message: "Top-level 'extensions' activation block is no longer supported.",
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
