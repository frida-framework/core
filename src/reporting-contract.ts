import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { fileURLToPath } from 'url';

export interface ReportingSettings {
  collectInRepo: boolean;
  repoPath: string;
  fileExt: '.yaml';
  filenamePattern: string;
  existsCheck: false;
}

export type AppContractSsotMode = 'REPO.LOCAL' | 'REPO.WIKI';

export interface RuntimeReportingConfig {
  collect_in_repo: true;
  repo_path: string;
  file_ext: '.yaml';
  filename_pattern: '<unixtime_ms>_<profile_id>_<task_or_run>.yaml';
  exists_check: false;
}

export interface RuntimeConfigFile {
  version: '1.1';
  APP_CONTRACT_SSOT: AppContractSsotMode;
  reporting: RuntimeReportingConfig;
}

export interface RuntimeConfigOverrideFile {
  version?: string;
  APP_CONTRACT_SSOT?: AppContractSsotMode;
  reporting?: Partial<RuntimeReportingConfig> & Record<string, unknown>;
  [key: string]: unknown;
}

export interface ResolvedRuntimeConfig {
  effectiveConfig: RuntimeConfigFile;
  rawConfig: RuntimeConfigOverrideFile | null;
  warnings: string[];
  source: 'default' | 'runtime' | 'runtime+defaults';
}

export interface EnsureRuntimeConfigArtifactsResult extends ResolvedRuntimeConfig {
  runtimeConfigPath: string;
  templatePath: string;
  createdRuntimeConfig: boolean;
  wroteTemplate: boolean;
  runtimeConfigExisted: boolean;
}

export const REPORTING_SETTINGS_FIXED: ReportingSettings = {
  collectInRepo: true,
  repoPath: '.frida/reports',
  fileExt: '.yaml',
  filenamePattern: '<unixtime_ms>_<profile_id>_<task_or_run>.yaml',
  existsCheck: false,
};

export const DEFAULT_APP_CONTRACT_SSOT: AppContractSsotMode = 'REPO.LOCAL';
export const RUNTIME_CONFIG_REL_PATH = '.frida/config.yaml';
export const RUNTIME_CONFIG_TEMPLATE_REL_PATH = '.frida/config.template.yaml';
export const JOB_REPORTS_GLOB = '.frida/reports/*.yaml';

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_CONFIG_SCHEMA_PATH = path.resolve(MODULE_DIR, '../schemas/frida-runtime-config.schema.json');
const RUNTIME_CONFIG_OVERRIDE_SCHEMA_PATH = path.resolve(MODULE_DIR, '../schemas/frida-runtime-config.override.schema.json');

type ValidatorFn = (payload: unknown) => { ok: boolean; message: string };

let strictRuntimeConfigValidator: ValidatorFn | null = null;
let overrideRuntimeConfigValidator: ValidatorFn | null = null;

function createValidator(schemaPath: string): ValidatorFn {
  const schemaRaw = fs.readFileSync(schemaPath, 'utf-8');
  const schema = JSON.parse(schemaRaw);
  const AjvCtor: any = (Ajv2020 as any).default || Ajv2020;
  const addFormatsFn: any = (addFormats as any).default || addFormats;
  const ajv = new AjvCtor({ allErrors: true, strict: false });
  addFormatsFn(ajv);
  const validate = ajv.compile(schema);

  return (payload: unknown) => {
    const ok = Boolean(validate(payload));
    if (ok) return { ok: true, message: '' };
    const message = (validate.errors || [])
      .map((error: any) => `${error.instancePath || '/'} ${error.message || 'invalid'}`)
      .join('; ');
    return { ok: false, message };
  };
}

function getStrictRuntimeConfigValidator(): ValidatorFn {
  if (!strictRuntimeConfigValidator) {
    strictRuntimeConfigValidator = createValidator(RUNTIME_CONFIG_SCHEMA_PATH);
  }
  return strictRuntimeConfigValidator;
}

function getOverrideRuntimeConfigValidator(): ValidatorFn {
  if (!overrideRuntimeConfigValidator) {
    overrideRuntimeConfigValidator = createValidator(RUNTIME_CONFIG_OVERRIDE_SCHEMA_PATH);
  }
  return overrideRuntimeConfigValidator;
}

