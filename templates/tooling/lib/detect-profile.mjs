#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

export async function detectProfile() {
  const signals = [];
  let profile = 'codex-cloud';
  let recommendedCommand = 'npm run test:fast';
  let recommendedLevel = 'L1-L2';
  let note = 'Профиль не распознан, выбран безопасный default codex-cloud.';

  if (process.env.GITHUB_ACTIONS === 'true') {
    profile = 'github-actions';
    recommendedCommand = 'npm run test:full';
    recommendedLevel = 'L0-L2';
    signals.push('GITHUB_ACTIONS=true');
    note = 'CI окружение GitHub Actions.';
  } else if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
    profile = 'codex-console-wsl';
    recommendedCommand = 'npm run test:full';
    recommendedLevel = 'L0-L2';
    signals.push('WSL_DISTRO_NAME or WSL_INTEROP обнаружен');
    note = 'Обнаружен WSL, используем профиль codex-console-wsl.';
  } else {
    const procVersion = await readProcVersion();
    if (procVersion.includes('Microsoft')) {
      profile = 'codex-console-wsl';
      recommendedCommand = 'npm run test:full';
      recommendedLevel = 'L0-L2';
      signals.push('/proc/version содержит "Microsoft"');
      note = 'Обнаружен WSL по содержимому /proc/version.';
    } else if (
      process.platform === 'win32' &&
      ((process.env.TERM_PROGRAM || '').toLowerCase().includes('vscode') || process.env.VSCODE_PID)
    ) {
      profile = 'kilo-vscode';
      recommendedCommand = 'npm run test:smoke';
      recommendedLevel = 'L2 (smoke)';
      signals.push('platform=win32 + VSCode markers');
      note = 'Windows + VSCode/PowerShell окружение.';
    }
  }

  return {
    profile,
    signals: signals.length ? signals : ['нет явных сигналов, применен default'],
    recommendedCommand,
    recommendedLevel,
    note,
  };
}

async function readProcVersion() {
  try {
    const contents = await readFile('/proc/version', 'utf8');
    return contents;
  } catch (error) {
    return '';
  }
}
