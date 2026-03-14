import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { loadEffectiveVisualContractDocument } from '../../../../dist/visual-contract.js';
import { extractVisualSchemaOverlay, resolveVisualOverlayPath } from '../../../../dist/visual.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST_ROOT = path.resolve(MODULE_DIR);
const DEFAULT_REFERENCE_VIEWER_OUT = path.join('dist', 'reference-viewer', 'index.html');

function toAbsolutePath(rootDir: string, relativeOrAbsolute: string): string {
    if (path.isAbsolute(relativeOrAbsolute)) {
        return relativeOrAbsolute;
    }
    return path.join(rootDir, relativeOrAbsolute.replace(/^\.\//, '').replace(/^\/+/, ''));
}

function parseViewerArgs(args: string[]): {
    overlayPath: string | null;
    outputPath: string;
    title: string;
    contractPath: string | null;
} {
    const readFlag = (flag: string): string | null => {
        const idx = args.indexOf(flag);
        if (idx === -1 || idx + 1 >= args.length) {
            return null;
        }
        return args[idx + 1];
    };

    return {
        overlayPath: readFlag('--overlay'),
        outputPath: readFlag('--out') || DEFAULT_REFERENCE_VIEWER_OUT,
        title: readFlag('--title') || 'Frida Visual Overlay Reference Viewer',
        contractPath: readFlag('--contract'),
    };
}

function resolveDefaultOverlay(rootDir: string, contractPath: string | null): string {
    const loaded = loadEffectiveVisualContractDocument(rootDir, contractPath || undefined);
    return resolveVisualOverlayPath(loaded.parsed);
}

function buildOverlayFromContract(rootDir: string, contractPath: string | null): {
    overlayAbsolutePath: string;
    overlayRaw: string;
    overlay: Record<string, unknown>;
} {
    const loaded = loadEffectiveVisualContractDocument(rootDir, contractPath || undefined);
    const overlayRelativePath = resolveVisualOverlayPath(loaded.parsed);
    const overlay = extractVisualSchemaOverlay(loaded.parsed, loaded.raw, {
        sourcePath: path.relative(rootDir, loaded.contractPath).replace(/\\/g, '/'),
        outputPath: overlayRelativePath,
        contractPath: loaded.contractPath,
    }) as unknown as Record<string, unknown>;

    return {
        overlayAbsolutePath: toAbsolutePath(rootDir, overlayRelativePath),
        overlayRaw: JSON.stringify(overlay, null, 2),
        overlay,
    };
}

function loadOverlayFile(rootDir: string, requestedOverlayPath: string | null, contractPath: string | null): {
    overlayAbsolutePath: string;
    overlayRaw: string;
    overlay: Record<string, unknown>;
} {
    if (!requestedOverlayPath && contractPath) {
        return buildOverlayFromContract(rootDir, contractPath);
    }

    const effectiveOverlayPath = requestedOverlayPath || resolveDefaultOverlay(rootDir, contractPath);
    const overlayAbsolutePath = toAbsolutePath(rootDir, effectiveOverlayPath);
    if (!fs.existsSync(overlayAbsolutePath)) {
        throw new Error(
            `Overlay file not found: ${overlayAbsolutePath}. Run 'frida-core visual' first or pass --overlay <file>.`
        );
    }
    const overlayRaw = fs.readFileSync(overlayAbsolutePath, 'utf8');
    const overlay = JSON.parse(overlayRaw) as Record<string, unknown>;
    return { overlayAbsolutePath, overlayRaw, overlay };
}

function writeReferenceViewerAssets(outputHtmlPath: string): void {
    const outputDir = path.dirname(outputHtmlPath);
    fs.mkdirSync(outputDir, { recursive: true });

    const runtimeFiles = ['visual-reference-viewer-app.js', 'visual-viewer.js'];
    for (const fileName of runtimeFiles) {
        const source = path.join(DIST_ROOT, fileName);
        if (!fs.existsSync(source)) {
            throw new Error(`Required viewer runtime asset is missing: ${source}. Run 'npm run build' first.`);
        }
        fs.copyFileSync(source, path.join(outputDir, fileName));
    }
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function buildHtmlDocument(title: string, overlayRaw: string, overlayPath: string): string {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <div id="app"></div>
    <script id="frida-overlay-json" type="application/json">${escapeHtml(overlayRaw)}</script>
    <script type="module">
      import { mountVisualReferenceViewer } from './visual-reference-viewer-app.js';

      const overlay = JSON.parse(document.getElementById('frida-overlay-json').textContent);
      mountVisualReferenceViewer(document.getElementById('app'), overlay, {
        title: ${JSON.stringify(title)},
        overlayPath: ${JSON.stringify(overlayPath)}
      });
    </script>
  </body>
</html>
`;
}

export async function runFridaVisualViewerCli(args: string[] = []): Promise<number> {
    try {
        const parsedArgs = parseViewerArgs(args);
        const rootDir = process.cwd();
        const { overlayAbsolutePath, overlayRaw } = loadOverlayFile(rootDir, parsedArgs.overlayPath, parsedArgs.contractPath);
        const outputHtmlPath = toAbsolutePath(rootDir, parsedArgs.outputPath);

        writeReferenceViewerAssets(outputHtmlPath);
        fs.writeFileSync(
            outputHtmlPath,
            buildHtmlDocument(parsedArgs.title, overlayRaw, path.relative(rootDir, overlayAbsolutePath).replace(/\\/g, '/')),
            'utf8'
        );

        console.log(
            `✅ Visual reference viewer generated: overlay=${path.relative(rootDir, overlayAbsolutePath)} out=${path.relative(rootDir, outputHtmlPath)}`
        );
        return 0;
    } catch (error) {
        console.error(`❌ frida-core visual-viewer failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}
