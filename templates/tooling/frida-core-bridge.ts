type CorePackageName = '@frida-framework/core' | '@hanszel/core';

type LoadedCore = {
  module: Record<string, unknown>;
  packageName: CorePackageName;
};

const dynamicImport = async (specifier: string): Promise<Record<string, unknown>> =>
  (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;

async function loadCorePackage(): Promise<LoadedCore> {
  try {
    const module = await dynamicImport('@frida-framework/core');
    return { module, packageName: '@frida-framework/core' };
  } catch (primaryError) {
    try {
      const module = await dynamicImport('@hanszel/core');
      return { module, packageName: '@hanszel/core' };
    } catch (fallbackError) {
      const details = {
        primary:
          primaryError instanceof Error
            ? primaryError.message
            : String(primaryError),
        fallback:
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError),
      };
      throw new Error(
        `Unable to load FRIDA core package. Tried @frida-framework/core and @hanszel/core. ${JSON.stringify(details)}`,
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
export const fridaContractSchemaRef = `${fridaCorePackageName}/schemas/frida-contract.schema.json`;

export const runFridaGeneration = requireExport<(options: unknown) => Promise<void>>('runFridaGeneration');
export const runFridaMigrationReport = requireExport<(options: unknown) => number>('runFridaMigrationReport');
export const runFridaHashCli = requireExport<() => number>('runFridaHashCli');
export const runFridaCheckCli = requireExport<(args: string[]) => Promise<number>>('runFridaCheckCli');
export const loadZones = requireExport<() => Zone[]>('loadZones');
export const resolveZone = requireExport<(targetPath: string, zones: Zone[]) => ZoneResolution>('resolveZone');
export const getExpectedAgentsMd = requireExport<(zone: Zone) => string>('getExpectedAgentsMd');
export const validateZoneAgentsMd = requireExport<(targetPath: string) => ValidationResult>('validateZoneAgentsMd');

export type FridaAdapter = Record<string, unknown>;
export type FridaExtensionSpec = {
  generatorBindings?: string[];
} & Record<string, unknown>;
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
