#!/usr/bin/env tsx
/**
 * FRIDA Template Injector
 * 
 * Reads current .hbs template files and injects their content back into 
 * zerohuman-frida-kernel.md for documentation purposes.
 * 
 * Usage: npm run frida:inject
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(process.env.FRIDA_REPO_ROOT || process.cwd());
const RUNTIME_CONFIG_PATH = path.resolve(ROOT_DIR, '.frida', 'config.yaml');
const WIKI_PATH = process.env.FRIDA_WIKI_PATH
    ? path.resolve(ROOT_DIR, process.env.FRIDA_WIKI_PATH)
    : path.resolve(
        ROOT_DIR,
        '..',
        process.env.FRIDA_WIKI_REPO || `${path.basename(ROOT_DIR)}.wiki`,
        'zerohuman-frida-kernel.md'
    );

type AppContractSsotMode = 'REPO.LOCAL' | 'REPO.WIKI';

function getAppContractSsotMode(): AppContractSsotMode {
    if (!fs.existsSync(RUNTIME_CONFIG_PATH)) {
        console.warn(`⚠️  Runtime config file not found: ${path.relative(ROOT_DIR, RUNTIME_CONFIG_PATH)}. Falling back to REPO.WIKI.`);
        return 'REPO.WIKI';
    }

    try {
        const parsed = yaml.parse(fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf-8')) as Record<string, unknown> | null;
        const raw = parsed && typeof parsed === 'object' ? parsed.APP_CONTRACT_SSOT : null;
        if (raw === 'REPO.LOCAL' || raw === 'REPO.WIKI') {
            return raw;
        }
        console.warn(`⚠️  APP_CONTRACT_SSOT is missing/invalid in ${path.relative(ROOT_DIR, RUNTIME_CONFIG_PATH)}. Falling back to REPO.WIKI.`);
        return 'REPO.WIKI';
    } catch (error) {
        console.warn(`⚠️  Failed to read runtime config file ${path.relative(ROOT_DIR, RUNTIME_CONFIG_PATH)} (${error instanceof Error ? error.message : String(error)}). Falling back to REPO.WIKI.`);
        return 'REPO.WIKI';
    }
}

// List of templates to process (order doesn't matter for injection)
const TEMPLATES = [
    { key: 'FRIDA_TPL_BOOTLOADER', file: 'scripts/templates/frida/bootloader.hbs' },
    { key: 'FRIDA_TPL_ROUTER', file: 'scripts/templates/frida/router.xml.hbs' },
    { key: 'FRIDA_TPL_PROFILE', file: 'scripts/templates/frida/profile.xml.hbs' },
    { key: 'FRIDA_TPL_AGENTS_READONLY', file: 'scripts/templates/docs-gen/agents-readonly.hbs' },
    { key: 'FRIDA_TPL_AGENTS_MAPPER', file: 'scripts/templates/docs-gen/agents-mapper.hbs' },
    { key: 'FRIDA_TPL_AGENTS_NOTOUCH', file: 'scripts/templates/docs-gen/agents-notouch.hbs' },
    { key: 'FRIDA_TPL_AGENTS_SERVICE', file: 'scripts/templates/docs-gen/agents-service.hbs' },
    { key: 'FRIDA_TPL_BOUNDARIES', file: 'scripts/templates/docs-gen/boundaries.hbs' },
    { key: 'FRIDA_TPL_IMMUTABILITY', file: 'scripts/templates/docs-gen/immutability.hbs' },
    { key: 'FRIDA_TPL_API_REFERENCE', file: 'scripts/templates/docs-gen/api-reference.hbs' },
];

function main() {
    console.log('🔄 Syncing Templates to Wiki...\n');

    const ssotMode = getAppContractSsotMode();
    if (ssotMode === 'REPO.LOCAL') {
        console.log('⏭️  APP_CONTRACT_SSOT=REPO.LOCAL in runtime config file. Wiki synchronization is disabled.');
        process.exit(0);
    }

    if (!fs.existsSync(WIKI_PATH)) {
        console.error('❌ Wiki file not found:', WIKI_PATH);
        process.exit(1);
    }

    let wikiContent = fs.readFileSync(WIKI_PATH, 'utf-8');
    let modified = false;

    for (const tpl of TEMPLATES) {
        const filePath = path.join(ROOT_DIR, tpl.file);
        if (!fs.existsSync(filePath)) {
            console.warn(`⚠️  Missing file: ${tpl.file}`);
            continue;
        }

        const rawContent = fs.readFileSync(filePath, 'utf-8');
        // Compute hash
        const hash = 'sha256:' + crypto.createHash('sha256').update(rawContent).digest('hex');

        // Find the block in wiki
        // Looking for: ```yaml contract:KEY ... content_hash: "..." ... ```
        const regex = new RegExp(`(\`\`\`yaml contract:${tpl.key}[\\s\\S]*?content_hash: ")([^"]+)("[\\s\\S]*?)(\`\`\`)`, 'm');

        const match = wikiContent.match(regex);
        if (!match) {
            console.warn(`⚠️  Block not found in wiki: ${tpl.key}`);
            continue;
        }

        // const currentHash = match[2];

        // Indent content for YAML block scalar (2 spaces)
        let indentedContent = rawContent.split('\n').map(line => '  ' + line).join('\n');
        // Ensure it ends with newline
        if (!indentedContent.endsWith('\n')) indentedContent += '\n';

        // Construct new block content
        // We replace the hash AND append/replace the content field
        // But wait, the regex matches the whole block nicely?
        // Let's rely on structural replacement.

        // Strategy: 
        // 1. Locate the block start.
        // 2. Locate the block end (```).
        // 3. Reconstruct the block.

        const blockStart = wikiContent.indexOf(`\`\`\`yaml contract:${tpl.key}`);
        if (blockStart === -1) continue;

        const blockEnd = wikiContent.indexOf('```', blockStart + 10);
        if (blockEnd === -1) continue;

        const blockText = wikiContent.substring(blockStart, blockEnd + 3);

        // Parse existing block lines to keep metadata (file, purpose, etc)
        // We only want to update content_hash and content.
        const lines = blockText.split('\n');
        const newLines: string[] = [];
        let insideContent = false;

        for (const line of lines) {
            if (line.trim().startsWith('content_hash:')) {
                newLines.push(`content_hash: "${hash}"`);
                continue;
            }
            if (line.trim().startsWith('content:')) {
                insideContent = true;
                continue; // Skip old content line
            }
            if (insideContent) {
                // Skip lines until we hit a key which is impossible in YAML block scalar unless dedented, 
                // but simpler: we rewrite the content field at the end.
                // Actually, just skip all lines that start with space if inside content? 
                // Too risky.
                // Better strategy: Just regex replace the content_hash line, and remove any existing content block, then append new content block.
                continue;
            }
            if (line.trim() === '```') continue; // Skip end fence for now
            newLines.push(line);
        }

        // Reassemble
        // Remove trailing empty lines from metadata
        while (newLines.length > 0 && newLines[newLines.length - 1].trim() === '') {
            newLines.pop();
        }

        newLines.push(`content: |`);
        newLines.push(indentedContent.trimEnd()); // Trim end to avoid double newline
        newLines.push('```');

        const newBlockText = newLines.join('\n');

        if (newBlockText !== blockText) {
            wikiContent = wikiContent.replace(blockText, newBlockText);
            console.log(`✅ Updated ${tpl.key}`);
            modified = true;
        } else {
            console.log(`🆗 ${tpl.key} (no change)`);
        }
    }

    if (modified) {
        fs.writeFileSync(WIKI_PATH, wikiContent, 'utf-8');
        console.log('\n💾 Wiki updated successfully!');
    } else {
        console.log('\n✨ Wiki is up to date.');
    }
}

main();