function assertRuntimeConfigOverrideValid(payload: unknown, configPathForError: string): void {
  const validation = getOverrideRuntimeConfigValidator()(payload);
  if (!validation.ok) {
    throw new Error(`runtime config override validation failed (${configPathForError}): ${validation.message}`);
  }
}

function assertRuntimeConfigStrictValid(payload: unknown, label: string): void {
  const validation = getStrictRuntimeConfigValidator()(payload);
  if (!validation.ok) {
    throw new Error(`runtime config schema validation failed (${label}): ${validation.message}`);
  }
}

function getRuntimeConfigAbsolutePath(rootDir: string): string {
  return path.resolve(rootDir, RUNTIME_CONFIG_REL_PATH);
}

function getRuntimeConfigTemplateAbsolutePath(rootDir: string): string {
  return path.resolve(rootDir, RUNTIME_CONFIG_TEMPLATE_REL_PATH);
}

function parseRuntimeConfigYaml(absolutePath: string): RuntimeConfigOverrideFile {
  const raw = fs.readFileSync(absolutePath, 'utf-8');
  const parsed = yaml.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`runtime config file must be a YAML mapping (${absolutePath})`);
  }
  return parsed as RuntimeConfigOverrideFile;
}

function withUserRuntimeConfigHeader(yamlBody: string): string {
  return [
    '# FRIDA runtime config (user-owned)',
    '# Created once by FRIDA. Existing runtime config file values are not overwritten by the engine.',
    '',
    yamlBody.trimEnd(),
    '',
  ].join('\n');
}

function withRuntimeConfigTemplateHeader(yamlBody: string): string {
  return [
    '# FRIDA runtime config template (engine-managed reference)',
    '# Compare this file with .frida/config.yaml when upgrading the engine.',
    '# Copy missing keys into the runtime config file manually; FRIDA does not overwrite user-owned runtime config values.',
    '',
    yamlBody.trimEnd(),
    '',
  ].join('\n');
}

