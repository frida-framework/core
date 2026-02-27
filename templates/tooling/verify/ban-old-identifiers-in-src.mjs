#!/usr/bin/env node

/**
 * Ban old identifiers in src/**
 * Enforces contract naming convention for v2 services
 * 
 * Old identifiers (BANNED):
 * - shRoute
 * - getPreviewByRouteId
 * - getRouteById
 * - setWspace
 * - getWspace
 * - checkAuth
 * 
 * Contract identifiers (REQUIRED):
 * - createRoute
 * - getRoute
 * - getWorkspace
 * - setWorkspace
 * - getCurrentUser
 * - signIn
 * - signOut
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const OLD_IDENTIFIERS = [
    'shRoute',
    'getPreviewByRouteId',
    'getRouteById',
    'setWspace',
    'getWspace',
    'checkAuth',
];

const SRC_DIR = join(process.cwd(), 'src');

function searchInFile(filePath, pattern) {
    try {
        const content = readFileSync(filePath, 'utf-8');
        const regex = new RegExp(`\\b(${pattern.join('|')})\\b`, 'g');
        const matches = content.match(regex) || [];
        return matches.map(m => ({
            identifier: m,
            line: content.substring(0, content.indexOf(m)).split('\n').length,
        }));
    } catch (error) {
        return [];
    }
}

function searchInDirectory(dir, pattern) {
    const results = [];
    
    function traverse(currentDir) {
        const entries = readdirSync(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = join(currentDir, entry.name);
            
            if (entry.isDirectory()) {
                // Skip node_modules and dist
                if (entry.name !== 'node_modules' && 
                    entry.name !== 'dist' && 
                    entry.name !== '.git') {
                    traverse(fullPath);
                }
            } else if (entry.isFile() && 
                       (fullPath.endsWith('.ts') || 
                        fullPath.endsWith('.tsx') || 
                        fullPath.endsWith('.js') || 
                        fullPath.endsWith('.jsx'))) {
                const fileMatches = searchInFile(fullPath, pattern);
                for (const match of fileMatches) {
                    results.push({
                        file: fullPath,
                        identifier: match.identifier,
                        line: match.line,
                    });
                }
            }
        }
    }
    
    traverse(dir);
    return results;
}

function main() {
    console.log('🔍 Searching for old identifiers in src/...');
    
    const violations = searchInDirectory(SRC_DIR, OLD_IDENTIFIERS);
    
    if (violations.length === 0) {
        console.log('✅ No old identifiers found in src/');
        process.exit(0);
    }
    
    console.log(`❌ Found ${violations.length} old identifier(s) in src/:\n`);
    
    // Group violations by identifier
    const byIdentifier = {};
    for (const v of violations) {
        if (!byIdentifier[v.identifier]) {
            byIdentifier[v.identifier] = [];
        }
        byIdentifier[v.identifier].push(v);
    }
    
    // Print violations
    for (const [identifier, items] of Object.entries(byIdentifier)) {
        console.log(`\n  ${identifier} (${items.length} occurrence(s)):`);
        for (const item of items.slice(0, 3)) { // Show max 3 per identifier
            const relativePath = item.file.replace(process.cwd(), '').replace(/\\/g, '/');
            console.log(`    ${relativePath}:${item.line}`);
        }
        if (items.length > 3) {
            console.log(`    ... and ${items.length - 3} more`);
        }
    }
    
    console.log('\n❌ Old identifiers are banned in src/');
    console.log('   Please use contract naming:');
    console.log('   - createRoute (not shRoute)');
    console.log('   - getRoute (not getRouteById, getPreviewByRouteId)');
    console.log('   - getWorkspace (not getWspace)');
    console.log('   - setWorkspace (not setWspace)');
    console.log('   - getCurrentUser (not checkAuth)');
    console.log('   - signIn, signOut');
    
    process.exit(1);
}

main();
