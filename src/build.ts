import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { loadContractDocument } from './contract-path.ts';
import type { BlockVisibility } from './types.ts';

interface BuildArgs {
    publicOnly: boolean;
    output?: string;
    contractPath?: string;
}

function parseArgs(args: string[]): BuildArgs {
    const result: BuildArgs = { publicOnly: false };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--public') {
            result.publicOnly = true;
        } else if (arg === '--output' && i + 1 < args.length) {
            result.output = args[++i];
        } else if (arg === '--contract' && i + 1 < args.length) {
            result.contractPath = args[++i];
        }
    }
    return result;
}

function getBlockVisibility(block: unknown): BlockVisibility | undefined {
    if (block && typeof block === 'object' && '_visibility' in block) {
        const v = (block as Record<string, unknown>)._visibility;
        if (v === 'public' || v === 'private') return v;
    }
    return undefined;
}

function stripVisibilityMarkers(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            const cleaned = { ...value };
            delete cleaned._visibility;
            result[key] = cleaned;
        } else {
            result[key] = value;
        }
    }
    return result;
}

function filterPublicBlocks(contract: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    // Structural blocks always included
    const structuralKeys = ['meta', 'core'];

    for (const [key, value] of Object.entries(contract)) {
        if (structuralKeys.includes(key)) {
            result[key] = value;
            continue;
        }

        const visibility = getBlockVisibility(value);
        if (visibility === 'public') {
            const cleaned = { ...value };
            delete cleaned._visibility;
            result[key] = cleaned;
        }
    }

    // Update contracticalSourceBlocks to reflect only public blocks
    if (result.core?.contracticalSourceBlocks) {
        result.core = {
            ...result.core,
            contracticalSourceBlocks: result.core.contracticalSourceBlocks.filter(
                (block: string) => block in result
            ),
        };
    }

    return result;
}

export async function runFridaBuildCli(args: string[]): Promise<number> {
    const parsedArgs = parseArgs(args);
    const rootDir = process.cwd();

    try {
        const loaded = loadContractDocument(rootDir, parsedArgs.contractPath || undefined);
        let output = loaded.parsed;

        if (parsedArgs.publicOnly) {
            output = filterPublicBlocks(output);
            console.log(`✅ Filtered to ${Object.keys(output).length} public blocks`);
        } else {
            output = stripVisibilityMarkers(output);
        }

        const outputPath = parsedArgs.output
            ? path.resolve(rootDir, parsedArgs.output)
            : path.resolve(rootDir, 'dist', parsedArgs.publicOnly ? 'contract.public.yaml' : 'contract.assembled.yaml');

        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const yamlOutput = yaml.stringify(output, { lineWidth: 120 });
        fs.writeFileSync(outputPath, yamlOutput, 'utf-8');
        console.log(`✅ Contract written: ${path.relative(rootDir, outputPath)}`);

        return 0;
    } catch (error) {
        console.error(`❌ Build failed:`, error instanceof Error ? error.message : error);
        return 1;
    }
}
