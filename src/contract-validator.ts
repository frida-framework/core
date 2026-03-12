import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { loadContractDocument } from './contract-path.ts';
import { normalizeContractModel, validateFridaSchemaModel } from './schema.ts';
import type {
  ContractIndex,
  ContractValidationIssue,
  ContractValidationResult,
  MigrationIssue,
  RunFridaCoreOptions,
} from './types.ts';

interface RefUse {
  key: string;
  ref: string;
  location: string;
}

interface StringUse {
  value: string;
  location: string;
}

interface PathLeaf {
  key: string;
  value: string;
  location: string;
}

const VIRTUAL_REF_PREFIXES = ['APP_HOST.root'];
const CANONICAL_PATH_LEAF_SUFFIXES = ['Dir', 'File', 'Glob', 'Pattern'];
const PATH_SURFACE_AUTHORITIES = new Set(['APP_REPO', 'FRIDA_CONTRACT', 'EXTERNAL_PACKAGE', 'DERIVED_BUILD']);
const PATH_SURFACE_LIFECYCLES = new Set(['authorable', 'frida_static', 'frida_generated', 'external_package', 'derived_build']);
const LEGACY_APP_NAMESPACE_TOKENS = [
  'UI_BEHAVIOR',
  'UI_STRUCTURE',
  'UI_COMPONENT_CONTRACTS',
  'ROUTE_PIPELINE_CONTRACT',
  'WAYPOINT_SYSTEM_CONTRACT',
];
const APP_SHARED_BLOCKS = new Set([
  'GLOSSARY',
  'DATABASE_SCHEMA',
  'RESOURCES',
  'SERVICE_PROVIDERS',
  'MOUNT_POINTS',
  'META',
  'DOCS',
  'LAYERS',
  'PATH_NORMALIZATION',
  'PATHS',
  'PATH_SURFACES',
  'PATH_STATUS',
  'FRIDA_CONFIG',
  'meta',
  'core',
  'BUILDTIME',
  'TOOLING',
  'FUNCTIONS_REGISTRY',
  'PROJECT_GUARDS',
  'GUARDS',
  'VALIDATION_RULES_APP',
  'ZONE_RESOLUTION',
  'VERIFICATION_POLICY',
  'ZONES',
  'TASK_PROFILES',
  'INVARIANTS',
  'FRIDA_CORE_RESERVED',
]);
const CANONICAL_COMPONENT_SECTIONS = [
  'component_hierarchy_position',
  'component_mount_point',
  'component_input_interface',
  'component_output_interface',
  'component_domain_blocks',
  'component_shared_refs',
];

function pushIssue(
  bucket: ContractValidationIssue[],
  code: string,
  message: string,
  location?: string,
  suggestion?: string,
): void {
  bucket.push({ code, message, location, suggestion });
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAppContract(contract: Record<string, any>): boolean {
  return !isPlainObject(contract.CONTRACT_META);
}

function readDeclaredBlocks(contractPath: string): string[] {
  if (path.basename(contractPath) !== 'contract.index.yaml') {
    return [];
  }

  const index = yaml.parse(fs.readFileSync(contractPath, 'utf8')) as ContractIndex;
  const layers = Array.isArray(index?.layers)
    ? index.layers
    : Array.isArray(index?.contract_index?.layers)
      ? index.contract_index.layers
      : [];

  const blocks = new Set<string>();
  for (const layer of layers) {
    for (const block of layer.blocks || []) {
      blocks.add(block);
    }
  }

  return [...blocks].sort((left, right) => left.localeCompare(right));
}

function tokenizeRef(ref: string): string[] {
  const tokens: string[] = [];
  let buffer = '';

  for (let index = 0; index < ref.length; index += 1) {
    const char = ref[index];
    if (char === '.') {
      if (buffer) {
        tokens.push(buffer);
        buffer = '';
      }
      continue;
    }

    if (char === '[') {
      if (buffer) {
        tokens.push(buffer);
        buffer = '';
      }

      const closeIndex = ref.indexOf(']', index + 1);
      if (closeIndex === -1) {
        tokens.push(ref.slice(index + 1));
        break;
      }

      const inner = ref.slice(index + 1, closeIndex).trim();
      if (inner) {
        tokens.push(inner);
      }
      index = closeIndex;
      continue;
    }

    buffer += char;
  }

  if (buffer) {
    tokens.push(buffer);
  }

  return tokens;
}

function isNumberish(value: string): boolean {
  return /^\d+$/.test(value);
}

function resolvesVirtualRef(ref: string): boolean {
  return VIRTUAL_REF_PREFIXES.some((prefix) => ref === prefix || ref.startsWith(`${prefix}.`));
}

function resolveContractRef(contract: Record<string, any>, ref: string): boolean {
  if (resolvesVirtualRef(ref)) {
    return true;
  }

  const tokens = tokenizeRef(ref);
  if (tokens.length === 0) {
    return false;
  }

  let cursor: unknown = contract;
  for (const token of tokens) {
    if (Array.isArray(cursor)) {
      if (!isNumberish(token)) {
        const byId = cursor.find((entry) => isPlainObject(entry) && entry.id === token);
        if (!byId) {
          return false;
        }
        cursor = byId;
        continue;
      }

      const next = cursor[Number(token)];
      if (typeof next === 'undefined') {
        return false;
      }
      cursor = next;
      continue;
    }

    if (!isPlainObject(cursor)) {
      return false;
    }

    if (!(token in cursor)) {
      return false;
    }

    cursor = cursor[token];
  }

  return true;
}

function isContractLikeRef(value: string): boolean {
  return resolvesVirtualRef(value) || /^[A-Z][A-Z0-9_]*(?:$|[.[])/.test(value);
}

function collectRefs(node: unknown, currentPath: string, out: RefUse[]): void {
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      collectRefs(node[index], `${currentPath}[${index}]`, out);
    }
    return;
  }

  if (!isPlainObject(node)) {
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    const nextPath = currentPath ? `${currentPath}.${key}` : key;

    if (key.endsWith('Ref') && typeof value === 'string' && isContractLikeRef(value)) {
      out.push({ key, ref: value, location: nextPath });
    } else if (key.endsWith('Refs') && Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const entry = value[index];
        if (typeof entry === 'string' && isContractLikeRef(entry)) {
          out.push({ key, ref: entry, location: `${nextPath}[${index}]` });
        }
      }
    }

    collectRefs(value, nextPath, out);
  }
}

