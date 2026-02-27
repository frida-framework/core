#!/usr/bin/env node
/**
 * Validate contract Task Pack schema for tasks/TASK-*.md files.
 *
 * Rules:
 * - File name must match tasks/TASK-<ID>.md
 * - YAML frontmatter is required
 * - Required fields:
 *   id, status, profile_id, title, summary, acceptance_criteria, verification_cmd
 * - Allowed status values: OPEN | DONE | DRIFT
 * - profile_id must be a key from contract TASK_PROFILES
 * - zone_hint is optional, but if present must be a non-empty string
 */

import { readdir, readFile } from 'node:fs/promises';
import process from 'node:process';
import path from 'node:path';
import YAML from 'yaml';
import { loadModularContract } from '../lib/load-contract.mjs';

const TASKS_DIR = 'tasks';
const ROOT_DIR = path.resolve(process.cwd());
const TASK_FILE_RE = /^TASK-([A-Za-z0-9._-]+)\.md$/;
const REQUIRED_FIELDS = [
  'id',
  'status',
  'profile_id',
  'title',
  'summary',
  'acceptance_criteria',
  'verification_cmd',
];
const ALLOWED_STATUS = new Set(['OPEN', 'DONE', 'DRIFT']);

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

function validateTaskPack({ filePath, fileName, data, knownProfiles }) {
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
        `${filePath}: unknown 'profile_id' '${data.profile_id}'. Must be one of TASK_PROFILES keys: ${[...knownProfiles].sort().join(', ')}.`
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
  const taskProfiles = contract?.TASK_PROFILES;

  if (!taskProfiles || typeof taskProfiles !== 'object' || Array.isArray(taskProfiles)) {
    throw new Error(
      `Could not read TASK_PROFILES from modular contract.`
    );
  }

  return new Set(Object.keys(taskProfiles));
}

async function main() {
  let knownProfiles;
  try {
    knownProfiles = await loadKnownTaskProfiles();
  } catch (error) {
    console.error(`❌ Failed to load task profile keys: ${error.message}`);
    process.exit(1);
  }

  const entries = await readdir(TASKS_DIR, { withFileTypes: true });
  const taskFiles = entries
    .filter((entry) => entry.isFile() && TASK_FILE_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (taskFiles.length === 0) {
    console.log('✅ No tasks/TASK-*.md files found; Task Pack schema check passed.');
    return;
  }

  const violations = [];

  for (const fileName of taskFiles) {
    const filePath = path.join(TASKS_DIR, fileName).replace(/\\/g, '/');
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
    });
    violations.push(...fileErrors);
  }

  if (violations.length > 0) {
    console.error('❌ Task Pack schema validation failed:\n');
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    console.error('\nFix the listed frontmatter issues in tasks/TASK-*.md files.');
    process.exit(1);
  }

  console.log(`✅ Task Pack schema valid for ${taskFiles.length} file(s).`);
}

main().catch((error) => {
  console.error(`❌ Unexpected error during Task Pack schema validation: ${error.message}`);
  process.exit(1);
});
