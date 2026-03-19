#!/usr/bin/env node
/**
 * Validate the public target-app Task Pack schema.
 *
 * This wrapper intentionally delegates to the compiled core implementation so
 * `frida-core check task-set` and the standalone verifier share the same rules.
 */

import process from 'node:process';
import { checkTaskPackSchema } from '../../../dist/task-set-check.js';

const result = checkTaskPackSchema(process.cwd());

if (result.ok) {
  if (result.self_repo) {
    console.log('✅ Public task-pack schema validation skipped in the Frida self repository');
  } else {
    console.log(`✅ Task Pack schema valid for ${result.checked_files.length} file(s).`);
  }
  process.exit(0);
}

console.error('❌ Task Pack schema validation failed:\n');
for (const error of result.errors) {
  console.error(`- ${error}`);
}
process.exit(1);
