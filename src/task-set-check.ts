import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { loadContractDocument } from './contract-path.ts';
import { FRIDA_PACKAGE_NAME } from './identity.ts';

const CORE_CONTRACT_INDEX_REL = 'core-contract/contract.index.yaml';
const APP_CONTRACT_MIRROR_INDEX_REL = '.frida/contract/app/contract.index.yaml';
const TASKS_DIR_REL = 'tasks';
const TASK_REGISTRY_REL = 'tasks/index.yaml';
const TASK_SESSIONS_DIR_REL = 'tasks/sessions';
const TASK_FILE_RE = /^TASK-([A-Za-z0-9._-]+)\.md$/;
const TASK_VALIDATION_DECISIONS = new Set([
  'valid',
  'invalid_contract_collision',
  'requires_contract_change',
  'requires_architectural_review',
  'insufficient_contract_context',
]);
const TASK_OUTPUT_STATUSES = new Set([
  'task_created',
  'task_rejected_contract_collision',
  'task_rejected_insufficient_input',
  'task_rerouted_to_architect_inbox',
  'task_rerouted_to_contract_editor',
  'task_waiting_for_clarification',
]);
const TASK_REGISTRY_STATUSES = new Set([
  'draft',
  'validated',
  'ready',
  'in_progress',
  'blocked',
  'done',
  'rejected',
  'superseded',
]);

export type TaskValidationDecision =
  | 'valid'
  | 'invalid_contract_collision'
  | 'requires_contract_change'
  | 'requires_architectural_review'
  | 'insufficient_contract_context';

export interface TaskCollisionCheckResult {
  ok: boolean;
  task_path: string;
  task_id: string | null;
  contract_sources: string[];
  collision_scan_result: TaskValidationDecision;
  conflicts: string[];
  decision: TaskValidationDecision;
  reroute_target: 'architect_inbox' | 'contract_editor' | null;
  notes: string[];
}

interface TaskPackFrontmatter {
  id: string;
  title: string;
  source_request: string | string[];
  goal: string | string[];
  scope: string | string[];
  non_goals: string[];
  target_paths: string[];
  target_profile: string;
  interface_ref: string;
  constraints: string[];
  dependencies: string[];
  acceptance_criteria: string[];
  verification: string[];
  contract_validation_status: string;
  escalate_if: string[];
  [key: string]: unknown;
}

interface TaskPackSchemaCheckResult {
  ok: boolean;
  self_repo: boolean;
  checked_files: string[];
  errors: string[];
  notes: string[];
}

interface TaskRegistryEntry {
  id: string;
  status: string;
  spec_path: string;
  validation_artifact: string;
  latest_session_ref?: string | null;
  supersedes?: string | null;
  superseded_by?: string | null;
  updated_at: string;
  [key: string]: unknown;
}

interface TaskValidationArtifact {
  task_id: string;
  validation_time: string;
  contract_sources: string[];
  collision_scan_result: string;
  conflicts: unknown[];
  decision: string;
  reroute_target?: string | null;
  notes?: unknown;
}

export interface TaskSetCheckResult {
  ok: boolean;
  self_repo: boolean;
  task_files: string[];
  registry_path: string | null;
  errors: string[];
  notes: string[];
}

