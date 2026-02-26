import * as fs from 'fs';
import * as path from 'path';

export interface FridaDeploymentMarkers {
  runtimeConfigTemplate: boolean;
  contractSpecsRouter: boolean;
  legacyFridaSpecsRouter: boolean;
  legacySpecsRouter: boolean;
  contractProfilesDir: boolean;
  legacyFridaProfilesDir: boolean;
  legacyProfilesDir: boolean;
  bootloaderAgents: boolean;
  fridaContractBootloaderAgents: boolean;
  fridaBootloaderAgents: boolean;
}

export interface FridaDeploymentDetection {
  targetDir: string;
  present: boolean;
  markerCount: number;
  markers: FridaDeploymentMarkers;
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

export function detectFridaDeployment(targetDir: string): FridaDeploymentDetection {
  const absoluteTargetDir = path.resolve(targetDir);
  const markers: FridaDeploymentMarkers = {
    runtimeConfigTemplate: fs.existsSync(path.join(absoluteTargetDir, '.frida', 'config.template.yaml')),
    contractSpecsRouter: fs.existsSync(path.join(absoluteTargetDir, '.frida', 'contract', 'specs', 'ROUTER.xml')),
    legacyFridaSpecsRouter: fs.existsSync(path.join(absoluteTargetDir, '.frida', 'specs', 'ROUTER.xml')),
    legacySpecsRouter: fs.existsSync(path.join(absoluteTargetDir, '.specs', 'ROUTER.xml')),
    contractProfilesDir: isNonEmptyDir(path.join(absoluteTargetDir, '.frida', 'contract', 'profiles')),
    legacyFridaProfilesDir: isNonEmptyDir(path.join(absoluteTargetDir, '.frida', 'profiles')),
    legacyProfilesDir: isNonEmptyDir(path.join(absoluteTargetDir, '.specs', 'profiles')),
    bootloaderAgents: fileContainsAll(path.join(absoluteTargetDir, 'AGENTS.md'), [
      'AUTO-GENERATED FROM CONTRACT',
      'FRIDA',
    ]),
    fridaContractBootloaderAgents: fileContainsAll(path.join(absoluteTargetDir, '.frida', 'contract', 'AGENTS.md'), [
      'AUTO-GENERATED FROM CONTRACT',
      'FRIDA',
    ]),
    fridaBootloaderAgents: fileContainsAll(path.join(absoluteTargetDir, '.frida', 'AGENTS.md'), [
      'AUTO-GENERATED FROM CONTRACT',
      'FRIDA',
    ]),
  };

  const markerCount = Object.values(markers).filter(Boolean).length;
  return {
    targetDir: absoluteTargetDir,
    present: markerCount > 0,
    markerCount,
    markers,
  };
}
