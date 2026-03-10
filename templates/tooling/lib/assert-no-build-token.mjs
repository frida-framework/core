#!/usr/bin/env node
import { assertNoBuildToken } from './build-token.mjs';

try {
  assertNoBuildToken();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