interface CheckCliArgs {
  taskPath: string | null;
  format: 'text' | 'json' | 'yaml';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rel(rootDir: string, absolutePath: string): string {
  return path.relative(rootDir, absolutePath).replace(/\\/g, '/');
}

function exists(rootDir: string, relativePath: string): boolean {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function isSelfRepo(rootDir: string): boolean {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    return packageJson?.name === FRIDA_PACKAGE_NAME && fs.existsSync(path.join(rootDir, CORE_CONTRACT_INDEX_REL));
  } catch {
    return false;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyStringArray(value: unknown, allowEmpty = false): value is string[] {
  if (!Array.isArray(value)) return false;
  if (!allowEmpty && value.length === 0) return false;
  return value.every((item) => isNonEmptyString(item));
}

function parseFrontmatter(filePath: string): { data: Record<string, unknown> | null; errors: string[] } {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.startsWith('---')) {
    return {
      data: null,
      errors: [`${filePath}: missing YAML frontmatter.`],
    };
  }

  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return {
      data: null,
      errors: [`${filePath}: malformed YAML frontmatter.`],
    };
  }

  try {
    const parsed = yaml.parse(match[1]);
    if (!isPlainObject(parsed)) {
      return {
        data: null,
        errors: [`${filePath}: frontmatter must parse to a YAML object.`],
      };
    }
    return { data: parsed, errors: [] };
  } catch (error) {
    return {
      data: null,
      errors: [`${filePath}: invalid YAML in frontmatter (${error instanceof Error ? error.message : String(error)}).`],
    };
  }
}

function normalizePathLike(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function stripGlob(pattern: string): string {
  return normalizePathLike(pattern)
    .replace(/\/\*\*$/, '')
    .replace(/\/\*$/, '')
    .replace(/\*$/, '')
    .replace(/\/$/, '');
}

function globToRegExp(glob: string): RegExp {
  let out = '^';
  const normalized = normalizePathLike(glob);
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '*') {
      const next = normalized[index + 1];
      if (next === '*') {
        out += '.*';
        index += 1;
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if ('\\.[]{}()+-?^$|'.includes(char)) {
      out += `\\${char}`;
      continue;
    }
    out += char;
  }
  out += '$';
  return new RegExp(out);
}

function patternsOverlap(left: string, right: string): boolean {
  const leftNormalized = normalizePathLike(left);
  const rightNormalized = normalizePathLike(right);
  if (leftNormalized === rightNormalized) return true;

  const leftPrefix = stripGlob(leftNormalized);
  const rightPrefix = stripGlob(rightNormalized);
  if (leftPrefix && rightPrefix) {
    if (leftPrefix === rightPrefix) return true;
    if (leftPrefix.startsWith(`${rightPrefix}/`) || rightPrefix.startsWith(`${leftPrefix}/`)) return true;
  }

  return globToRegExp(leftNormalized).test(rightNormalized) || globToRegExp(rightNormalized).test(leftNormalized);
}

function resolvePathRef(contract: Record<string, any>, ref: unknown): string | null {
  if (!isNonEmptyString(ref) || !ref.startsWith('PATHS.')) {
    return null;
  }
  const tokens = ref.split('.').slice(1);
  let cursor: unknown = contract.PATHS;
  for (const token of tokens) {
    if (!isPlainObject(cursor) || !(token in cursor)) {
      return null;
    }
    cursor = cursor[token];
  }
  if (isNonEmptyString(cursor)) return cursor;
  if (isPlainObject(cursor) && isNonEmptyString(cursor.contractical)) {
    return cursor.contractical;
  }
  return null;
}

function resolvePathLike(contract: Record<string, any>, value: unknown): string | null {
  if (!isNonEmptyString(value)) return null;
  return value.startsWith('PATHS.') ? resolvePathRef(contract, value) : value;
}

function collectTaskFiles(rootDir: string): string[] {
  const tasksDir = path.join(rootDir, TASKS_DIR_REL);
  if (!fs.existsSync(tasksDir) || !fs.statSync(tasksDir).isDirectory()) {
    return [];
  }

  const queue = [tasksDir];
  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!TASK_FILE_RE.test(entry.name)) continue;
      result.push(rel(rootDir, absolutePath));
    }
  }

  return result.sort((left, right) => left.localeCompare(right));
}

