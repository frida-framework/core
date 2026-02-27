#!/usr/bin/env node
/**
 * Enforce immutability of TASK-*.md files in the tasks directory.
 *
 * This script fails if any existing file matching tasks/TASK-.md or
 * tasks/subdir/TASK-.md is modified or deleted.
 * New TASK-.md files are allowed (additions only).
 *
 * Usage:
 *   node scripts/verify/tasks-taskpacks-immutable.mjs
 *
 * Environment:
 *   BASE_REF - Git ref to compare against (default: "origin/main...HEAD")
 *
 * Exit codes:
 *   0 - No violations (only additions or no changes)
 *   1 - Violations found (modifications or deletions detected)
 */

import { execSync } from 'node:child_process';

const BASE_REF = process.env.BASE_REF || 'origin/main...HEAD';
const TASK_FILE_PATTERN = /^tasks\/.*\/TASK-.*\.md$/;
// Also match files directly in tasks/ root
const TASK_FILE_ROOT_PATTERN = /^tasks\/TASK-.*\.md$/;

// Status codes that indicate immutability violations
const VIOLATION_STATUSES = ['M', 'D', 'R'];

console.log('🔍 Checking immutability of TASK-*.md files in tasks/...\n');

function getChangedFiles() {
  try {
    const output = execSync(
      `git diff --name-status ${BASE_REF}`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    return output.trim();
  } catch (error) {
    // If git diff fails (e.g., no commits, no diff), return empty
    if (error.stdout) {
      return error.stdout.toString().trim();
    }
    return '';
  }
}

function parseGitDiff(output) {
  if (!output) return [];
  
  const lines = output.split('\n').filter(line => line.trim());
  const violations = [];
  
  for (const line of lines) {
    // Parse git diff --name-status output
    // Format: STATUS\tPATH (for most cases)
    // Format: STATUS\tOLD_PATH\tNEW_PATH (for renames with percentage)
    const parts = line.split('\t');
    const status = parts[0]?.trim();
    const filePath = parts[1]?.trim();
    
    if (!status || !filePath) continue;
    
    // Check if this is a TASK-*.md file
    const isTaskFile = TASK_FILE_PATTERN.test(filePath) || TASK_FILE_ROOT_PATTERN.test(filePath);
    
    if (!isTaskFile) continue;
    
    // Check for violation statuses
    const statusChar = status.charAt(0);
    if (VIOLATION_STATUSES.includes(statusChar)) {
      let reason;
      switch (statusChar) {
        case 'M':
          reason = 'modified';
          break;
        case 'D':
          reason = 'deleted';
          break;
        case 'R':
          reason = 'renamed';
          break;
        default:
          reason = 'changed';
      }
      violations.push({ file: filePath, status: statusChar, reason });
    }
  }
  
  return violations;
}

const diffOutput = getChangedFiles();
const violations = parseGitDiff(diffOutput);

if (violations.length > 0) {
  console.error('❌ TASK-*.md immutability violations detected:\n');
  
  for (const violation of violations) {
    console.error(`   ${violation.file} (${violation.reason})`);
  }
  
  console.error('\nTASK-*.md files are immutable once created.');
  console.error('Allowed actions:');
  console.error('  ✓ Add new TASK-*.md files');
  console.error('  ✗ Modify existing TASK-*.md files');
  console.error('  ✗ Delete existing TASK-*.md files');
  console.error('  ✗ Rename existing TASK-*.md files');
  console.error('\nIf you need to update a task, create a new TASK-*.md file instead.\n');
  process.exit(1);
} else {
  console.log('✅ No TASK-*.md immutability violations detected\n');
  process.exit(0);
}
