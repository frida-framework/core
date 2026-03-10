#!/usr/bin/env node
/**
 * Validate contract Task Pack schema for repo-scoped TASK-*.md files.
 *
 * Rules:
 * - In repo `frida`, only frida-tasks/TASK-<ID>.md is allowed; tasks/ is forbidden
 * - Outside repo `frida`, only tasks/TASK-<ID>.md is allowed; frida-tasks/ is forbidden
 * - YAML frontmatter is required
 * - Required fields:
 *   id, status, profile_id, interface_ref, title, summary, acceptance_criteria, verification_cmd
 * - Allowed status values: OPEN | DONE | DRIFT
 * - profile_id must be a key from the repository-scoped profile block
 * - interface_ref must match the allowed management interface for the current repo scope
 * - zone_hint is optional, but if present must be a non-empty string
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import path from 'node:path';
import YAML from 'yaml';
import { loadModularContract } from '../lib/load-contract.mjs';

const ROOT_DIR = path.resolve(process.cwd());
const TASK_FILE_RE = /^TASK-([A-Za-z0-9._-]+)\.md$/;
const REQUIRED_FIELDS = [
  'id',
  'status',
  'profile_id',
  'interface_ref',
  'title',
  'summary',
  'acceptance_criteria',
  'verification_cmd',
];
const ALLOWED_STATUS = new Set(['OPEN', 'DONE', 'DRIFT']);

function isFridaSelfRepo() {
  try {
    const packageJson = JSON.parse(requireText(path.join(ROOT_DIR, 'package.json')));
    return packageJson?.name === '@frida-framework/core' && existsSync(path.join(ROOT_DIR, 'contract', 'contract.index.yaml'));
  } catch {
    return false;
  }
}

function requireText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function resolveTaskSurface() {
  const selfRepo = isFridaSelfRepo();
  return {
    selfRepo,
    tasksDir: selfRepo ? 'frida-tasks' : 'tasks',
    forbiddenDir: selfRepo ? 'tasks' : 'frida-tasks',
    allowedInterfaces: selfRepo
      ? new Set(['FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT'])
      : new Set(['FRIDA_INTERFACE_UPDATE_APP_BY_SPEC', 'FRIDA_INTERFACE_UPDATE_APP_BY_CODE']),
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseFrontmatter(content, filePath) {
  if (!content.startsWith('---')) {
    return {
      errors: [
        `${filePath}: missing YAML frontmatter. Add a frontmatter block delimited by '---' at top of file.`,
      ],
      data: null,
    };
  }

  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return {
      errors: [
        `${filePath}: malformed YAML frontmatter. Ensure opening and closing '---' delimiters are present.`,
      ],
      data: null,
    };
  }

  try {
    const data = YAML.parse(match[1]);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        errors: [
          `${filePath}: frontmatter must parse to a YAML object (mapping).`,
        ],
        data: null,
      };
    }
    return { errors: [], data };
  } catch (error) {
    return {
      errors: [
        `${filePath}: invalid YAML in frontmatter (${error.message}).`,
      ],
      data: null,
    };
  }
}

function validateTaskPack({ filePath, fileName, data, knownProfiles, allowedInterfaces }) {
  const errors = [];
  const idFromFile = fileName.replace(/^TASK-/, '').replace(/\.md$/, '');

  for (const field of REQUIRED_FIELDS) {
    if (!(field in data)) {
      errors.push(
        `${filePath}: missing required frontmatter field '${field}'.`
      );
    }
  }

  if ('id' in data) {
    if (!isNonEmptyString(data.id)) {
      errors.push(`${filePath}: 'id' must be a non-empty string.`);
    } else if (data.id !== idFromFile) {
      errors.push(
        `${filePath}: 'id' must match file name ID ('${idFromFile}').`
      );
    }
  }

  if ('status' in data && !ALLOWED_STATUS.has(data.status)) {
    errors.push(
      `${filePath}: invalid 'status' value '${data.status}'. Allowed values: OPEN, DONE, DRIFT.`
    );
  }

  if ('profile_id' in data) {
    if (!isNonEmptyString(data.profile_id)) {
      errors.push(`${filePath}: 'profile_id' must be a non-empty string.`);
    } else if (!knownProfiles.has(data.profile_id)) {
      errors.push(
        `${filePath}: unknown 'profile_id' '${data.profile_id}'. Must be one of the repository-scoped profile ids: ${[...knownProfiles].sort().join(', ')}.`
      );
    }
  }

  if ('interface_ref' in data) {
    if (!isNonEmptyString(data.interface_ref)) {
      errors.push(`${filePath}: 'interface_ref' must be a non-empty string.`);
    } else if (!allowedInterfaces.has(data.interface_ref)) {
      errors.push(
        `${filePath}: invalid 'interface_ref' '${data.interface_ref}'. Allowed values for this repo: ${[...allowedInterfaces].sort().join(', ')}.`
      );
    }
  }

  if ('zone_hint' in data && data.zone_hint !== null && !isNonEmptyString(data.zone_hint)) {
    errors.push(`${filePath}: 'zone_hint' must be a non-empty string when provided.`);
  }

  if ('title' in data && !isNonEmptyString(data.title)) {
    errors.push(`${filePath}: 'title' must be a non-empty string.`);
  }

  if ('summary' in data && !isNonEmptyString(data.summary)) {
    errors.push(`${filePath}: 'summary' must be a non-empty string.`);
  }

  if ('verification_cmd' in data && !isNonEmptyString(data.verification_cmd)) {
    errors.push(`${filePath}: 'verification_cmd' must be a non-empty string.`);
  }

  if ('acceptance_criteria' in data) {
    if (!Array.isArray(data.acceptance_criteria) || data.acceptance_criteria.length === 0) {
      errors.push(`${filePath}: 'acceptance_criteria' must be a non-empty array of strings.`);
    } else {
      data.acceptance_criteria.forEach((item, index) => {
        if (!isNonEmptyString(item)) {
          errors.push(
            `${filePath}: 'acceptance_criteria[${index}]' must be a non-empty string.`
          );
        }
      });
    }
  }

  return errors;
}

async function loadKnownTaskProfiles() {
  const contract = loadModularContract(ROOT_DIR);
  const taskProfiles = contract?.TASK_PROFILES
    || (contract?.FRIDA_TASK_PROFILES && typeof contract.FRIDA_TASK_PROFILES === 'object'
      ? Object.fromEntries(
          Object.entries(contract.FRIDA_TASK_PROFILES).filter(([key]) => !['_visibility', 'id', 'version'].includes(key))
        )
      : null);

  if (!taskProfiles || typeof taskProfiles !== 'object' || Array.isArray(taskProfiles)) {
    throw new Error(
      `Could not read TASK_PROFILES or FRIDA_TASK_PROFILES from modular contract.`
    );
  }

  return new Set(Object.keys(taskProfiles));
}

async function main() {
  const { tasksDir, forbiddenDir, allowedInterfaces } = resolveTaskSurface();

  if (existsSync(path.join(ROOT_DIR, forbiddenDir))) {
    console.error(`❌ Forbidden task surface detected: ${forbiddenDir}/`);
    process.exit(1);
  }

  let knownProfiles;
  try {
    knownProfiles = await loadKnownTaskProfiles();
  } catch (error) {
    console.error(`❌ Failed to load task profile keys: ${error.message}`);
    process.exit(1);
  }

  let entries = [];
  try {
    entries = await readdir(tasksDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.log(`✅ No ${tasksDir}/TASK-*.md files found; Task Pack schema check passed.`);
      return;
    }
    throw error;
  }
  const taskFiles = entries
    .filter((entry) => entry.isFile() && TASK_FILE_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (taskFiles.length === 0) {
    console.log(`✅ No ${tasksDir}/TASK-*.md files found; Task Pack schema check passed.`);
    return;
  }

  const violations = [];

  for (const fileName of taskFiles) {
    const filePath = path.join(tasksDir, fileName).replace(/\\/g, '/');
    const raw = await readFile(filePath, 'utf8');
    const parsed = parseFrontmatter(raw, filePath);

    if (parsed.errors.length > 0) {
      violations.push(...parsed.errors);
      continue;
    }

    const fileErrors = validateTaskPack({
      filePath,
      fileName,
      data: parsed.data,
      knownProfiles,
      allowedInterfaces,
    });
    violations.push(...fileErrors);
  }

  if (violations.length > 0) {
    console.error('❌ Task Pack schema validation failed:\n');
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    console.error(`\nFix the listed frontmatter issues in ${tasksDir}/TASK-*.md files.`);
    process.exit(1);
  }

  console.log(`✅ Task Pack schema valid for ${taskFiles.length} file(s).`);
}

main().catch((error) => {
  console.error(`❌ Unexpected error during Task Pack schema validation: ${error.message}`);
  process.exit(1);
});