function validateTaskPackData(filePath: string, data: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const requiredFields = [
    'id',
    'title',
    'source_request',
    'goal',
    'scope',
    'non_goals',
    'target_paths',
    'target_profile',
    'interface_ref',
    'constraints',
    'dependencies',
    'acceptance_criteria',
    'verification',
    'contract_validation_status',
    'escalate_if',
  ];

  for (const field of requiredFields) {
    if (!(field in data)) {
      errors.push(`${filePath}: missing required frontmatter field '${field}'.`);
    }
  }

  const forbiddenFields = ['status', 'current_status', 'progress'];
  for (const field of forbiddenFields) {
    if (field in data) {
      errors.push(`${filePath}: forbidden frontmatter field '${field}' is not allowed in immutable task packs.`);
    }
  }

  const fileNameId = path.basename(filePath).replace(/^TASK-/, '').replace(/\.md$/, '');
  if (!isNonEmptyString(data.id)) {
    errors.push(`${filePath}: 'id' must be a non-empty string.`);
  } else if (data.id !== fileNameId) {
    errors.push(`${filePath}: 'id' must match file name id '${fileNameId}'.`);
  }

  for (const field of ['title', 'target_profile', 'interface_ref']) {
    if (!isNonEmptyString(data[field])) {
      errors.push(`${filePath}: '${field}' must be a non-empty string.`);
    }
  }

  for (const field of ['source_request', 'goal', 'scope']) {
    const value = data[field];
    const valid = isNonEmptyString(value) || isNonEmptyStringArray(value);
    if (!valid) {
      errors.push(`${filePath}: '${field}' must be a non-empty string or non-empty array of strings.`);
    }
  }

  for (const field of ['non_goals', 'constraints', 'dependencies', 'acceptance_criteria', 'verification', 'escalate_if']) {
    if (!isNonEmptyStringArray(data[field], field === 'dependencies')) {
      const extra = field === 'dependencies' ? ' (empty array allowed)' : '';
      errors.push(`${filePath}: '${field}' must be an array of non-empty strings${extra}.`);
    }
  }

  if (!isNonEmptyStringArray(data.target_paths)) {
    errors.push(`${filePath}: 'target_paths' must be a non-empty array of strings.`);
  }

  if (!isNonEmptyString(data.contract_validation_status)) {
    errors.push(`${filePath}: 'contract_validation_status' must be a non-empty string.`);
  } else if (data.contract_validation_status !== 'valid') {
    errors.push(`${filePath}: published task packs must set 'contract_validation_status' to 'valid'.`);
  }

  if (data.interface_ref !== 'FRIDA_INTERFACE_TASK_SETTER') {
    errors.push(`${filePath}: 'interface_ref' must be 'FRIDA_INTERFACE_TASK_SETTER'.`);
  }

  return errors;
}

function loadAppContractMirror(rootDir: string): Record<string, any> {
  return loadContractDocument(rootDir, APP_CONTRACT_MIRROR_INDEX_REL).parsed;
}

function collectZones(contract: Record<string, any>): Array<{ id: string; path: string }> {
  const zones = contract.ZONES;
  if (!isPlainObject(zones)) return [];
  return Object.entries(zones)
    .filter(([, value]) => isPlainObject(value))
    .map(([id, value]) => ({
      id,
      path: resolvePathLike(contract, (value as Record<string, unknown>).path) || resolvePathLike(contract, (value as Record<string, unknown>).pathGlobRef) || '',
    }))
    .filter((entry) => isNonEmptyString(entry.path));
}

function getTaskProfiles(contract: Record<string, any>): Record<string, Record<string, unknown>> {
  const block = contract.TASK_PROFILES;
  if (!isPlainObject(block)) {
    return {};
  }
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(block)) {
    if (['id', 'version', '_visibility'].includes(key)) continue;
    if (!isPlainObject(value)) continue;
    out[key] = value;
  }
  return out;
}

function ensureTargetProfileAllowsPath(profile: Record<string, unknown>, targetPath: string): boolean {
  const security = isPlainObject(profile.security) ? profile.security : {};
  const editAllow = Array.isArray(security.edit_allow) ? security.edit_allow : [];
  const createAllow = Array.isArray(security.create_allow) ? security.create_allow : [];
  return [...editAllow, ...createAllow]
    .filter((value): value is string => isNonEmptyString(value))
    .some((rule) => patternsOverlap(rule, targetPath));
}

