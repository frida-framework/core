#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');
export const BUILD_TOKEN_REL_PATH = '.frida-build.token';
export const BUILD_TOKEN_ABS_PATH = path.join(PACKAGE_ROOT, BUILD_TOKEN_REL_PATH);

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readBuildToken() {
  if (!fs.existsSync(BUILD_TOKEN_ABS_PATH) || !fs.statSync(BUILD_TOKEN_ABS_PATH).isFile()) {
    return null;
  }

  const raw = fs.readFileSync(BUILD_TOKEN_ABS_PATH, 'utf-8');
  const parsed = safeJsonParse(raw);
  return {
    path: BUILD_TOKEN_ABS_PATH,
    raw,
    parsed,
  };
}

export function formatBuildTokenMessage(token) {
  if (!token) {
    return `build token not found: ${BUILD_TOKEN_REL_PATH}`;
  }

  const lines = [
    `build token is present: ${BUILD_TOKEN_REL_PATH}`,
  ];

  const parsed = token.parsed;
  if (parsed && typeof parsed === 'object') {
    if (typeof parsed.pid === 'number') {
      lines.push(`pid=${parsed.pid}`);
    }
    if (typeof parsed.startedAt === 'string') {
      lines.push(`startedAt=${parsed.startedAt}`);
    }
    if (Array.isArray(parsed.argv) && parsed.argv.length > 0) {
      lines.push(`argv=${parsed.argv.join(' ')}`);
    }
  }

  lines.push('Another build is already running or terminated without cleanup. Remove the token only after confirming no build is active.');
  return lines.join('\n');
}

export function assertNoBuildToken() {
  const token = readBuildToken();
  if (!token) {
    return;
  }

  const error = new Error(formatBuildTokenMessage(token));
  error.code = 'BUILD_TOKEN_PRESENT';
  throw error;
}

export function acquireBuildToken() {
  const payload = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    argv: process.argv.slice(1),
  };

  let fd;
  try {
    fd = fs.openSync(BUILD_TOKEN_ABS_PATH, 'wx');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      assertNoBuildToken();
    }
    throw error;
  }

  try {
    fs.writeFileSync(fd, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

export function releaseBuildToken() {
  fs.rmSync(BUILD_TOKEN_ABS_PATH, { force: true });
}
