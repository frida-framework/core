import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { fileURLToPath } from 'url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadCanonDocument } from './canon-path.ts';
import {
  buildJobReportFileName,
  getCanonReportingSettings,
  readRuntimeConfig,
  resolveJobReportDirectory,
  RUNTIME_CONFIG_REL_PATH,
  toRuntimeConfig,
} from './reporting-contract.ts';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const JOB_REPORT_SCHEMA_PATH = path.resolve(MODULE_DIR, '../schemas/frida-job-report.schema.json');
const RUNTIME_CONFIG_SCHEMA_PATH = path.resolve(MODULE_DIR, '../schemas/frida-runtime-config.schema.json');

type ReportStatus = 'SUCCESS' | 'HALTED';

interface ReportArgs {
  command: 'check' | 'path' | 'write' | 'help';
  file: string | null;
  canonPath: string | null;
  profileId: string;
  taskOrRun: string;
  status: ReportStatus;
  summary: string;
}

function parseArgs(args: string[]): ReportArgs {
  const subcommand = args[0];
  const readFlag = (flag: string): string | null => {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) {
      return null;
    }
    return args[idx + 1];
  };

  const rawStatus = String(readFlag('--status') || 'SUCCESS').toUpperCase();
  const status: ReportStatus = rawStatus === 'HALTED' ? 'HALTED' : 'SUCCESS';

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    return {
      command: 'help',
      file: null,
      canonPath: null,
      profileId: 'unknown_profile',
      taskOrRun: 'run',
      status: 'SUCCESS',
      summary: 'Job report created by frida-core report write',
    };
  }

  return {
    command: subcommand === 'check' || subcommand === 'path' || subcommand === 'write' ? subcommand : 'help',
    file: readFlag('--file'),
    canonPath: readFlag('--canon'),
    profileId: readFlag('--profile') || 'unknown_profile',
    taskOrRun: readFlag('--task') || 'run',
    status,
    summary: readFlag('--summary') || 'Job report created by frida-core report write',
  };
}

function createValidator(schemaPath: string): (payload: unknown) => { ok: boolean; message: string } {
  const schemaRaw = fs.readFileSync(schemaPath, 'utf-8');
  const schema = JSON.parse(schemaRaw);
  const AjvCtor: any = (Ajv2020 as any).default || Ajv2020;
  const addFormatsFn: any = (addFormats as any).default || addFormats;
  const ajv = new AjvCtor({ allErrors: true, strict: false });
  addFormatsFn(ajv);
  const validate = ajv.compile(schema);

  return (payload: unknown) => {
    const ok = Boolean(validate(payload));
    if (ok) {
      return { ok: true, message: '' };
    }
    const message = (validate.errors || [])
      .map((error: any) => `${error.instancePath || '/'} ${error.message || 'invalid'}`)
      .join('; ');
    return { ok: false, message };
  };
}

function loadActiveReportingPath(rootDir: string, canonPath?: string): {
  activePath: string;
  canonPathValue: string;
  runtimePathValue: string | null;
} {
  const canon = loadCanonDocument(rootDir, canonPath);
  const canonSettings = getCanonReportingSettings(canon.parsed);
  const runtimeConfig = readRuntimeConfig(rootDir);

  if (runtimeConfig) {
    const runtimeValidation = createValidator(RUNTIME_CONFIG_SCHEMA_PATH)(runtimeConfig);
    if (!runtimeValidation.ok) {
      throw new Error(`Runtime config validation failed (${RUNTIME_CONFIG_REL_PATH}): ${runtimeValidation.message}`);
    }
    return {
      activePath: runtimeConfig.reporting.repo_path,
      canonPathValue: canonSettings.repoPath,
      runtimePathValue: runtimeConfig.reporting.repo_path,
    };
  }

  return {
    activePath: canonSettings.repoPath,
    canonPathValue: canonSettings.repoPath,
    runtimePathValue: null,
  };
}