function determineRerouteTarget(decision: TaskValidationDecision): 'architect_inbox' | 'contract_editor' | null {
  switch (decision) {
    case 'requires_architectural_review':
      return 'architect_inbox';
    case 'requires_contract_change':
      return 'contract_editor';
    default:
      return null;
  }
}

export function checkTaskCollision(rootDir = process.cwd(), taskPath = ''): TaskCollisionCheckResult {
  const normalizedRoot = path.resolve(rootDir);
  const normalizedTaskPath = normalizePathLike(taskPath);
  const absoluteTaskPath = path.resolve(normalizedRoot, normalizedTaskPath);
  const result: TaskCollisionCheckResult = {
    ok: false,
    task_path: normalizedTaskPath,
    task_id: null,
    contract_sources: [APP_CONTRACT_MIRROR_INDEX_REL],
    collision_scan_result: 'invalid_contract_collision',
    conflicts: [],
    decision: 'invalid_contract_collision',
    reroute_target: null,
    notes: [],
  };

  if (isSelfRepo(normalizedRoot)) {
    result.collision_scan_result = 'insufficient_contract_context';
    result.decision = 'insufficient_contract_context';
    result.conflicts.push('public task-setting validation is not applicable inside the Frida self repository');
    result.notes.push('Frida self repo keeps internal core-task authoring under FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT.');
    return result;
  }

  if (!fs.existsSync(absoluteTaskPath) || !fs.statSync(absoluteTaskPath).isFile()) {
    result.conflicts.push(`task file not found: ${normalizedTaskPath}`);
    return result;
  }

  const parsed = parseFrontmatter(absoluteTaskPath);
  const filePathForErrors = rel(normalizedRoot, absoluteTaskPath);
  result.conflicts.push(...parsed.errors);
  if (!parsed.data) {
    return result;
  }

  result.task_id = isNonEmptyString(parsed.data.id) ? parsed.data.id : null;
  result.conflicts.push(...validateTaskPackData(filePathForErrors, parsed.data));

  let contract: Record<string, any>;
  try {
    contract = loadAppContractMirror(normalizedRoot);
  } catch (error) {
    result.collision_scan_result = 'insufficient_contract_context';
    result.decision = 'insufficient_contract_context';
    result.reroute_target = null;
    result.conflicts.push(`app contract mirror unavailable: ${error instanceof Error ? error.message : String(error)}`);
    result.notes.push('Task validation is mirror-only and cannot fall back to `.frida/inbox/app-contract/**`.');
    return result;
  }

  const profiles = getTaskProfiles(contract);
  const taskData = parsed.data as TaskPackFrontmatter;
  const targetProfile = profiles[taskData.target_profile];
  if (!targetProfile) {
    result.conflicts.push(`${filePathForErrors}: unknown target profile '${taskData.target_profile}'.`);
  }

  if (taskData.target_profile === 'app_contract_editor') {
    result.collision_scan_result = 'requires_contract_change';
    result.decision = 'requires_contract_change';
    result.reroute_target = determineRerouteTarget(result.decision);
    result.conflicts.push(`${filePathForErrors}: target profile 'app_contract_editor' indicates contract mutation rather than executable task work.`);
    return result;
  }

  const zones = collectZones(contract);
  const matchedZones = new Set<string>();
  for (const targetPath of Array.isArray(taskData.target_paths) ? taskData.target_paths : []) {
    const normalizedTargetPath = normalizePathLike(targetPath);
    if (normalizedTargetPath.startsWith('.frida/inbox/app-contract/')) {
      result.collision_scan_result = 'requires_contract_change';
      result.decision = 'requires_contract_change';
      result.reroute_target = determineRerouteTarget(result.decision);
      result.conflicts.push(`${filePathForErrors}: target path '${targetPath}' points at the app-contract authoring surface.`);
      return result;
    }
    if (normalizedTargetPath.startsWith('.frida/contract/app/')) {
      result.conflicts.push(`${filePathForErrors}: target path '${targetPath}' points at the read-only app contract mirror.`);
      continue;
    }

    const zonesForPath = zones.filter((zone) => patternsOverlap(zone.path, normalizedTargetPath));
    if (zonesForPath.length === 0) {
      result.conflicts.push(`${filePathForErrors}: target path '${targetPath}' does not belong to any declared zone.`);
    } else {
      zonesForPath.forEach((zone) => matchedZones.add(zone.id));
    }

    if (targetProfile && !ensureTargetProfileAllowsPath(targetProfile, normalizedTargetPath)) {
      result.conflicts.push(`${filePathForErrors}: target profile '${taskData.target_profile}' does not allow '${targetPath}'.`);
    }
  }

  if (matchedZones.size > 0) {
    result.notes.push(`matched zones: ${[...matchedZones].sort().join(', ')}`);
  }

  if (result.conflicts.length === 0) {
    result.ok = true;
    result.collision_scan_result = 'valid';
    result.decision = 'valid';
    result.notes.push('task pack is compatible with the app contract mirror.');
    return result;
  }

  result.collision_scan_result = result.decision;
  return result;
}

