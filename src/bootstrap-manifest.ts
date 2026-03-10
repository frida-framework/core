import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { fileURLToPath } from 'url';

export type BootstrapPackageMode = 'warm' | 'cold-engine' | 'demo' | 'zero-start';
export type BootstrapOwnershipClass = 'engine_static' | 'engine_generated' | 'user_owned' | 'user_data' | 'demo_only';
export type BootstrapEntryKind = 'file' | 'dir' | 'tree';
export type BootstrapEntryApplyMode = 'copy' | 'ensure_dir' | 'generated' | 'seed_if_absent';

export interface BootstrapPackageManifestEntry {
  id: string;
  source?: string;
  target: string;
  kind: BootstrapEntryKind;
  ownership_class: BootstrapOwnershipClass;
  apply_mode: BootstrapEntryApplyMode;
  sha256?: string;
  modes?: BootstrapPackageMode[];
  prune_scope?: boolean;
  cleanup_only?: boolean;
  preserve_globs?: string[];
  components?: string[];
}

export interface BootstrapPackageManifest {
  version: string;
  manifest_id: string;
  assets_root: string;
  entries: BootstrapPackageManifestEntry[];
}

export interface LoadedBootstrapPackageManifest {
  packageRoot: string;
  manifestPath: string;
  schemaPath: string;
  manifest: BootstrapPackageManifest;
}

export class BootstrapManifestLoadError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export const BOOTSTRAP_PACKAGE_MANIFEST_REL_PATH = 'contract/bootstrap-package.manifest.yaml';
export const BOOTSTRAP_PACKAGE_MANIFEST_SCHEMA_REL_PATH = 'schemas/frida-bootstrap-package-manifest.schema.json';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGE_ROOT = path.resolve(MODULE_DIR, '..');

let manifestValidator:
  | ((payload: unknown) => { ok: boolean; message: string })
  | null = null;

function createValidator(schemaPath: string): (payload: unknown) => { ok: boolean; message: string } {
  const schemaRaw = fs.readFileSync(schemaPath, 'utf-8');
  const schema = JSON.parse(schemaRaw);
  const AjvCtor: any = (Ajv2020 as any).default || Ajv2020;
  const addFormatsFn: any = (addFormats as any).default || addFormats;
  const ajv = new AjvCtor({ allErrors: true, strict: false });
  addFormatsFn(ajv);
  const validate = ajv.compile(schema);

  return (payload: unknown) => {
    const ok = Boolean(validate(payload));
    if (ok) return { ok: true, message: '' };
    const message = (validate.errors || [])
      .map((error: any) => `${error.instancePath || '/'} ${error.message || 'invalid'}`)
      .join('; ');
    return { ok: false, message };
  };
}

function getManifestValidator(schemaPath: string): (payload: unknown) => { ok: boolean; message: string } {
  if (!manifestValidator) {
    manifestValidator = createValidator(schemaPath);
  }
  return manifestValidator;
}

function sha256File(filePath: string): string {
  const bytes = fs.readFileSync(filePath);
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function ensureFileExists(filePath: string, code: string, label: string): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new BootstrapManifestLoadError(code, `${label} not found: ${filePath}`);
  }
}

function ensureManifestSchemaValid(manifest: unknown, schemaPath: string): void {
  const validation = getManifestValidator(schemaPath)(manifest);
  if (!validation.ok) {
    throw new BootstrapManifestLoadError(
      'BOOTSTRAP_PACKAGE_MANIFEST_INVALID',
      `bootstrap package manifest schema validation failed: ${validation.message}`
    );
  }
}

