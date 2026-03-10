import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  getManifestEntryTargetOrThrow,
  loadBootstrapPackageManifest,
} from './bootstrap-manifest.ts';
import { GENERATED_SURFACE_MARKERS } from './frida-surface-policy.ts';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface FridaDeploymentMarkers {
  runtimeConfigTemplate: boolean;
  contractSpecsRouter: boolean;
  retiredFridaSpecsRouter: boolean;
  retiredSpecsRouter: boolean;
  contractProfilesDir: boolean;
  retiredFridaProfilesDir: boolean;
  retiredSpecsProfilesDir: boolean;
  bootloaderAgents: boolean;
  fridaContractBootloaderAgents: boolean;
  fridaManagedZoneAgents: boolean;
}

export interface FridaDeploymentDetection {
  targetDir: string;
  present: boolean;
  markerCount: number;
  markers: FridaDeploymentMarkers;
}

interface DeploymentMarkerPaths {
  runtimeConfigTemplateFile: string;
  contractSpecsRouterFile: string;
  retiredFridaSpecsRouterFile: string;
  retiredSpecsRouterFile: string;
  contractProfilesDir: string;
  retiredFridaProfilesDir: string;
  retiredSpecsProfilesDir: string;
  bootloaderAgentsFile: string;
  fridaContractBootloaderAgentsFile: string;
  fridaManagedZoneAgentsFile: string;
}

function isNonEmptyDir(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return false;
  if (!fs.statSync(dirPath).isDirectory()) return false;
  return fs.readdirSync(dirPath).length > 0;
}

function fileContainsAll(filePath: string, requiredSnippets: string[]): boolean {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return requiredSnippets.every((snippet) => content.includes(snippet));
}

function loadDeploymentMarkerPaths(): DeploymentMarkerPaths {
  const { manifest } = loadBootstrapPackageManifest(PACKAGE_ROOT);
  const contractSpecsRoot = getManifestEntryTargetOrThrow(manifest, 'frida_contract_specs_root');
  const retiredFridaSpecsRoot = getManifestEntryTargetOrThrow(manifest, 'cleanup_frida_specs_root');
  const retiredSpecsRoot = getManifestEntryTargetOrThrow(manifest, 'cleanup_specs_root');

  return {
    runtimeConfigTemplateFile: getManifestEntryTargetOrThrow(manifest, 'frida_runtime_config_template'),
    contractSpecsRouterFile: path.posix.join(contractSpecsRoot, 'ROUTER.xml'),
    retiredFridaSpecsRouterFile: path.posix.join(retiredFridaSpecsRoot, 'ROUTER.xml'),
    retiredSpecsRouterFile: path.posix.join(retiredSpecsRoot, 'ROUTER.xml'),
    contractProfilesDir: getManifestEntryTargetOrThrow(manifest, 'frida_contract_profiles_root'),
    retiredFridaProfilesDir: getManifestEntryTargetOrThrow(manifest, 'cleanup_frida_profiles_root'),
    retiredSpecsProfilesDir: path.posix.join(retiredSpecsRoot, 'profiles'),
    bootloaderAgentsFile: getManifestEntryTargetOrThrow(manifest, 'frida_bootloader_agents'),
    fridaContractBootloaderAgentsFile: getManifestEntryTargetOrThrow(manifest, 'frida_bootloader_agents_internal'),
    fridaManagedZoneAgentsFile: getManifestEntryTargetOrThrow(manifest, 'frida_managed_zone_agents'),
  };
}

export function detectFridaDeployment(targetDir: string): FridaDeploymentDetection {
  const absoluteTargetDir = path.resolve(targetDir);
  const markerPaths = loadDeploymentMarkerPaths();
  const markers: FridaDeploymentMarkers = {
    runtimeConfigTemplate: fs.existsSync(path.join(absoluteTargetDir, markerPaths.runtimeConfigTemplateFile)),
    contractSpecsRouter: fs.existsSync(path.join(absoluteTargetDir, markerPaths.contractSpecsRouterFile)),
    retiredFridaSpecsRouter: fs.existsSync(path.join(absoluteTargetDir, markerPaths.retiredFridaSpecsRouterFile)),
    retiredSpecsRouter: fs.existsSync(path.join(absoluteTargetDir, markerPaths.retiredSpecsRouterFile)),
    contractProfilesDir: isNonEmptyDir(path.join(absoluteTargetDir, markerPaths.contractProfilesDir)),
    retiredFridaProfilesDir: isNonEmptyDir(path.join(absoluteTargetDir, markerPaths.retiredFridaProfilesDir)),
    retiredSpecsProfilesDir: isNonEmptyDir(path.join(absoluteTargetDir, markerPaths.retiredSpecsProfilesDir)),
    bootloaderAgents: fileContainsAll(path.join(absoluteTargetDir, markerPaths.bootloaderAgentsFile), [...GENERATED_SURFACE_MARKERS]),
    fridaContractBootloaderAgents: fileContainsAll(path.join(absoluteTargetDir, markerPaths.fridaContractBootloaderAgentsFile), [...GENERATED_SURFACE_MARKERS]),
    fridaManagedZoneAgents: fileContainsAll(path.join(absoluteTargetDir, markerPaths.fridaManagedZoneAgentsFile), [...GENERATED_SURFACE_MARKERS]),
  };

  const markerCount = Object.values(markers).filter(Boolean).length;
  return {
    targetDir: absoluteTargetDir,
    present: markerCount > 0,
    markerCount,
    markers,
  };
}