export function checkTaskPackSchema(rootDir = process.cwd()): TaskPackSchemaCheckResult {
  const normalizedRoot = path.resolve(rootDir);
  const selfRepo = isSelfRepo(normalizedRoot);
  const checkedFiles = selfRepo ? collectTaskFiles(normalizedRoot).filter((file) => file.startsWith('core-tasks/')) : collectTaskFiles(normalizedRoot);
  const errors: string[] = [];
  const notes: string[] = [];

  if (selfRepo) {
    if (exists(normalizedRoot, TASKS_DIR_REL)) {
      errors.push('tasks/: forbidden public task-setting surface detected inside the Frida self repository.');
    }
    notes.push('Public task-pack schema validation is not applicable to core-tasks inside the Frida self repository.');
    return {
      ok: errors.length === 0,
      self_repo: true,
      checked_files: checkedFiles,
      errors,
      notes,
    };
  }

  const forbiddenDir = path.join(normalizedRoot, 'core-tasks');
  if (fs.existsSync(forbiddenDir)) {
    errors.push('core-tasks/: forbidden Frida-core task surface detected in a target application repository.');
  }

  for (const relativeFile of checkedFiles) {
    const normalized = normalizePathLike(relativeFile);
    if (!/^tasks\/TASK-[^/]+\.md$/.test(normalized)) {
      errors.push(`${normalized}: task packs must live at tasks/TASK-*.md (nested task-pack paths are not allowed).`);
      continue;
    }
    const absoluteFile = path.join(normalizedRoot, normalized);
    const parsed = parseFrontmatter(absoluteFile);
    errors.push(...parsed.errors.map((message) => message.replace(absoluteFile, normalized)));
    if (!parsed.data) continue;
    errors.push(...validateTaskPackData(normalized, parsed.data));
  }

  return {
    ok: errors.length === 0,
    self_repo: false,
    checked_files: checkedFiles,
    errors,
    notes,
  };
}

function loadTaskRegistry(rootDir: string): { tasks: TaskRegistryEntry[]; errors: string[] } {
  const absolutePath = path.join(rootDir, TASK_REGISTRY_REL);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return { tasks: [], errors: [`${TASK_REGISTRY_REL}: missing normative task status registry.`] };
  }

  try {
    const parsed = yaml.parse(fs.readFileSync(absolutePath, 'utf8'));
    if (!isPlainObject(parsed)) {
      return { tasks: [], errors: [`${TASK_REGISTRY_REL}: registry must parse to an object.`] };
    }
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : null;
    if (!tasks) {
      return { tasks: [], errors: [`${TASK_REGISTRY_REL}: top-level 'tasks' array is required.`] };
    }
    return {
      tasks: tasks.filter((entry): entry is TaskRegistryEntry => isPlainObject(entry) && isNonEmptyString((entry as Record<string, unknown>).id)) as TaskRegistryEntry[],
      errors: [],
    };
  } catch (error) {
    return {
      tasks: [],
      errors: [`${TASK_REGISTRY_REL}: invalid YAML (${error instanceof Error ? error.message : String(error)}).`],
    };
  }
}

