import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type CorePackageName = '@frida-framework/core' | '@hanszel/core' | 'local-dist';

type LoadedCore = {
  module: Record<string, unknown>;
  packageName: CorePackageName;
  schemaRef: string;
};

const dynamicImport = async (specifier: string): Promise<Record<string, unknown>> =>
  (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;

const REPO_ROOT = path.resolve(process.env.FRIDA_REPO_ROOT || process.cwd());

async function loadLocalDist(): Promise<LoadedCore | null> {
  const candidates = [
    path.resolve(REPO_ROOT, 'dist', 'index.js'),
    path.resolve(REPO_ROOT, '..', 'frida', 'dist', 'index.js'),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    const packageRoot = path.resolve(candidate, '..', '..');
    const schemaPath = path.join(packageRoot, 'schemas', 'frida-contract.schema.json');
    const module = await dynamicImport(pathToFileURL(candidate).href);

    return {
      module,
      packageName: 'local-dist',
      schemaRef: existsSync(schemaPath) ? schemaPath : 'schemas/frida-contract.schema.json',
    };
  }

  return null;
}

async function loadCorePackage(): Promise<LoadedCore> {
  try {
    const module = await dynamicImport('@frida-framework/core');
    return {
      module,
      packageName: '@frida-framework/core',
      schemaRef: '@frida-framework/core/schemas/frida-contract.schema.json',
    };
  } catch (primaryError) {
    try {
      const module = await dynamicImport('@hanszel/core');
      return {
        module,
        packageName: '@hanszel/core',
        schemaRef: '@hanszel/core/schemas/frida-contract.schema.json',
      };
    } catch (fallbackError) {
      const local = await loadLocalDist();
      if (local) {
        return local;
      }

      const details = {
        primary:
          primaryError instanceof Error
            ? primaryError.message
            : String(primaryError),
        fallback:
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError),
        localDistTried: [
          path.resolve(REPO_ROOT, 'dist', 'index.js'),
          path.resolve(REPO_ROOT, '..', 'frida', 'dist', 'index.js'),
        ],
      };
      throw new Error(
        `Unable to load FRIDA core package. Tried @frida-framework/core, @hanszel/core, and local dist fallbacks. ${JSON.stringify(details)}`,
      );
    }
  }
}

const loadedCore = await loadCorePackage();
const coreModule = loadedCore.module;

function requireExport<T>(name: string): T {
  const value = coreModule[name];
  if (value === undefined) {
    throw new Error(`FRIDA core export "${name}" is missing in ${loadedCore.packageName}`);
  }
  return value as T;
}

export const fridaCorePackageName: CorePackageName = loadedCore.packageName;
export const fridaContractSchemaRef = loadedCore.schemaRef;

export const runFridaGeneration = requireExport<(options: unknown) => Promise<void>>('runFridaGeneration');
export const runFridaMigrationReport = requireExport<(options: unknown) => number>('runFridaMigrationReport');
export const runFridaHashCli = requireExport<() => number>('runFridaHashCli');
export const runFridaCheckCli = requireExport<(args: string[]) => Promise<number>>('runFridaCheckCli');
export const loadZones = requireExport<() => Zone[]>('loadZones');
export const resolveZone = requireExport<(targetPath: string, zones: Zone[]) => ZoneResolution>('resolveZone');
export const getExpectedAgentsMd = requireExport<(zone: Zone) => string>('getExpectedAgentsMd');
export const validateZoneAgentsMd = requireExport<(targetPath: string) => ValidationResult>('validateZoneAgentsMd');

export type FridaAdapter = Record<string, unknown>;
export type Zone = Record<string, unknown>;
export type ZoneCandidate = Record<string, unknown>;
export type DecisionStep = Record<string, unknown>;
export type ValidationResult = {
  ok?: boolean;
  [key: string]: unknown;
};

type ZoneResolution = {
  zone?: Zone;
  trace?: unknown;
};
