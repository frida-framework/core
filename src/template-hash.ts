import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadContractDocument } from './contract-path.ts';

const ROOT_DIR = path.resolve(process.env.FRIDA_REPO_ROOT || process.cwd());
const DEFAULT_MANIFEST_REL_PATH = 'contract/template-integrity.manifest.yaml';
const MANIFEST_SCHEMA_REL_PATH = 'schemas/template-integrity.schema.json';

interface TemplateManifestEntry {
  id: string;
  file: string;
  sha256: string;
}

interface TemplateManifest {
  version: string;
  templates: TemplateManifestEntry[];
}

interface HashArgs {
  contractPath: string | null;
  manifestPath: string | null;
}

function parseArgs(args: string[]): HashArgs {
  const readFlag = (flag: string): string | null => {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) {
      return null;
    }
    return args[idx + 1];
  };

  return {
    contractPath: readFlag('--contract'),
    manifestPath: readFlag('--manifest'),
  };
}

function sha256File(filePath: string): string {
  const fileBytes = fs.readFileSync(filePath);
  return `sha256:${crypto.createHash('sha256').update(fileBytes).digest('hex')}`;
}

function validateManifestSchema(manifest: unknown, schemaPath: string): void {
  const schemaRaw = fs.readFileSync(schemaPath, 'utf-8');
  const schema = JSON.parse(schemaRaw);
  const AjvCtor: any = (Ajv2020 as any).default || Ajv2020;
  const addFormatsFn: any = (addFormats as any).default || addFormats;
  const ajv = new AjvCtor({ allErrors: true, strict: false });
  addFormatsFn(ajv);
  const validate = ajv.compile(schema);
  if (!validate(manifest)) {
    const message = (validate.errors || [])
      .map((error: any) => `${error.instancePath || '/'} ${error.message || 'invalid'}`)
      .join('; ');
    throw new Error(`template manifest validation failed: ${message}`);
  }
}

function runManifestMode(manifestPath: string): number {
  const absoluteManifestPath = path.resolve(ROOT_DIR, manifestPath);
  if (!fs.existsSync(absoluteManifestPath)) {
    console.error(`❌ Template manifest not found: ${absoluteManifestPath}`);
    return 1;
  }

  const absoluteSchemaPath = path.resolve(ROOT_DIR, MANIFEST_SCHEMA_REL_PATH);
  if (!fs.existsSync(absoluteSchemaPath)) {
    console.error(`❌ Template manifest schema not found: ${absoluteSchemaPath}`);
    return 1;
  }

  const manifestRaw = fs.readFileSync(absoluteManifestPath, 'utf-8');
  const manifest = yaml.parse(manifestRaw) as TemplateManifest;
  validateManifestSchema(manifest, absoluteSchemaPath);

  const templates = [...manifest.templates].sort((a, b) => a.id.localeCompare(b.id));
  let ok = 0;
  let mismatch = 0;
  let missing = 0;

  console.log(`📄 Manifest: ${path.relative(ROOT_DIR, absoluteManifestPath)}`);

  for (const entry of templates) {
    const absoluteFilePath = path.resolve(ROOT_DIR, entry.file);
    if (!fs.existsSync(absoluteFilePath)) {
      console.error(`❌ ${entry.id}: file missing (${entry.file})`);
      missing += 1;
      continue;
    }

    const actualHash = sha256File(absoluteFilePath);
    if (actualHash === entry.sha256) {
      console.log(`✅ ${entry.id}: ${actualHash}`);
      ok += 1;
      continue;
    }

    console.log(`❌ ${entry.id}:`);
    console.log(`   manifest: ${entry.sha256}`);
    console.log(`   actual:   ${actualHash}`);
    mismatch += 1;
  }

  console.log(`\n━━━ Summary: ${ok} ok, ${mismatch} changed, ${missing} missing ━━━\n`);
  return mismatch > 0 || missing > 0 ? 1 : 0;
}

function runLegacyContractMode(contractPath: string | null): number {
  const loaded = loadContractDocument(ROOT_DIR, contractPath || undefined);
  const contract = loaded.parsed as Record<string, any>;

  const tplKeys = Object.keys(contract)
    .filter((key) => key.startsWith('FRIDA_TPL_'))
    .sort();

  let ok = 0;
  let mismatch = 0;
  let missing = 0;

  console.log(`📄 Contract fallback: ${path.relative(ROOT_DIR, loaded.contractPath)}`);

  for (const key of tplKeys) {
    const block = contract[key];
    const file = block?.file;
    if (!file) {
      console.warn(`⚠️  ${key}: no 'file' field`);
      missing += 1;
      continue;
    }

    const filePath = path.resolve(ROOT_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ ${key}: file missing (${file})`);
      missing += 1;
      continue;
    }

    const actualHash = sha256File(filePath);
    const contractHash = block.content_hash || null;
    if (!contractHash) {
      console.log(`🆕 ${key}: ${actualHash} (no content_hash in contract)`);
      mismatch += 1;
      continue;
    }

    if (actualHash === contractHash) {
      console.log(`✅ ${key}: ${actualHash}`);
      ok += 1;
      continue;
    }

    console.log(`❌ ${key}:`);
    console.log(`   contract:  ${contractHash}`);
    console.log(`   actual: ${actualHash}`);
    mismatch += 1;
  }

  console.log(`\n━━━ Summary: ${ok} ok, ${mismatch} changed, ${missing} missing ━━━\n`);
  return mismatch > 0 || missing > 0 ? 1 : 0;
}

export function runFridaHashCli(args: string[] = process.argv.slice(2)): number {
  console.log('🔑 FRIDA Template Hash Check\n');
  try {
    const parsedArgs = parseArgs(args);
    const manifestPath = parsedArgs.manifestPath || DEFAULT_MANIFEST_REL_PATH;

    if (fs.existsSync(path.resolve(ROOT_DIR, manifestPath))) {
      return runManifestMode(manifestPath);
    }

    console.warn(`⚠️  Manifest not found (${manifestPath}), using legacy contract FRIDA_TPL_* fallback.`);
    return runLegacyContractMode(parsedArgs.contractPath);
  } catch (error) {
    console.error(`❌ hash check failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function main(): void {
  process.exit(runFridaHashCli(process.argv.slice(2)));
}

const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('template-hash.ts') ||
  process.argv[1].endsWith('template-hash.js')
);

if (isMainModule) {
  main();
}