function validateRegistryEntry(rootDir: string, entry: TaskRegistryEntry, knownTaskIds: Set<string>): string[] {
  const errors: string[] = [];
  const requiredFields = ['id', 'status', 'spec_path', 'validation_artifact', 'latest_session_ref', 'supersedes', 'superseded_by', 'updated_at'];
  for (const field of requiredFields) {
    if (!(field in entry)) {
      errors.push(`${TASK_REGISTRY_REL}: entry '${entry.id}' is missing required field '${field}'.`);
    }
  }

  if (!TASK_REGISTRY_STATUSES.has(entry.status)) {
    errors.push(`${TASK_REGISTRY_REL}: entry '${entry.id}' has invalid status '${entry.status}'.`);
  }
  if (!isNonEmptyString(entry.spec_path) || !/^tasks\/TASK-[^/]+\.md$/.test(entry.spec_path)) {
    errors.push(`${TASK_REGISTRY_REL}: entry '${entry.id}' has invalid spec_path '${entry.spec_path}'.`);
  } else if (!exists(rootDir, entry.spec_path)) {
    errors.push(`${TASK_REGISTRY_REL}: entry '${entry.id}' points to missing spec_path '${entry.spec_path}'.`);
  }
  if (!isNonEmptyString(entry.validation_artifact) || !entry.validation_artifact.startsWith('.frida/reports/')) {
    errors.push(`${TASK_REGISTRY_REL}: entry '${entry.id}' has invalid validation_artifact '${entry.validation_artifact}'.`);
  } else if (!exists(rootDir, entry.validation_artifact)) {
    errors.push(`${TASK_REGISTRY_REL}: entry '${entry.id}' points to missing validation_artifact '${entry.validation_artifact}'.`);
  }
  if (entry.latest_session_ref !== null && entry.latest_session_ref !== undefined) {
    if (!isNonEmptyString(entry.latest_session_ref) || !entry.latest_session_ref.startsWith('tasks/sessions/')) {
      errors.push(`${TASK_REGISTRY_REL}: entry '${entry.id}' has invalid latest_session_ref '${String(entry.latest_session_ref)}'.`);
    } else if (!exists(rootDir, entry.latest_session_ref)) {
      errors.push(`${TASK_REGISTRY_REL}: entry '${entry.id}' points to missing latest_session_ref '${entry.latest_session_ref}'.`);
    }
  }
  for (const field of ['supersedes', 'superseded_by'] as const) {
    const value = entry[field];
    if (value !== null && value !== undefined) {
      if (!isNonEmptyString(value)) {
        errors.push(`${TASK_REGISTRY_REL}: entry '${entry.id}' field '${field}' must be a string or null.`);
      } else if (!knownTaskIds.has(value)) {
        errors.push(`${TASK_REGISTRY_REL}: entry '${entry.id}' references unknown task id '${value}' in '${field}'.`);
      }
    }
  }
  if (!isNonEmptyString(entry.updated_at)) {
    errors.push(`${TASK_REGISTRY_REL}: entry '${entry.id}' has invalid updated_at.`);
  }
  return errors;
}

function loadValidationArtifact(rootDir: string, relativePath: string): { artifact: TaskValidationArtifact | null; errors: string[] } {
  const absolutePath = path.join(rootDir, relativePath);
  try {
    const parsed = yaml.parse(fs.readFileSync(absolutePath, 'utf8'));
    if (!isPlainObject(parsed)) {
      return { artifact: null, errors: [`${relativePath}: validation artifact must parse to an object.`] };
    }
    return { artifact: parsed as unknown as TaskValidationArtifact, errors: [] };
  } catch (error) {
    return {
      artifact: null,
      errors: [`${relativePath}: invalid YAML (${error instanceof Error ? error.message : String(error)}).`],
    };
  }
}

