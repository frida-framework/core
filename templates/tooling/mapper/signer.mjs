#!/usr/bin/env node
/**
 * Signer phase — final step of mapper:all pipeline.
 * Computes per-file SHA-256 hashes of all files in src/mount/**
 * and writes src/mount/integrity.json as a tamper-evidence manifest.
 *
 * Contract refs:
 *   - contract:BUILDTIME.app.mapper.phases.signer
 *   - contract:PATHS.mount.integrity
 *   - guard: mount.integrity.signature-match
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = join(__filename, '..', '..', '..');
const MOUNT_DIR = join(ROOT_DIR, 'src', 'mount');
const INTEGRITY_FILE = join(MOUNT_DIR, 'integrity.json');

// Files excluded from hashing (they are not mapper output)
const EXCLUDED = new Set(['integrity.json', 'AGENTS.md']);

function collectFiles(dir, base = dir) {
    const results = [];
    if (!existsSync(dir)) return results;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        const relPath = relative(base, fullPath).split('\\').join('/');

        if (entry.isDirectory()) {
            results.push(...collectFiles(fullPath, base));
        } else if (entry.isFile() && !EXCLUDED.has(entry.name)) {
            results.push({ relPath, fullPath });
        }
    }
    return results;
}

function hashFile(filePath) {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
}

// --- Main ---
console.log('🔏 Signer: computing mount integrity manifest...');

const files = collectFiles(MOUNT_DIR);
files.sort((a, b) => a.relPath.localeCompare(b.relPath));

const fileHashes = {};
for (const { relPath, fullPath } of files) {
    fileHashes[relPath] = hashFile(fullPath);
}

const manifest = {
    generatedAt: new Date().toISOString(),
    algorithm: 'sha256',
    fileCount: Object.keys(fileHashes).length,
    files: fileHashes,
};

writeFileSync(INTEGRITY_FILE, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`✅ Signer: integrity.json written (${manifest.fileCount} files hashed)`);
