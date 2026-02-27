#!/usr/bin/env node
/**
 * Enforce append-only telemetry reports under tasks/sessions/.
 *
 * Rules:
 * - Existing report files are immutable (no modify/delete/rename).
 * - New report files are allowed only as direct children:
 *   tasks/sessions/<name>.md
 * - <name> must start with unix time:
 *   ^([0-9]{10}|[0-9]{13})([_-].+)?$
 * - README.md and .gitkeep are exempt.
 *
 * Usage:
 *   node scripts/verify/tasks-sessions-append-only.mjs
 *
 * Environment:
 *   BASE_REF - Git ref to compare against (default: "origin/main...HEAD")
 *
 * Exit codes:
 *   0 - No violations
 *   1 - Violations found
 */

import { execSync } from 'node:child_process';

const BASE_REF = process.env.BASE_REF || 'origin/main...HEAD';
const SESSIONS_ROOT = 'tasks/sessions/';
const SESSIONS_README = 'tasks/sessions/README.md';
const SESSIONS_GITKEEP = 'tasks/sessions/.gitkeep';
const REPORT_NAME_PATTERN = /^([0-9]{10}|[0-9]{13})([_-].+)?$/;
const REPORT_PATH_PATTERN = /^tasks\/sessions\/[^/]+\.md$/;

console.log('🔍 Checking append-only rules for tasks/sessions/ telemetry...\n');

function getChangedFiles() {
  try {
    const output = execSync(`git diff --name-status ${BASE_REF}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim();
  } catch (error) {
    if (error.stdout) {
      return error.stdout.toString().trim();
    }
    return '';
  }
}

function isExempt(filePath) {
  return filePath === SESSIONS_README || filePath === SESSIONS_GITKEEP;
}

function isUnderSessions(filePath) {
  return typeof filePath === 'string' && filePath.startsWith(SESSIONS_ROOT);
}

function isValidNewReportPath(filePath) {
  if (!REPORT_PATH_PATTERN.test(filePath)) return false;
  const fileName = filePath.split('/').pop();
  if (!fileName || !fileName.endsWith('.md')) return false;
  const baseName = fileName.slice(0, -3);
  return REPORT_NAME_PATTERN.test(baseName);
}

function parseDiff(output) {
  if (!output) return [];

  const lines = output.split('\n').filter(Boolean);
  const violations = [];

  for (const line of lines) {
    const parts = line.split('\t');
    const statusRaw = parts[0]?.trim();
    if (!statusRaw) continue;

    const status = statusRaw.charAt(0);
    const oldPath = parts[1]?.trim();
    const newPath = parts[2]?.trim();

    if (status === 'R') {
      const renameTouchesSessions = isUnderSessions(oldPath) || isUnderSessions(newPath);
      if (!renameTouchesSessions) continue;

      const exemptRename =
        (isExempt(oldPath) && isExempt(newPath)) ||
        (!oldPath && isExempt(newPath)) ||
        (isExempt(oldPath) && !newPath);
      if (exemptRename) continue;

      violations.push({
        file: `${oldPath || '(unknown)'} -> ${newPath || '(unknown)'}`,
        status: 'R',
        reason: 'renamed',
      });
      continue;
    }

    const filePath = oldPath;
    if (!isUnderSessions(filePath)) continue;
    if (isExempt(filePath)) continue;

    const isMd = filePath.endsWith('.md');
    if (!isMd) {
      violations.push({
        file: filePath,
        status,
        reason: 'non-markdown file is not allowed in tasks/sessions/',
      });
      continue;
    }

    if (status === 'A') {
      if (!isValidNewReportPath(filePath)) {
        violations.push({
          file: filePath,
          status,
          reason: 'new file has invalid name or location',
        });
      }
      continue;
    }

    if (status === 'M' || status === 'D') {
      violations.push({
        file: filePath,
        status,
        reason: status === 'M' ? 'modified existing report' : 'deleted existing report',
      });
      continue;
    }

    violations.push({
      file: filePath,
      status,
      reason: `unsupported change status '${status}' in append-only directory`,
    });
  }

  return violations;
}

const diffOutput = getChangedFiles();
const violations = parseDiff(diffOutput);

if (violations.length > 0) {
  console.error('❌ tasks/sessions append-only violations detected:\n');
  for (const violation of violations) {
    console.error(`   ${violation.file} [${violation.status}] (${violation.reason})`);
  }

  console.error('\nRequired rules for tasks/sessions/:');
  console.error('  ✓ Add only new files: tasks/sessions/<name>.md');
  console.error('  ✓ <name> must match: ^([0-9]{10}|[0-9]{13})([_-].+)?$');
  console.error('  ✓ README.md and .gitkeep are exempt');
  console.error('  ✗ Do not modify, delete, or rename existing report files');
  console.error('  ✗ Do not add subdirectories or non-.md report files\n');
  process.exit(1);
}

console.log('✅ No tasks/sessions append-only violations detected\n');
process.exit(0);