function validateValidationArtifact(relativePath: string, artifact: TaskValidationArtifact, taskId: string): string[] {
  const errors: string[] = [];
  const requiredFields = ['task_id', 'validation_time', 'contract_sources', 'collision_scan_result', 'conflicts', 'decision', 'reroute_target', 'notes'];
  for (const field of requiredFields) {
    if (!(field in artifact)) {
      errors.push(`${relativePath}: missing required field '${field}'.`);
    }
  }
  if (artifact.task_id !== taskId) {
    errors.push(`${relativePath}: task_id '${artifact.task_id}' does not match registry entry '${taskId}'.`);
  }
  if (!isNonEmptyString(artifact.validation_time)) {
    errors.push(`${relativePath}: validation_time must be a non-empty string.`);
  }
  if (!isNonEmptyStringArray(artifact.contract_sources)) {
    errors.push(`${relativePath}: contract_sources must be a non-empty array of strings.`);
  } else if (artifact.contract_sources.some((source) => !source.startsWith('.frida/contract/app/'))) {
    errors.push(`${relativePath}: contract_sources must reference only .frida/contract/app/**.`);
  }
  if (!TASK_VALIDATION_DECISIONS.has(artifact.collision_scan_result)) {
    errors.push(`${relativePath}: collision_scan_result '${artifact.collision_scan_result}' is invalid.`);
  }
  if (!TASK_VALIDATION_DECISIONS.has(artifact.decision)) {
    errors.push(`${relativePath}: decision '${artifact.decision}' is invalid.`);
  }
  if (artifact.collision_scan_result !== artifact.decision) {
    errors.push(`${relativePath}: collision_scan_result and decision must match.`);
  }
  if (!Array.isArray(artifact.conflicts)) {
    errors.push(`${relativePath}: conflicts must be an array.`);
  }
  if (artifact.reroute_target !== null && artifact.reroute_target !== undefined && !isNonEmptyString(artifact.reroute_target)) {
    errors.push(`${relativePath}: reroute_target must be a string or null.`);
  }
  const notesValid = isNonEmptyString(artifact.notes) || isNonEmptyStringArray(artifact.notes, true);
  if (!(artifact.notes === null || artifact.notes === undefined || notesValid)) {
    errors.push(`${relativePath}: notes must be a string, an array of strings, or null.`);
  }
  return errors;
}