export function ensureContractReportingSettings(contract: Record<string, any>): { changed: boolean; settings: ReportingSettings } {
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

export function getContractReportingSettings(contract: Record<string, any>): ReportingSettings {
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

export function toRuntimeConfig(
  settings: ReportingSettings,
  ssotMode: AppContractSsotMode = DEFAULT_APP_CONTRACT_SSOT
): RuntimeConfigFile {
  return {
    version: '1.1',
    APP_CONTRACT_SSOT: ssotMode,
    reporting: {
      collect_in_repo: true,
      repo_path: settings.repoPath,
      file_ext: '.yaml',
      filename_pattern: '<unixtime_ms>_<profile_id>_<task_or_run>.yaml',
      exists_check: false,
    },
  };
}

export function readRuntimeConfigOverride(rootDir: string): RuntimeConfigOverrideFile | null {
  const runtimeConfigPath = getRuntimeConfigAbsolutePath(rootDir);
  if (!fs.existsSync(runtimeConfigPath)) {
    return null;
  }
  return parseRuntimeConfigYaml(runtimeConfigPath);
}

export function resolveEffectiveRuntimeConfig(
  rootDir: string,
  reportingDefaults: ReportingSettings = REPORTING_SETTINGS_FIXED
): ResolvedRuntimeConfig {
  const warnings: string[] = [];
  const runtimeConfigPath = getRuntimeConfigAbsolutePath(rootDir);
  const defaults = toRuntimeConfig(reportingDefaults);
  let rawConfig = readRuntimeConfigOverride(rootDir);

  if (!rawConfig) {
    assertRuntimeConfigStrictValid(defaults, 'defaults');
    return {
      effectiveConfig: defaults,
      rawConfig: null,
      warnings: [],
      source: 'default',
    };
  }

  assertRuntimeConfigOverrideValid(rawConfig, runtimeConfigPath);

  const effective = toRuntimeConfig(reportingDefaults);
  let usedDefaults = false;
  const rawObject = asObject(rawConfig);

  const rawVersion = typeof rawObject.version === 'string' ? rawObject.version : null;
  if (!rawVersion) {
    warnings.push(`runtime config file is missing version (${RUNTIME_CONFIG_REL_PATH}); using compatibility defaults for missing keys`);
    usedDefaults = true;
  } else if (rawVersion === '1.0') {
    warnings.push(`runtime config file version 1.0 detected (${RUNTIME_CONFIG_REL_PATH}); defaulting missing keys for runtime config compatibility`);
    usedDefaults = true;
  } else if (rawVersion !== '1.1') {
    warnings.push(`runtime config file version ${rawVersion} is not recognized; attempting compatibility merge with defaults`);
    usedDefaults = true;
  }

  if (rawObject.APP_CONTRACT_SSOT === 'REPO.LOCAL' || rawObject.APP_CONTRACT_SSOT === 'REPO.WIKI') {
    effective.APP_CONTRACT_SSOT = rawObject.APP_CONTRACT_SSOT;
  } else {
    warnings.push(`runtime config file is missing APP_CONTRACT_SSOT in ${RUNTIME_CONFIG_REL_PATH}; defaulting to ${DEFAULT_APP_CONTRACT_SSOT}`);
    usedDefaults = true;
  }

  const rawReporting = asObject(rawObject.reporting);
  if (Object.keys(rawReporting).length === 0) {
    if (!('reporting' in rawObject)) {
      warnings.push(`runtime config file is missing reporting block in ${RUNTIME_CONFIG_REL_PATH}; default reporting settings will be used`);
      usedDefaults = true;
    }
  }

  if (typeof rawReporting.repo_path === 'string' && rawReporting.repo_path.trim().length > 0) {
    effective.reporting.repo_path = rawReporting.repo_path;
    if (rawReporting.repo_path === '.frida/job-reports') {
      warnings.push(
        `runtime config file uses legacy reporting.repo_path=.frida/job-reports in ${RUNTIME_CONFIG_REL_PATH}; this is supported but new defaults use .frida/reports`
      );
    }
  } else if ('reporting' in rawObject && 'repo_path' in rawReporting) {
    usedDefaults = true;
  }

  assertRuntimeConfigStrictValid(effective, 'effective');

  return {
    effectiveConfig: effective,
    rawConfig,
    warnings,
    source: usedDefaults ? 'runtime+defaults' : 'runtime',
  };
}

export function readRuntimeConfig(
  rootDir: string,
  reportingDefaults: ReportingSettings = REPORTING_SETTINGS_FIXED
): RuntimeConfigFile | null {
  const resolved = resolveEffectiveRuntimeConfig(rootDir, reportingDefaults);
  return resolved.source === 'default' ? null : resolved.effectiveConfig;
}

export function writeRuntimeConfig(rootDir: string, config: RuntimeConfigFile): string {
  const absoluteConfigPath = getRuntimeConfigAbsolutePath(rootDir);
  fs.mkdirSync(path.dirname(absoluteConfigPath), { recursive: true });
  fs.writeFileSync(absoluteConfigPath, withUserRuntimeConfigHeader(yaml.stringify(config)), 'utf-8');
  return absoluteConfigPath;
}

export function writeRuntimeConfigTemplate(rootDir: string, config: RuntimeConfigFile): string {
  const absoluteTemplatePath = getRuntimeConfigTemplateAbsolutePath(rootDir);
  fs.mkdirSync(path.dirname(absoluteTemplatePath), { recursive: true });
  fs.writeFileSync(absoluteTemplatePath, withRuntimeConfigTemplateHeader(yaml.stringify(config)), 'utf-8');
  return absoluteTemplatePath;
}

export function ensureRuntimeConfigArtifacts(
  rootDir: string,
  reportingDefaults: ReportingSettings = REPORTING_SETTINGS_FIXED
): EnsureRuntimeConfigArtifactsResult {
  const runtimeConfigPath = getRuntimeConfigAbsolutePath(rootDir);
  const templatePath = getRuntimeConfigTemplateAbsolutePath(rootDir);
  const runtimeConfigExisted = fs.existsSync(runtimeConfigPath);
  const resolved = resolveEffectiveRuntimeConfig(rootDir, reportingDefaults);
  const templateConfig = toRuntimeConfig(reportingDefaults);

  assertRuntimeConfigStrictValid(templateConfig, 'template');
  assertRuntimeConfigStrictValid(resolved.effectiveConfig, 'effective');

  writeRuntimeConfigTemplate(rootDir, templateConfig);
  let createdRuntimeConfig = false;
  if (!runtimeConfigExisted) {
    writeRuntimeConfig(rootDir, templateConfig);
    createdRuntimeConfig = true;
  }

  return {
    ...resolved,
    runtimeConfigPath,
    templatePath,
    createdRuntimeConfig,
    wroteTemplate: true,
    runtimeConfigExisted,
  };
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
