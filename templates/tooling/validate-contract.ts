#!/usr/bin/env tsx
import { runFridaValidateCli } from '@frida-framework/core';

process.exit(runFridaValidateCli(process.argv.slice(2), { rootDir: process.cwd() }));
