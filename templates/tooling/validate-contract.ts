#!/usr/bin/env tsx
import { runFridaValidateCli } from '@sistemado/frida';

process.exit(runFridaValidateCli(process.argv.slice(2), { rootDir: process.cwd() }));
