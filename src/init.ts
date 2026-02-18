import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { fileURLToPath } from 'url';
import { loadCanonDocument } from './canon-path.ts';
import {
  ensureCanonReportingSettings,
  REPORTING_SETTINGS_FIXED,
  toRuntimeConfig,
  writeRuntimeConfig,
} from './reporting-contract.ts';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_CONFIG_SCHEMA_PATH = path.resolve(MODULE_DIR, '../schemas/frida-runtime-config.schema.json');

interface InitArgs {
  canonPath: string | null;
  dryRun: boolean;
}

function parseArgs(args: string[]): InitArgs {
  const readFlag = (flag: string): string | null => {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) {
      return null;
    }
    return args[idx + 1];
  };

  return {
    canonPath: readFlag('--canon'),
    dryRun: args.includes('--dry-run'),
  };
}

function validateRuntimeConfigSchema(payload: unknown): void {
  const schemaRaw = fs.readFileSync(RUNTIME_CONFIG_SCHEMA_PATH, 'utf-8');
  const schema = JSON.parse(schemaRaw);
  const AjvCtor: any = (Ajv2020 as any).default || Ajv2020;
  const addFormatsFn: any = (addFormats as any).default || addFormats;
  const ajv = new AjvCtor({ allErrors: true, strict: false });
  addFormatsFn(ajv);
  const validate = ajv.compile(schema);
  if (!validate(payload)) {
    const message = (validate.errors || [])
      .map((error: any) => `${error.instancePath || '/'} ${error.message || 'invalid'}`)
      .join('; ');
    throw new Error(`runtime config schema validation failed: ${message}`);
  }
}

function validateCanonReporting(contract: Record<string, any>): void {
  const reporting = contract?.FRIDA_CONFIG?.reporting;
  if (!reporting || typeof reporting !== 'object') {
    throw new Error('FRIDA_CONFIG.reporting is missing after init normalization');
  }
  if (reporting.collect_in_repo !== REPORTING_SETTINGS_FIXED.collectInRepo) {
    throw new Error('FRIDA_CONFIG.reporting.collect_in_repo must be true');
  }
  if (reporting.repo_path !== REPORTING_SETTINGS_FIXED.repoPath) {
    throw new Error('FRIDA_CONFIG.reporting.repo_path must be .frida/job-reports');
  }
  if (reporting.file_ext !== REPORTING_SETTINGS_FIXED.fileExt) {
    throw new Error('FRIDA_CONFIG.reporting.file_ext must be .yaml');
  }
  if (reporting.filename_pattern !== REPORTING_SETTINGS_FIXED.filenamePattern) {
    throw new Error('FRIDA_CONFIG.reporting.filename_pattern mismatch');
  }
  if (reporting.exists_check !== REPORTING_SETTINGS_FIXED.existsCheck) {
    throw new Error('FRIDA_CONFIG.reporting.exists_check must be false');
  }
}

export async function runFridaInitCli(args: string[] = []): Promise<number> {
  try {
    const parsedArgs = parseArgs(args);
    const rootDir = process.cwd();
    const loaded = loadCanonDocument(rootDir, parsedArgs.canonPath || undefined);
    const contract = loaded.parsed as Record<string, any>;

    const { changed } = ensureCanonReportingSettings(contract);
    validateCanonReporting(contract);

    const runtimeConfig = toRuntimeConfig(REPORTING_SETTINGS_FIXED);
    validateRuntimeConfigSchema(runtimeConfig);

    if (!parsedArgs.dryRun && changed) {
      fs.writeFileSync(loaded.canonPath, `${yaml.stringify(contract)}\n`, 'utf-8');
    }

    if (!parsedArgs.dryRun) {
      const runtimeConfigPath = writeRuntimeConfig(rootDir, runtimeConfig);
      console.log(`✅ Runtime config written: ${path.relative(rootDir, runtimeConfigPath)}`);
    } else {
      console.log('ℹ️ Dry run: no files written');
    }

    console.log(`✅ Canon reporting normalized: ${path.relative(rootDir, loaded.canonPath)} (changed=${changed})`);
    return 0;
  } catch (error) {
    console.error(`❌ init failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

