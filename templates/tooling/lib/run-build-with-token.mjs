#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { PACKAGE_ROOT, acquireBuildToken, releaseBuildToken } from './build-token.mjs';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: PACKAGE_ROOT,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tscBin = process.platform === 'win32' ? 'node_modules/.bin/tsc.cmd' : 'node_modules/.bin/tsc';

try {
  acquireBuildToken();
  run(npmBin, ['run', 'clean']);
  run(tscBin, ['-p', 'tsconfig.build.json']);
  run(process.execPath, ['templates/tooling/lib/build-optional-visualizer.mjs']);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  releaseBuildToken();
}
