import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

export interface ReportingSettings {
  collectInRepo: boolean;
  repoPath: string;
  fileExt: '.yaml';
  filenamePattern: string;
  existsCheck: false;
}

export interface RuntimeConfigFile {
  version: '1.0';
  reporting: {
    collect_in_repo: true;
    repo_path: '.frida/job-reports';
    file_ext: '.yaml';
    filename_pattern: '<unixtime_ms>_<profile_id>_<task_or_run>.yaml';
    exists_check: false;
  };
}

export const REPORTING_SETTINGS_FIXED: ReportingSettings = {
  collectInRepo: true,
  repoPath: '.frida/job-reports',
  fileExt: '.yaml',
  filenamePattern: '<unixtime_ms>_<profile_id>_<task_or_run>.yaml',
  existsCheck: false,
};

export const RUNTIME_CONFIG_REL_PATH = '.frida/config.yaml';
export const JOB_REPORTS_GLOB = '.frida/job-reports/*.yaml';

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

export function ensureCanonReportingSettings(contract: Record<string, any>): { changed: boolean; settings: ReportingSettings } {
  const normalized = asObject(contract);
  if (!normalized.FRIDA_CONFIG || typeof normalized.FRIDA_CONFIG !== 'object') {
    normalized.FRIDA_CONFIG = {};
  }
  if (!normalized.FRIDA_CONFIG.reporting || typeof normalized.FRIDA_CONFIG.reporting !== 'object') {
    normalized.FRIDA_CONFIG.reporting = {};
  }

  const reporting = normalized.FRIDA_CONFIG.reporting as Record<string, any>;
  const before = JSON.stringify(reporting);
  reporting.collect_in_repo = REPORTING_SETTINGS_FIXED.collectInRepo;
  reporting.repo_path = REPORTING_SETTINGS_FIXED.repoPath;
  reporting.file_ext = REPORTING_SETTINGS_FIXED.fileExt;
  reporting.filename_pattern = REPORTING_SETTINGS_FIXED.filenamePattern;
  reporting.exists_check = REPORTING_SETTINGS_FIXED.existsCheck;

  return {
    changed: before !== JSON.stringify(reporting),
    settings: REPORTING_SETTINGS_FIXED,
  };
}

export function getCanonReportingSettings(contract: Record<string, any>): ReportingSettings {
  const reporting = asObject(asObject(contract).FRIDA_CONFIG).reporting;
  if (!reporting || typeof reporting !== 'object') {
    return REPORTING_SETTINGS_FIXED;
  }
  return {
    collectInRepo: Boolean(reporting.collect_in_repo),
    repoPath: typeof reporting.repo_path === 'string' ? reporting.repo_path : REPORTING_SETTINGS_FIXED.repoPath,
    fileExt: REPORTING_SETTINGS_FIXED.fileExt,
    filenamePattern:
      typeof reporting.filename_pattern === 'string'
        ? reporting.filename_pattern
        : REPORTING_SETTINGS_FIXED.filenamePattern,
    existsCheck: false,
  };
}

export function toRuntimeConfig(settings: ReportingSettings): RuntimeConfigFile {
  return {
    version: '1.0',
    reporting: {
      collect_in_repo: true,
      repo_path: '.frida/job-reports',
      file_ext: '.yaml',
      filename_pattern: '<unixtime_ms>_<profile_id>_<task_or_run>.yaml',
      exists_check: false,
    },
  };
}

export function readRuntimeConfig(rootDir: string): RuntimeConfigFile | null {
  const runtimeConfigPath = path.resolve(rootDir, RUNTIME_CONFIG_REL_PATH);
  if (!fs.existsSync(runtimeConfigPath)) {
    return null;
  }
  const raw = fs.readFileSync(runtimeConfigPath, 'utf-8');
  const parsed = yaml.parse(raw) as RuntimeConfigFile;
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  return parsed;
}

export function writeRuntimeConfig(rootDir: string, config: RuntimeConfigFile): string {
  const absoluteConfigPath = path.resolve(rootDir, RUNTIME_CONFIG_REL_PATH);
  fs.mkdirSync(path.dirname(absoluteConfigPath), { recursive: true });
  fs.writeFileSync(absoluteConfigPath, `${yaml.stringify(config)}\n`, 'utf-8');
  return absoluteConfigPath;
}

export function resolveJobReportDirectory(rootDir: string, settings: ReportingSettings): string {
  return path.resolve(rootDir, settings.repoPath);
}

export function buildJobReportFileName(profileId: string, taskOrRun: string, unixTimeMs?: number): string {
  const sanitize = (value: string): string => {
    const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_');
    return normalized || 'unknown';
  };
  const timestamp = String(unixTimeMs ?? Date.now());
  return `${timestamp}_${sanitize(profileId)}_${sanitize(taskOrRun)}.yaml`;
}

