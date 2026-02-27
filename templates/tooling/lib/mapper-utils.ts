import fs from 'node:fs';
import path from 'node:path';

export const repoRoot = path.resolve(process.cwd());

export function resolvePath(relativePath: string): string {
  return path.resolve(repoRoot, relativePath);
}

export function readFile(relativePath: string): string {
  const fullPath = resolvePath(relativePath);
  return fs.readFileSync(fullPath, 'utf8');
}

export function writeFile(relativePath: string, content: string): void {
  const fullPath = resolvePath(relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

export function ensureFileExists(relativePath: string): void {
  const fullPath = resolvePath(relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Файл не найден: ${relativePath}`);
  }
}

export function fileExists(relativePath: string): boolean {
  const fullPath = resolvePath(relativePath);
  return fs.existsSync(fullPath);
}

export function copyFile(sourceRelative: string, targetRelative: string): void {
  const source = resolvePath(sourceRelative);
  const target = resolvePath(targetRelative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

export function copyDir(sourceRelative: string, targetRelative: string): void {
  const source = resolvePath(sourceRelative);
  const target = resolvePath(targetRelative);
  fs.mkdirSync(target, { recursive: true });
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(path.relative(repoRoot, srcPath), path.relative(repoRoot, destPath));
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function logStep(title: string): void {
  console.log(`\n▶ ${title}`);
}

export function formatSection(title: string, body: string): string {
  return `\n=== ${title} ===\n${body.trim()}`;
}

export function upsertBetweenMarkers(
  content: string,
  markerStart: string,
  markerEnd: string,
  payload: string,
): string {
  const startIndex = content.indexOf(markerStart);
  const endIndex = content.indexOf(markerEnd);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error('Не удалось найти маркеры для вставки содержимого.');
  }

  const before = content.slice(0, startIndex + markerStart.length);
  const after = content.slice(endIndex);

  return `${before}\n${payload.trim()}\n${after}`;
}

export function ensureDirectory(relativePath: string): void {
  const fullPath = resolvePath(relativePath);
  fs.mkdirSync(fullPath, { recursive: true });
}