function ensureStaticEntrySourceAndHash(
  packageRoot: string,
  manifest: BootstrapPackageManifest,
  entry: BootstrapPackageManifestEntry
): void {
  if (entry.apply_mode !== 'copy' && entry.apply_mode !== 'seed_if_absent') return;

  if (entry.kind !== 'file') {
    throw new BootstrapManifestLoadError(
      'BOOTSTRAP_PACKAGE_MANIFEST_INVALID',
      `unsupported ${entry.apply_mode} entry kind for ${entry.id}: ${entry.kind} (only kind=file is supported)`
    );
  }

  if (!entry.source || entry.source.trim().length === 0) {
    throw new BootstrapManifestLoadError(
      'BOOTSTRAP_PACKAGE_MANIFEST_INVALID',
      `${entry.apply_mode} entry ${entry.id} is missing source`
    );
  }

  const sourcePath = path.resolve(packageRoot, manifest.assets_root, entry.source);
  ensureFileExists(sourcePath, 'BOOTSTRAP_PACKAGE_MANIFEST_MISSING', `bootstrap package source for ${entry.id}`);

  if (!entry.sha256) {
    throw new BootstrapManifestLoadError(
      'BOOTSTRAP_PACKAGE_MANIFEST_INVALID',
      `${entry.apply_mode} entry ${entry.id} is missing sha256`
    );
  }

  const actualHash = sha256File(sourcePath);
  if (actualHash !== entry.sha256) {
    throw new BootstrapManifestLoadError(
      'BOOTSTRAP_PACKAGE_HASH_MISMATCH',
      `bootstrap package hash mismatch for ${entry.id}: manifest=${entry.sha256}, actual=${actualHash}`
    );
  }
}

export function entryAppliesToMode(entry: BootstrapPackageManifestEntry, mode: BootstrapPackageMode): boolean {
  if (!entry.modes || entry.modes.length === 0) {
    return true;
  }

  if (entry.modes.includes(mode)) {
    return true;
  }

  // Zero-start is defined as cold-engine surface deployment plus template_app_basic-only seeds.
  return mode === 'zero-start' && entry.modes.includes('cold-engine');
}

export function getManifestEntryById(
  manifest: BootstrapPackageManifest,
  entryId: string
): BootstrapPackageManifestEntry | undefined {
  return manifest.entries.find((entry) => entry.id === entryId);
}

export function getManifestEntryTargetOrThrow(
  manifest: BootstrapPackageManifest,
  entryId: string
): string {
  const entry = getManifestEntryById(manifest, entryId);
  if (!entry) {
    throw new BootstrapManifestLoadError(
      'BOOTSTRAP_PACKAGE_MANIFEST_INVALID',
      `bootstrap package manifest is missing required entry: ${entryId}`
    );
  }
  return entry.target;
}

export function collectManifestTargetsForMode(
  manifest: BootstrapPackageManifest,
  mode: BootstrapPackageMode,
  options: {
    includeCleanupOnly?: boolean;
    kind?: BootstrapEntryKind;
  } = {}
): string[] {
  const includeCleanupOnly = options.includeCleanupOnly ?? false;
  const kind = options.kind;

  return manifest.entries
    .filter((entry) => entryAppliesToMode(entry, mode))
    .filter((entry) => includeCleanupOnly || !entry.cleanup_only)
    .filter((entry) => (kind ? entry.kind === kind : true))
    .map((entry) => entry.target);
}

export function loadBootstrapPackageManifest(packageRoot: string = DEFAULT_PACKAGE_ROOT): LoadedBootstrapPackageManifest {
  const manifestPath = path.resolve(packageRoot, BOOTSTRAP_PACKAGE_MANIFEST_REL_PATH);
  const schemaPath = path.resolve(packageRoot, BOOTSTRAP_PACKAGE_MANIFEST_SCHEMA_REL_PATH);

  if (!fs.existsSync(manifestPath)) {
    throw new BootstrapManifestLoadError(
      'BOOTSTRAP_PACKAGE_MANIFEST_MISSING',
      `bootstrap package manifest is missing at ${manifestPath}`
    );
  }
  if (!fs.existsSync(schemaPath)) {
    throw new BootstrapManifestLoadError(
      'BOOTSTRAP_PACKAGE_MANIFEST_MISSING',
      `bootstrap package manifest schema is missing at ${schemaPath}`
    );
  }

  const parsed = yaml.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BootstrapManifestLoadError(
      'BOOTSTRAP_PACKAGE_MANIFEST_INVALID',
      `bootstrap package manifest must be a YAML mapping (${manifestPath})`
    );
  }

  ensureManifestSchemaValid(parsed, schemaPath);
  const manifest = parsed as BootstrapPackageManifest;

  for (const entry of manifest.entries) {
    ensureStaticEntrySourceAndHash(packageRoot, manifest, entry);
  }

  return {
    packageRoot,
    manifestPath,
    schemaPath,
    manifest,
  };
}
