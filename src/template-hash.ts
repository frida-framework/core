import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT_DIR = path.resolve(process.env.FRIDA_REPO_ROOT || process.cwd());
const DEFAULT_MANIFEST_REL_PATH = fs.existsSync(path.resolve(ROOT_DIR, 'core-contract', 'template-integrity.manifest.yaml'))
  ? 'core-contract/template-integrity.manifest.yaml'
  : 'contract/template-integrity.manifest.yaml';
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
    console.error(`вќЊ Template manifest not found: ${absoluteManifestPath}`);
    return 1;
  }

  const absoluteSchemaPath = path.resolve(ROOT_DIR, MANIFEST_SCHEMA_REL_PATH);
  if (!fs.existsSync(absoluteSchemaPath)) {
    console.error(`вќЊ Template manifest schema not found: ${absoluteSchemaPath}`);
    return 1;
  }

  const manifestRaw = fs.readFileSync(absoluteManifestPath, 'utf-8');
  const manifest = yaml.parse(manifestRaw) as TemplateManifest;
  validateManifestSchema(manifest, absoluteSchemaPath);

  const templates = [...manifest.templates].sort((a, b) => a.id.localeCompare(b.id));
  let ok = 0;
  let mismatch = 0;
  let missing = 0;

  console.log(`рџ“„ Manifest: ${path.relative(ROOT_DIR, absoluteManifestPath)}`);

  for (const entry of templates) {
    const absoluteFilePath = path.resolve(ROOT_DIR, entry.file);
    if (!fs.existsSync(absoluteFilePath)) {
      console.error(`вќЊ ${entry.id}: file missing (${entry.file})`);
      missing += 1;
      continue;
    }

    const actualHash = sha256File(absoluteFilePath);
    if (actualHash === entry.sha256) {
      console.log(`вњ… ${entry.id}: ${actualHash}`);
      ok += 1;
      continue;
    }

    console.log(`вќЊ ${entry.id}:`);
    console.log(`   manifest: ${entry.sha256}`);
    console.log(`   actual:   ${actualHash}`);
    mismatch += 1;
  }

  console.log(`\nв”Ѓв”Ѓв”Ѓ Summary: ${ok} ok, ${mismatch} changed, ${missing} missing в”Ѓв”Ѓв”Ѓ\n`);
  return mismatch > 0 || missing > 0 ? 1 : 0;
}

export function runFridaHashCli(args: string[] = process.argv.slice(2)): number {
  console.log('рџ”‘ FRIDA Template Hash Check\n');
  try {
    const parsedArgs = parseArgs(args);
    const manifestPath = parsedArgs.manifestPath || DEFAULT_MANIFEST_REL_PATH;

    if (!fs.existsSync(path.resolve(ROOT_DIR, manifestPath))) {
      console.error(`вќЊ Template manifest not found: ${path.resolve(ROOT_DIR, manifestPath)}`);
      return 1;
    }

    return runManifestMode(manifestPath);
  } catch (error) {
    console.error(`вќЊ hash check failed: ${error instanceof Error ? error.message : String(error)}`);
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