export function checkTaskSet(rootDir = process.cwd()): TaskSetCheckResult {
  const normalizedRoot = path.resolve(rootDir);
  const selfRepo = isSelfRepo(normalizedRoot);
  const errors: string[] = [];
  const notes: string[] = [];

  if (selfRepo) {
    if (exists(normalizedRoot, TASKS_DIR_REL)) {
      errors.push('tasks/: forbidden public task-setting surface detected inside the Frida self repository.');
    }
    notes.push('Public task-set integrity checks are skipped inside the Frida self repository.');
    return {
      ok: errors.length === 0,
      self_repo: true,
      task_files: collectTaskFiles(normalizedRoot).filter((file) => file.startsWith('core-tasks/')),
      registry_path: null,
      errors,
      notes,
    };
  }

  if (exists(normalizedRoot, 'core-tasks')) {
    errors.push('core-tasks/: forbidden Frida-core task surface detected in a target application repository.');
  }

  const taskSchema = checkTaskPackSchema(normalizedRoot);
  errors.push(...taskSchema.errors);

  const taskFiles = taskSchema.checked_files;
  const registryExists = exists(normalizedRoot, TASK_REGISTRY_REL);
  const hasSessionsSurface = exists(normalizedRoot, TASK_SESSIONS_DIR_REL);
  const hasInboxSurface = exists(normalizedRoot, 'tasks/inbox');

  if ((taskFiles.length > 0 || hasSessionsSurface || hasInboxSurface || registryExists) && !registryExists) {
    errors.push(`${TASK_REGISTRY_REL}: required whenever tasks/, tasks/inbox/, or tasks/sessions/ are present.`);
  }

  const registry = loadTaskRegistry(normalizedRoot);
  errors.push(...(registryExists ? registry.errors : []));
  const registryEntries = registry.tasks;
  const registryById = new Map(registryEntries.map((entry) => [entry.id, entry]));
  const knownTaskIds = new Set(registryEntries.map((entry) => entry.id));

  for (const entry of registryEntries) {
    errors.push(...validateRegistryEntry(normalizedRoot, entry, knownTaskIds));
    if (isNonEmptyString(entry.validation_artifact) && exists(normalizedRoot, entry.validation_artifact)) {
      const artifactResult = loadValidationArtifact(normalizedRoot, entry.validation_artifact);
      errors.push(...artifactResult.errors);
      if (artifactResult.artifact) {
        errors.push(...validateValidationArtifact(entry.validation_artifact, artifactResult.artifact, entry.id));
      }
    }
  }

  for (const taskFile of taskFiles) {
    const taskId = path.basename(taskFile).replace(/^TASK-/, '').replace(/\.md$/, '');
    const registryEntry = registryById.get(taskId);
    if (!registryEntry) {
      errors.push(`${TASK_REGISTRY_REL}: missing registry entry for task '${taskId}'.`);
      continue;
    }
    if (registryEntry.spec_path !== taskFile) {
      errors.push(`${TASK_REGISTRY_REL}: entry '${taskId}' spec_path must equal '${taskFile}'.`);
    }
    const collision = checkTaskCollision(normalizedRoot, taskFile);
    if (!collision.ok) {
      errors.push(...collision.conflicts.map((conflict) => `${taskFile}: ${conflict}`));
    }
  }

  if (!registryExists && taskFiles.length === 0) {
    notes.push('No target-app task-set surfaces detected.');
  }

  return {
    ok: errors.length === 0,
    self_repo: false,
    task_files: taskFiles,
    registry_path: registryExists ? TASK_REGISTRY_REL : null,
    errors,
    notes,
  };
}

function parseCliArgs(args: string[]): CheckCliArgs {
  const result: CheckCliArgs = {
    taskPath: null,
    format: 'text',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--task' && index + 1 < args.length) {
      result.taskPath = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--format' && index + 1 < args.length) {
      const format = args[index + 1];
      if (format === 'text' || format === 'json' || format === 'yaml') {
        result.format = format;
      }
      index += 1;
    }
  }

  return result;
}

function formatPayload(payload: unknown, format: 'text' | 'json' | 'yaml', onText: () => string): string {
  if (format === 'json') {
    return JSON.stringify(payload, null, 2);
  }
  if (format === 'yaml') {
    return yaml.stringify(payload);
  }
  return onText();
}

export function runFridaTaskCollisionCli(args: string[] = [], options: { rootDir?: string } = {}): number {
  const parsed = parseCliArgs(args);
  if (!parsed.taskPath) {
    console.error('Missing required flag: --task <path>');
    return 2;
  }

  const result = checkTaskCollision(options.rootDir || process.cwd(), parsed.taskPath);
  console.log(
    formatPayload(result, parsed.format, () => {
      if (result.ok) {
        return `✅ ${result.task_path}: valid`;
      }
      return `❌ ${result.task_path}: ${result.decision}\n${result.conflicts.map((conflict) => `- ${conflict}`).join('\n')}`;
    })
  );

  return result.ok ? 0 : 1;
}

export function runFridaTaskSetCli(args: string[] = [], options: { rootDir?: string } = {}): number {
  const parsed = parseCliArgs(args);
  const result = checkTaskSet(options.rootDir || process.cwd());
  console.log(
    formatPayload(result, parsed.format, () => {
      if (result.ok) {
        return `✅ Task-set check passed (${result.self_repo ? 'self-repo mode' : `${result.task_files.length} task file(s)`})`;
      }
      return `❌ Task-set check failed\n${result.errors.map((error) => `- ${error}`).join('\n')}`;
    })
  );

  return result.ok ? 0 : 1;
}
