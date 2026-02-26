import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { fileURLToPath } from 'url';
import { loadContractDocument } from './contract-path.ts';
import {
  ensureRuntimeConfigArtifacts,
  ensureContractReportingSettings,
  REPORTING_SETTINGS_FIXED,
} from './reporting-contract.ts';
import { validateFridaRootLayout } from './frida-layout.ts';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_CONFIG_SCHEMA_PATH = path.resolve(MODULE_DIR, '../schemas/frida-runtime-config.schema.json');

interface InitArgs {
  contractPath: string | null;
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
    contractPath: readFlag('--contract'),
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

function validateContractReporting(contract: Record<string, any>): void {
  const reporting = contract?.FRIDA_CONFIG?.reporting;
  if (!reporting || typeof reporting !== 'object') {
    throw new Error('FRIDA_CONFIG.reporting is missing after init normalization');
  }
  if (reporting.collect_in_repo !== REPORTING_SETTINGS_FIXED.collectInRepo) {
    throw new Error('FRIDA_CONFIG.reporting.collect_in_repo must be true');
  }
  if (reporting.repo_path !== REPORTING_SETTINGS_FIXED.repoPath) {
    throw new Error(`FRIDA_CONFIG.reporting.repo_path must be ${REPORTING_SETTINGS_FIXED.repoPath}`);
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
    const loaded = loadContractDocument(rootDir, parsedArgs.contractPath || undefined);
    const contract = loaded.parsed as Record<string, any>;

    const { changed } = ensureContractReportingSettings(contract);
    validateContractReporting(contract);

    if (!parsedArgs.dryRun && changed) {
      fs.writeFileSync(loaded.contractPath, `${yaml.stringify(contract)}\n`, 'utf-8');
    }

    if (!parsedArgs.dryRun) {
      const runtimeConfigArtifacts = ensureRuntimeConfigArtifacts(rootDir, REPORTING_SETTINGS_FIXED);
      validateRuntimeConfigSchema(runtimeConfigArtifacts.effectiveConfig);
      if (runtimeConfigArtifacts.createdRuntimeConfig) {
        console.log(`✅ Runtime config created: ${path.relative(rootDir, runtimeConfigArtifacts.runtimeConfigPath)}`);
      } else {
        console.log(`ℹ️ Runtime config preserved: ${path.relative(rootDir, runtimeConfigArtifacts.runtimeConfigPath)}`);
      }
      console.log(`✅ Runtime config template written: ${path.relative(rootDir, runtimeConfigArtifacts.templatePath)}`);
      for (const warning of runtimeConfigArtifacts.warnings) {
        console.warn(`⚠️  ${warning}`);
      }
      validateFridaRootLayout(rootDir, 'warn');
    } else {
      console.log('ℹ️ Dry run: no files written');
      console.log('ℹ️ Dry run: runtime config template would be written to .frida/config.template.yaml');
      console.log('ℹ️ Dry run: runtime config file would be created only if .frida/config.yaml is missing');
    }

    console.log(`✅ Contract reporting normalized: ${path.relative(rootDir, loaded.contractPath)} (changed=${changed})`);
    return 0;
  } catch (error) {
    console.error(`❌ init failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
