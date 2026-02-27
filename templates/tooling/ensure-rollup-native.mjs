import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const linuxX64 = process.platform === 'linux' && process.arch === 'x64';

if (!linuxX64) {
  process.exit(0);
}

const isGlibc = () => {
  if (process.report?.getReport) {
    try {
      const report = process.report.getReport();
      return Boolean(report?.header?.glibcVersionRuntime);
    } catch {
      return false;
    }
  }
  return false;
};

const candidates = isGlibc()
  ? ['@rollup/rollup-linux-x64-gnu', '@rollup/rollup-linux-x64-musl']
  : ['@rollup/rollup-linux-x64-musl', '@rollup/rollup-linux-x64-gnu'];

const hasNativePackage = () => {
  for (const pkg of candidates) {
    try {
      require.resolve(`${pkg}/package.json`);
      return true;
    } catch {
      // Try next candidate.
    }
  }
  return false;
};

const rollupVersion = require('rollup/package.json').version;
const npmBinary = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const canLoadRollup = () => {
  try {
    require('rollup');
    return true;
  } catch {
    return false;
  }
};

if (hasNativePackage() && canLoadRollup()) {
  process.exit(0);
}

for (const pkg of candidates) {
  console.log(`[ensure-rollup-native] Installing ${pkg}@${rollupVersion}...`);
  execFileSync(
    npmBinary,
    ['install', '--no-save', '--ignore-scripts', `${pkg}@${rollupVersion}`],
    { stdio: 'inherit' }
  );

  if (canLoadRollup()) {
    process.exit(0);
  }
}

throw new Error('[ensure-rollup-native] Failed to load Rollup native binding on linux-x64.');