function buildJobReportPayload(
  status: ReportStatus,
  profileId: string,
  summaryText: string,
  taskOrRun: string
): Record<string, any> {
  const payload: Record<string, any> = {
    frida_report: 1,
    status,
    profile_id: profileId,
    model: null,
    task_ref: taskOrRun,
    created_at: new Date().toISOString(),
    inputs: {
      prompt_summary: summaryText,
      canon_files_read: [],
      constraints_adopted: [],
    },
    changes: {
      modified: [],
      created: [],
      deleted: [],
    },
    verification: {
      commands: [],
      result: 'SKIPPED',
      notes: 'auto-generated job report',
    },
    summary: {
      what_done: ['Job report file created by frida-core report write'],
      risks_or_debt: [],
      followups: [],
    },
  };

  if (status === 'HALTED') {
    payload.halt_code = 'UNSPECIFIED';
    payload.decision_trace = [];
    payload.recovery = [];
  }

  return payload;
}

function showHelp(): void {
  console.log(`frida-core report

Usage:
  frida-core report check --file <path>
  frida-core report path [--canon <path>]
  frida-core report write [--canon <path>] [--profile <id>] [--task <name>] [--status SUCCESS|HALTED] [--summary <text>]
  frida-core report help
`);
}

function runCheck(filePath: string): number {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`❌ Report file not found: ${absolutePath}`);
    return 1;
  }
  const raw = fs.readFileSync(absolutePath, 'utf-8');
  const parsed = yaml.parse(raw);
  const validation = createValidator(JOB_REPORT_SCHEMA_PATH)(parsed);
  if (!validation.ok) {
    console.error(`❌ Job report schema validation failed: ${validation.message}`);
    return 1;
  }
  console.log(`✅ Job report valid: ${path.relative(process.cwd(), absolutePath)}`);
  return 0;
}

function runPath(canonPath: string | null): number {
  const resolved = loadActiveReportingPath(process.cwd(), canonPath || undefined);
  console.log(`report.path.active=${resolved.activePath}`);
  console.log(`report.path.canon=${resolved.canonPathValue}`);
  console.log(`report.path.runtime=${resolved.runtimePathValue || 'n/a'}`);
  return 0;
}

function runWrite(args: ReportArgs): number {
  const resolved = loadActiveReportingPath(process.cwd(), args.canonPath || undefined);
  const outputDir = resolveJobReportDirectory(process.cwd(), {
    collectInRepo: true,
    repoPath: resolved.activePath,
    fileExt: '.yaml',
    filenamePattern: '<unixtime_ms>_<profile_id>_<task_or_run>.yaml',
    existsCheck: false,
  });

  const fileName = buildJobReportFileName(args.profileId, args.taskOrRun);
  const outputPath = path.join(outputDir, fileName);
  const payload = buildJobReportPayload(args.status, args.profileId, args.summary, args.taskOrRun);

  const jobReportValidation = createValidator(JOB_REPORT_SCHEMA_PATH)(payload);
  if (!jobReportValidation.ok) {
    throw new Error(`job report payload validation failed: ${jobReportValidation.message}`);
  }

  const runtimeValidation = createValidator(RUNTIME_CONFIG_SCHEMA_PATH)(
    toRuntimeConfig({
      collectInRepo: true,
      repoPath: '.frida/job-reports',
      fileExt: '.yaml',
      filenamePattern: '<unixtime_ms>_<profile_id>_<task_or_run>.yaml',
      existsCheck: false,
    })
  );
  if (!runtimeValidation.ok) {
    throw new Error(`runtime reporting schema validation failed: ${runtimeValidation.message}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, `${yaml.stringify(payload)}\n`, 'utf-8');
  console.log(`✅ Job report written: ${path.relative(process.cwd(), outputPath)}`);
  return 0;
}

export async function runFridaReportCli(args: string[] = []): Promise<number> {
  try {
    const parsed = parseArgs(args);

    if (parsed.command === 'help') {
      showHelp();
      return 0;
    }

    if (parsed.command === 'check') {
      if (!parsed.file) {
        console.error('❌ Missing required flag: --file <path>');
        return 2;
      }
      return runCheck(parsed.file);
    }

    if (parsed.command === 'path') {
      return runPath(parsed.canonPath);
    }

    if (parsed.command === 'write') {
      return runWrite(parsed);
    }

    showHelp();
    return 2;
  } catch (error) {
    console.error(`❌ report command failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