function collectStringLeaves(node: unknown, currentPath: string, out: StringUse[]): void {
  if (typeof node === 'string') {
    out.push({ value: node, location: currentPath });
    return;
  }

  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      collectStringLeaves(node[index], `${currentPath}[${index}]`, out);
    }
    return;
  }

  if (!isPlainObject(node)) {
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    const nextPath = currentPath ? `${currentPath}.${key}` : key;
    collectStringLeaves(value, nextPath, out);
  }
}

function collectPathLeaves(node: unknown, currentPath: string, out: PathLeaf[]): void {
  if (typeof node === 'string') {
    const segments = currentPath.split('.');
    out.push({
      key: segments[segments.length - 1] || currentPath,
      value: node,
      location: currentPath,
    });
    return;
  }

  if (Array.isArray(node)) {
    return;
  }

  if (!isPlainObject(node)) {
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    const nextPath = currentPath ? `${currentPath}.${key}` : key;
    collectPathLeaves(value, nextPath, out);
  }
}

function pathExists(node: unknown, pathParts: string[]): boolean {
  let cursor = node;
  for (const part of pathParts) {
    if (!isPlainObject(cursor) || !(part in cursor)) {
      return false;
    }
    cursor = cursor[part];
  }
  return true;
}

function getPathValue(node: unknown, pathParts: string[]): unknown {
  let cursor = node;
  for (const part of pathParts) {
    if (!isPlainObject(cursor) || !(part in cursor)) {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}

function isCanonicalPathLeafKey(key: string): boolean {
  return key === 'rootDir' || CANONICAL_PATH_LEAF_SUFFIXES.some((suffix) => key.endsWith(suffix));
}

function classifyTopLevelBlock(key: string, value: unknown): 'boundary' | 'shared' | 'derived' | 'unknown' {
  if (APP_SHARED_BLOCKS.has(key)) {
    return key === 'meta' || key === 'core' ? 'derived' : 'shared';
  }

  if (key.startsWith('APP_EXTENSION_')) {
    return 'shared';
  }

  if (!isPlainObject(value)) {
    return 'unknown';
  }

  const presentSections = CANONICAL_COMPONENT_SECTIONS.filter((section) => section in value);
  if (presentSections.length > 0) {
    return presentSections.length === CANONICAL_COMPONENT_SECTIONS.length ? 'boundary' : 'unknown';
  }

  return 'unknown';
}

function collectDeprecatedFieldIssues(contract: Record<string, any>): MigrationIssue[] {
  return normalizeContractModel(contract).telemetry.deprecatedFields.map((field) => ({
    field,
    replacement: 'current schema-native contract surface',
    severity: 'error',
    message: `Deprecated field is still present: ${field}`,
  }));
}

function formatIssue(prefix: 'ERROR' | 'WARN', issue: ContractValidationIssue): string {
  const location = issue.location ? ` @ ${issue.location}` : '';
  const suggestion = issue.suggestion ? ` -> ${issue.suggestion}` : '';
  return `${prefix} [${issue.code}]${location}: ${issue.message}${suggestion}`;
}

function printResult(result: ContractValidationResult): void {
  if (result.errors.length === 0 && result.warnings.length === 0) {
    console.log('Contract validation passed.');
    return;
  }

  console.log('Contract validation report\n');
  for (const warning of result.warnings) {
    console.log(`- ${formatIssue('WARN', warning)}`);
  }
  for (const error of result.errors) {
    console.log(`- ${formatIssue('ERROR', error)}`);
  }
}

export function validateContractSemantics(
  contract: Record<string, any>,
  options: { contractPath: string; rootDir?: string },
): ContractValidationResult {
  const errors: ContractValidationIssue[] = [];
  const warnings: ContractValidationIssue[] = [];

  const declaredBlocks = readDeclaredBlocks(options.contractPath);
  for (const block of declaredBlocks) {
    if (!(block in contract)) {
      pushIssue(
        errors,
        'DECLARED_BLOCK_MISSING',
        `Contract index declares block '${block}', but the assembled contract does not contain it.`,
        options.contractPath,
        `Add block '${block}' to its layer or remove it from contract.index.yaml.`,
      );
    }
  }

  const refs: RefUse[] = [];
  collectRefs(contract, 'root', refs);

  for (const refUse of refs) {
    if (refUse.key === 'service_providerRef' && !refUse.ref.startsWith('SERVICE_PROVIDERS.')) {
      pushIssue(
        errors,
        'SERVICE_PROVIDER_REF_PREFIX_INVALID',
        'service_providerRef must reference a single declared entry under SERVICE_PROVIDERS.*',
        refUse.location,
        'Describe the provider once under SERVICE_PROVIDERS and reference that entry everywhere else.',
      );
      continue;
    }

    if (!resolveContractRef(contract, refUse.ref)) {
      pushIssue(
        errors,
        'UNRESOLVED_CONTRACT_REF',
        `Reference '${refUse.ref}' does not resolve in the assembled contract.`,
        refUse.location,
        'Fix the ref target or add the missing canonical block/entry.',
      );
    }
  }

  for (const issue of collectDeprecatedFieldIssues(contract)) {
    pushIssue(errors, 'DEPRECATED_FIELD_ACTIVE', issue.message, issue.field, issue.replacement);
  }

  if (isAppContract(contract)) {
    if (!isPlainObject(contract.PATH_SURFACES)) {
      pushIssue(
        errors,
        'PATH_SURFACES_REQUIRED',
        'Active app contracts MUST declare PATH_SURFACES as the ownership/lifecycle companion to PATHS.',
        options.contractPath,
        'Add PATH_SURFACES.roots/overrides and classify each non-default surface by authority and lifecycle.',
      );
    }

    if (isPlainObject(contract.PATH_STATUS)) {
      pushIssue(
        errors,
        'PATH_STATUS_LEGACY_ACTIVE',
        'PATH_STATUS is legacy. Active app contracts MUST use PATH_SURFACES instead.',
        'root.PATH_STATUS',
        'Replace PATH_STATUS with PATH_SURFACES and move ownership/lifecycle semantics there.',
      );
    }

    const pathLeaves: PathLeaf[] = [];
    collectPathLeaves(contract.PATHS, 'root.PATHS', pathLeaves);

    const leavesByValue = new Map<string, PathLeaf[]>();
    for (const leaf of pathLeaves) {
      if (leaf.key.endsWith('Ref')) {
        pushIssue(
          errors,
          'PATHS_NON_FILESYSTEM_REF',
          'PATHS must contain filesystem facts only. Ref-bearing fields are forbidden inside PATHS.',
          leaf.location,
          'Move semantic role wiring into a consumer block and keep only the concrete filesystem path in PATHS.',
        );
        continue;
      }

      if (!isCanonicalPathLeafKey(leaf.key)) {
        pushIssue(
          errors,
          'PATH_KEY_NONCANONICAL',
          `PATHS leaf '${leaf.key}' is noncanonical. Active path keys must end with Dir/File/Glob/Pattern or equal rootDir.`,
          leaf.location,
          'Rename the key to a canonical filesystem fact and move role semantics outside PATHS.',
        );
      }

      const normalizedValue = leaf.value.trim().replace(/\\/g, '/');
      if (!normalizedValue) {
        pushIssue(errors, 'PATH_VALUE_EMPTY', 'PATHS leaf value must be a non-empty filesystem path.', leaf.location);
        continue;
      }

      if (normalizedValue.startsWith('PATHS.')) {
        pushIssue(
          errors,
          'PATH_VALUE_REF_INSIDE_PATHS',
          'PATHS leaf values must be concrete filesystem strings, not PATHS.* references.',
          leaf.location,
          'Replace this value with a concrete path string and keep indirection only in consumer ...Ref fields.',
        );
        continue;
      }

      const bucket = leavesByValue.get(normalizedValue) || [];
      bucket.push({ ...leaf, value: normalizedValue });
      leavesByValue.set(normalizedValue, bucket);
    }

    for (const [pathValue, leaves] of leavesByValue.entries()) {
      if (leaves.length < 2) continue;
      pushIssue(
        errors,
        'PATH_ALIAS_DUPLICATE_ACTIVE',
        `Concrete path '${pathValue}' is declared ${leaves.length} times in active PATHS.`,
        leaves.map((leaf) => leaf.location).join(', '),
        'Keep one canonical path key, move role semantics to consumer refs, and delete active aliases.',
      );
    }

    if (isPlainObject(contract.PATH_SURFACES)) {
      for (const sectionName of ['roots', 'overrides']) {
        const section = (contract.PATH_SURFACES as Record<string, any>)[sectionName];
        if (!isPlainObject(section)) {
          pushIssue(
            errors,
            'PATH_SURFACES_SECTION_INVALID',
            `PATH_SURFACES.${sectionName} must be an object keyed by stable surface ids.`,
            `root.PATH_SURFACES.${sectionName}`,
          );
          continue;
        }

        for (const [entryId, entry] of Object.entries(section)) {
          const entryLocation = `root.PATH_SURFACES.${sectionName}.${entryId}`;
          if (!isPlainObject(entry)) {
            pushIssue(errors, 'PATH_SURFACE_ENTRY_INVALID', 'PATH_SURFACES entry must be an object.', entryLocation);
            continue;
          }

          if (typeof entry.pathRef !== 'string' || !entry.pathRef.startsWith('PATHS.')) {
            pushIssue(
              errors,
              'PATH_SURFACE_PATH_REF_INVALID',
              'PATH_SURFACES entry must declare pathRef as a PATHS.* reference.',
              `${entryLocation}.pathRef`,
            );
          } else if (!resolveContractRef(contract, entry.pathRef)) {
            pushIssue(
              errors,
              'PATH_SURFACE_PATH_REF_UNRESOLVED',
              `PATH_SURFACES entry pathRef '${entry.pathRef}' does not resolve.`,
              `${entryLocation}.pathRef`,
            );
          }

          if (!PATH_SURFACE_AUTHORITIES.has(String(entry.authority || ''))) {
            pushIssue(
              errors,
              'PATH_SURFACE_AUTHORITY_INVALID',
              `PATH_SURFACES authority '${String(entry.authority || '')}' is invalid.`,
              `${entryLocation}.authority`,
              'Use one of APP_REPO, FRIDA_CONTRACT, EXTERNAL_PACKAGE, DERIVED_BUILD.',
            );
          }

          if (!PATH_SURFACE_LIFECYCLES.has(String(entry.lifecycle || ''))) {
            pushIssue(
              errors,
              'PATH_SURFACE_LIFECYCLE_INVALID',
              `PATH_SURFACES lifecycle '${String(entry.lifecycle || '')}' is invalid.`,
              `${entryLocation}.lifecycle`,
              'Use one of authorable, frida_static, frida_generated, external_package, derived_build.',
            );
          }
        }
      }
    }

    const docSourceFiles = getPathValue(contract, ['DOCS', 'contract', 'sourceFiles']);
    if (Array.isArray(docSourceFiles)) {
      const contractRoot = options.rootDir || path.resolve(path.dirname(options.contractPath), '..', '..', '..');
      for (let index = 0; index < docSourceFiles.length; index += 1) {
        const entry = docSourceFiles[index];
        if (typeof entry !== 'string' || !entry.trim()) {
          pushIssue(
            errors,
            'DOC_SOURCE_FILE_INVALID',
            'DOCS.contract.sourceFiles entries must be non-empty repo-relative paths.',
            `root.DOCS.contract.sourceFiles[${index}]`,
          );
          continue;
        }
        if (!fs.existsSync(path.resolve(contractRoot, entry))) {
          pushIssue(
            errors,
            'DOC_SOURCE_FILE_MISSING',
            `DOCS.contract.sourceFiles entry '${entry}' does not exist in the repository.`,
            `root.DOCS.contract.sourceFiles[${index}]`,
            'Remove dead entries or restore the missing source file.',
          );
        }
      }
    }

    const allStrings: StringUse[] = [];
    collectStringLeaves(contract, 'root', allStrings);
    for (const token of LEGACY_APP_NAMESPACE_TOKENS) {
      const hits = allStrings.filter((entry) => entry.value.includes(token));
      if (hits.length === 0) continue;
      pushIssue(
        errors,
        'LEGACY_NAMESPACE_ACTIVE',
        `Legacy namespace token '${token}' is present in active app contract data.`,
        hits.map((hit) => hit.location).join(', '),
        'Replace legacy namespace references with canonical current entities or move historical prose outside active source blocks.',
      );
    }

    for (const duplicatedMechanics of [
      { pathParts: ['META', 'sourceOfTruth'], location: 'root.META.sourceOfTruth' },
      { pathParts: ['DOCS', 'sourceOfTruth'], location: 'root.DOCS.sourceOfTruth' },
      { pathParts: ['DOCS', 'sourcesModel'], location: 'root.DOCS.sourcesModel' },
      { pathParts: ['FRIDA_CONFIG', 'naming', 'wiki_sourceFilesRef'], location: 'root.FRIDA_CONFIG.naming.wiki_sourceFilesRef' },
      { pathParts: ['FRIDA_CONFIG', 'naming', 'sourceSelectionPrecedence'], location: 'root.FRIDA_CONFIG.naming.sourceSelectionPrecedence' },
    ]) {
      if (!pathExists(contract, duplicatedMechanics.pathParts)) continue;
      pushIssue(
        errors,
        'CORE_WIKI_MECHANICS_DUPLICATED_IN_APP',
        'App contract duplicates core-owned wiki/SSOT mechanics in active structured data.',
        duplicatedMechanics.location,
        'Keep wiki-specific app data only. SSOT mode and wiki mechanics must remain owned by FRIDA_WIKI_MECHANICS + runtime config.',
      );
    }

    for (const [key, value] of Object.entries(contract)) {
      const classification = classifyTopLevelBlock(key, value);
      if (classification === 'unknown') {
        pushIssue(
          errors,
          'TOP_LEVEL_ENTITY_UNCLASSIFIED',
          `Top-level block '${key}' does not classify as a canonical shared block, derived block, or complete component boundary.`,
          `root.${key}`,
          'Demote it into a boundary-local domain block, move it into a shared registry, or split it into canonical entities.',
        );
        continue;
      }

      if (classification === 'boundary' && isPlainObject(value)) {
        const missingSections = CANONICAL_COMPONENT_SECTIONS.filter((section) => !(section in value));
        if (missingSections.length > 0) {
          pushIssue(
            errors,
            'COMPONENT_BOUNDARY_SECTIONS_INCOMPLETE',
            `Boundary '${key}' is missing canonical component sections: ${missingSections.join(', ')}.`,
            `root.${key}`,
            'Declare the full component_* boundary surface or demote/split the entity.',
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateLoadedContractDocument(
  contract: Record<string, any>,
  options: { contractPath: string; rootDir?: string },
): ContractValidationResult {
  const errors: ContractValidationIssue[] = [];
  const warnings: ContractValidationIssue[] = [];

  try {
    validateFridaSchemaModel(normalizeContractModel(contract).model);
  } catch (error) {
    pushIssue(
      errors,
      'SCHEMA_VALIDATION_FAILED',
      error instanceof Error ? error.message : String(error),
      options.contractPath,
      'Bring contract, validator, and schema for this FRIDA version back into sync.',
    );
  }

  const semanticResult = validateContractSemantics(contract, options);
  warnings.push(...semanticResult.warnings);
  errors.push(...semanticResult.errors);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function runFridaValidateCli(args: string[] = [], options: RunFridaCoreOptions = {}): number {
  const contractFlagIndex = args.indexOf('--contract');
  const contractPath =
    contractFlagIndex >= 0 && contractFlagIndex + 1 < args.length
      ? args[contractFlagIndex + 1]
      : options.contractPath;

  const loaded = loadContractDocument(options.rootDir || process.cwd(), contractPath);
  const result = validateLoadedContractDocument(loaded.parsed, {
    contractPath: loaded.contractPath,
    rootDir: loaded.rootDir,
  });

  printResult(result);
  return result.valid ? 0 : 1;
}
