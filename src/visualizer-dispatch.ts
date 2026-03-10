import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { loadContractDocument } from './contract-path.ts';

interface VisualizerModuleConfig {
  enabled: boolean;
  moduleRootDir: string | null;
  moduleRootAbs: string | null;
  moduleDistAbs: string | null;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolvePathRef(paths: Record<string, unknown> | undefined, ref: string | null): string | null {
  if (!isObjectLike(paths) || typeof ref !== 'string' || !ref.trim()) {
    return null;
  }

  const parts = ref.split('.');
  if (parts[0] !== 'PATHS') {
    return null;
  }

  let cursor: Record<string, unknown> | unknown = { PATHS: paths };
  for (const part of parts) {
    if (!isObjectLike(cursor) || !(part in cursor)) {
      return null;
    }
    cursor = cursor[part];
  }

  return typeof cursor === 'string' && cursor.trim() ? cursor : null;
}

function loadVisualizerModuleConfig(): VisualizerModuleConfig {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const loaded = loadContractDocument(packageRoot, 'contract/contract.index.yaml');
  const referenceViewer = isObjectLike(loaded.parsed?.FRIDA_VISUAL?.reference_viewer)
    ? loaded.parsed.FRIDA_VISUAL.reference_viewer
    : null;
  const moduleRootDirRef = referenceViewer && typeof referenceViewer.module_rootDirRef === 'string'
    ? referenceViewer.module_rootDirRef
    : null;
  const moduleRootDir = resolvePathRef(
    isObjectLike(loaded.parsed?.PATHS) ? (loaded.parsed.PATHS as Record<string, unknown>) : undefined,
    moduleRootDirRef,
  );
  const moduleRootAbs = moduleRootDir ? path.join(packageRoot, moduleRootDir) : null;

  return {
    enabled: Boolean(moduleRootDir),
    moduleRootDir,
    moduleRootAbs,
    moduleDistAbs: moduleRootAbs ? path.join(moduleRootAbs, 'dist') : null,
  };
}

export async function runFridaVisualViewerCli(args: string[] = []): Promise<number> {
  try {
    const config = loadVisualizerModuleConfig();
    if (!config.enabled || !config.moduleRootAbs || !config.moduleDistAbs || !fs.existsSync(config.moduleRootAbs)) {
      console.error('❌ frida-core visual-viewer failed: VISUALIZER_MODULE_DISABLED');
      return 1;
    }

    const entryFile = path.join(config.moduleDistAbs, 'visual-reference-viewer.js');
    if (!fs.existsSync(entryFile)) {
      console.error(
        `❌ frida-core visual-viewer failed: VISUALIZER_MODULE_BUILD_MISSING (${path.relative(process.cwd(), entryFile)})`
      );
      return 1;
    }

    const runtime = await import(pathToFileURL(entryFile).href);
    if (typeof runtime.runFridaVisualViewerCli !== 'function') {
      console.error('❌ frida-core visual-viewer failed: VISUALIZER_MODULE_INVALID');
      return 1;
    }
    return runtime.runFridaVisualViewerCli(args);
  } catch (error) {
    console.error(`❌ frida-core visual-viewer failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
