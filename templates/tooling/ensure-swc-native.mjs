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

const swcVersion = require('@swc/core/package.json').version;
const npmBinary = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const candidates = isGlibc()
  ? ['@swc/core-linux-x64-gnu', '@swc/core-linux-x64-musl']
  : ['@swc/core-linux-x64-musl', '@swc/core-linux-x64-gnu'];

const hasPackage = (name) => {
  try {
    require.resolve(`${name}/package.json`);
    return true;
  } catch {
    return false;
  }
};

const installPackage = (name) => {
  console.log(`[ensure-swc-native] Installing ${name}@${swcVersion}...`);
  execFileSync(
    npmBinary,
    ['install', '--no-save', '--ignore-scripts', `${name}@${swcVersion}`],
    { stdio: 'inherit' }
  );
};

const canLoadSwcCore = () => {
  try {
    require('@swc/core');
    return true;
  } catch {
    return false;
  }
};

for (const pkg of candidates) {
  if (!hasPackage(pkg)) {
    installPackage(pkg);
  } else {
    console.log(`[ensure-swc-native] ${pkg} is already installed.`);
  }

  if (canLoadSwcCore()) {
    process.exit(0);
  }
}

throw new Error('[ensure-swc-native] Failed to load @swc/core native binding on linux-x64.');

