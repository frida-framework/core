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

const canLoadBuildToolchain = () => {
  try {
    execFileSync(process.execPath, ['-e', 'require("rollup");require("@swc/core")'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const npmBinary = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rollupVersion = require('rollup/package.json').version;
const swcVersion = require('@swc/core/package.json').version;
const candidates = isGlibc()
  ? [
      { rollup: '@rollup/rollup-linux-x64-gnu', swc: '@swc/core-linux-x64-gnu' },
      { rollup: '@rollup/rollup-linux-x64-musl', swc: '@swc/core-linux-x64-musl' }
    ]
  : [
      { rollup: '@rollup/rollup-linux-x64-musl', swc: '@swc/core-linux-x64-musl' },
      { rollup: '@rollup/rollup-linux-x64-gnu', swc: '@swc/core-linux-x64-gnu' }
    ];

if (canLoadBuildToolchain()) {
  console.log('[ensure-native-bindings] Rollup and SWC native bindings are available.');
  process.exit(0);
}

const installErrors = [];

for (const candidate of candidates) {
  const toInstall = [`${candidate.rollup}@${rollupVersion}`, `${candidate.swc}@${swcVersion}`];
  try {
    console.log(`[ensure-native-bindings] Installing: ${toInstall.join(', ')}`);
    execFileSync(npmBinary, ['install', '--no-save', '--ignore-scripts', ...toInstall], { stdio: 'inherit' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    installErrors.push(`candidate ${candidate.rollup} + ${candidate.swc}: ${message}`);
    console.warn(`[ensure-native-bindings] Candidate failed, trying next libc variant: ${candidate.rollup}, ${candidate.swc}`);
    continue;
  }

  if (canLoadBuildToolchain()) {
    process.exit(0);
  }
}

const details = installErrors.length > 0 ? `\n${installErrors.join('\n')}` : '';
throw new Error(`[ensure-native-bindings] Failed to load Rollup/SWC native bindings on linux-x64.${details}`);
