import fs from 'node:fs';
import path from 'node:path';

import { logStep } from '../lib/mapper-utils';

// Use style variant for visual design reference
const STYLE_HTML = path.resolve('dist/aistudio/style/index.html');
const USE_TAILWIND_CDN = false;
const INDEX_CSS = path.resolve('src/index.css');
const ROOT_INDEX_HTML = path.resolve('index.html');
const SRC_ROOT = path.resolve('src');

logStep('Чтение стилей из dist/aistudio/style/index.html');

if (!fs.existsSync(STYLE_HTML)) {
  console.warn(`⚠️  Не найден файл: ${STYLE_HTML}`);
  process.exit(0);
}

const styleHtml = fs.readFileSync(STYLE_HTML, 'utf8');
const styleBlocks = [...styleHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(([, css]) => css);

if (!styleBlocks.length) {
  console.warn('⚠️  В style/index.html нет стилей.');
  process.exit(0);
}

// Extract CSS variables from the style blocks
const variables: Record<string, string> = {};
const varRegex = /--([A-Za-z0-9-_]+)\s*:\s*([^;]+);/g;

for (const css of styleBlocks) {
  let match: RegExpExecArray | null;
  while ((match = varRegex.exec(css)) !== null) {
    const [, name, value] = match;
    variables[name.trim()] = value.trim();
  }
}

logStep('Извлечённые CSS переменные из style/index.html');
for (const [name, value] of Object.entries(variables)) {
  console.log(`- ${name}: ${value}`);
}

logStep('Обновление src/index.css с moto style стилями');

if (!fs.existsSync(INDEX_CSS)) {
  console.warn(`⚠️  Не найден файл: ${INDEX_CSS}`);
  process.exit(0);
}

const _enforceStyleCleanroom = () => {
  logStep('Style Cleanroom: проверка источников CSS');

  const allowedCssFiles = new Set([INDEX_CSS]);
  const cssFiles: string[] = [];
  const cssImports: Array<{ file: string; importPath: string }> = [];
  const inlineStyles: string[] = [];
  const forbiddenPackages: Array<{ file: string; pkg: string }> = [];
  const forbiddenStylePackages = [
    'styled-components',
    '@emotion/react',
    '@emotion/styled',
    '@mui/material/styles',
    'jss',
    'tss-react',
  ];

  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile()) {
        if (fullPath.endsWith('.css')) {
          cssFiles.push(fullPath);
        }
        if (/\.(t|j)sx?$/.test(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const importMatches = content.matchAll(/import\s+[^;]*['"]([^'"]+\.(css|scss|sass|less|styl))['"]/g);
          for (const match of importMatches) {
            cssImports.push({ file: fullPath, importPath: match[1] });
          }
          if (content.includes('style={{')) {
            inlineStyles.push(fullPath);
          }
          for (const pkg of forbiddenStylePackages) {
            const pkgRegex = new RegExp(`from\\s+['"]${pkg}['"]|require\\(['"]${pkg}['"]\\)`, 'g');
            if (pkgRegex.test(content)) {
              forbiddenPackages.push({ file: fullPath, pkg });
            }
          }
        }
      }
    }
  };

  walk(SRC_ROOT);

  const unexpectedCssFiles = cssFiles.filter((file) => !allowedCssFiles.has(file));
  const allowedCssImports = new Set([
    './index.css',
    '../index.css',
    '@/index.css',
  ]);
  const filteredCssImports = cssImports.filter((item) => !allowedCssImports.has(item.importPath));
  const indexCss = fs.readFileSync(INDEX_CSS, 'utf8');
  const importLines = [...indexCss.matchAll(/@import\s+url\(['"]([^'"]+)['"]\)\s*;/g)].map((m) => m[1]);
  const invalidImports = importLines.filter((url) => !url.includes('fonts.googleapis.com'));

  const errors: string[] = [];
  if (unexpectedCssFiles.length) {
    errors.push(`- Найдены дополнительные CSS файлы (разрешён только ${INDEX_CSS}).`);
  }
  if (filteredCssImports.length) {
    errors.push('- Найдены CSS импорты в коде компонентов.');
  }
  if (invalidImports.length) {
    errors.push('- Найдены @import, отличные от Google Fonts, в src/index.css.');
  }
  if (inlineStyles.length) {
    errors.push('- Найдены inline style={{...}} в компонентах.');
  }
  if (forbiddenPackages.length) {
    errors.push('- Найдены импорты CSS-in-JS библиотек.');
  }

  if (errors.length) {
    console.error('❌ Style Cleanroom нарушен:');
    for (const err of errors) {
      console.error(err);
    }
    if (unexpectedCssFiles.length) {
      console.error('Дополнительные CSS файлы:');
      for (const file of unexpectedCssFiles) {
        console.error(`  - ${file}`);
      }
    }
    if (filteredCssImports.length) {
      console.error('CSS импорты:');
      for (const item of filteredCssImports) {
        console.error(`  - ${item.file}: ${item.importPath}`);
      }
    }
    if (invalidImports.length) {
      console.error('Запрещённые @import в src/index.css:');
      for (const url of invalidImports) {
        console.error(`  - ${url}`);
      }
    }
    if (inlineStyles.length) {
      console.error('Inline styles:');
      for (const file of inlineStyles) {
        console.error(`  - ${file}`);
      }
    }
    if (forbiddenPackages.length) {
      console.error('CSS-in-JS импорты:');
      for (const item of forbiddenPackages) {
        console.error(`  - ${item.file}: ${item.pkg}`);
      }
    }
    process.exit(1);
  }

  console.log('✅ Style Cleanroom: OK');
};

// enforceStyleCleanroom();

const fontsUrlMatch = styleHtml.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"']+/);
const fontsUrl = fontsUrlMatch?.[0]
  ?? 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;500;600&family=Russo+One&display=swap';

const hexToRgb = (hex: string) => {
  const normalized = hex.replace('#', '').trim();
  if (normalized.length === 3) {
    const [r, g, b] = normalized.split('');
    return {
      r: parseInt(`${r}${r}`, 16),
      g: parseInt(`${g}${g}`, 16),
      b: parseInt(`${b}${b}`, 16),
    };
  }
  if (normalized.length !== 6) {
    return null;
  }
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
};

const rgbaFromVar = (varName: string, alpha: number) => {
  const value = variables[varName];
  if (!value) return null;
  const rgb = hexToRgb(value);
  if (!rgb) return null;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
};

const alphaOverrides = () => {
  const base50 = rgbaFromVar('bg-app', 0.5);
  const brand10 = rgbaFromVar('accent-color', 0.1);
  const brand30 = rgbaFromVar('accent-color', 0.3);
  const brand05 = rgbaFromVar('accent-color', 0.05);
  const inset80 = rgbaFromVar('bg-inset', 0.8);
  const inset50 = rgbaFromVar('bg-inset', 0.5);
  const surface90 = rgbaFromVar('bg-surface', 0.9);
  const surface95 = rgbaFromVar('bg-surface', 0.95);
  const border20 = rgbaFromVar('accent-color', 0.2);
  const border30 = rgbaFromVar('accent-color', 0.3);
  const ring30 = rgbaFromVar('accent-color', 0.3);
  const ring50 = rgbaFromVar('accent-color', 0.5);
  const muted50 = rgbaFromVar('text-muted', 0.5);

  if (
    !base50
    || !brand10
    || !brand30
    || !brand05
    || !inset80
    || !inset50
    || !surface90
    || !surface95
    || !border20
    || !border30
    || !ring30
    || !ring50
    || !muted50
  ) {
    console.warn('⚠️  Не удалось построить alpha overrides из CSS переменных.');
    return '';
  }

  return `
/* === MOTO STYLE ALPHA OVERRIDES (Tailwind vars parity) === */
.bg-moto-base\\/50 { background-color: ${base50}; }
.bg-moto-brand\\/10 { background-color: ${brand10}; }
.bg-moto-brand\\/30 { background-color: ${brand30}; }
.bg-moto-brand\\/5 { background-color: ${brand05}; }
.bg-moto-inset\\/80 { background-color: ${inset80}; }
.bg-moto-inset\\/50 { background-color: ${inset50}; }
.bg-moto-surface\\/90 { background-color: ${surface90}; }
.border-moto-brand\\/20 { border-color: ${border20}; }
.border-moto-brand\\/30 { border-color: ${border30}; }
.ring-moto-brand\\/30 { --tw-ring-color: ${ring30}; }
.ring-moto-brand\\/50 { --tw-ring-color: ${ring50}; }
.text-moto-muted\\/50 { color: ${muted50}; }
.via-moto-surface\\/90 {
  --tw-gradient-via: ${surface90};
  --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-via), var(--tw-gradient-to);
}
.via-moto-surface\\/95 {
  --tw-gradient-via: ${surface95};
  --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-via), var(--tw-gradient-to);
}
/* === END MOTO STYLE ALPHA OVERRIDES === */
`;
};

const themeOverrides = `
/* === MOTO THEME UTILITIES (Tailwind CDN runtime) === */
.bg-moto-base { background-color: var(--bg-app); }
.bg-moto-surface { background-color: var(--bg-surface); }
.bg-moto-inset { background-color: var(--bg-inset); }
.bg-moto-brand { background-color: var(--accent-color); }
.bg-moto-brand-hover { background-color: var(--accent-hover); }
.text-moto-text { color: var(--text-primary); }
.text-moto-text-sec { color: var(--text-secondary); }
.text-moto-muted { color: var(--text-muted); }
.text-moto-brand { color: var(--accent-color); }
.text-moto-brand-hover { color: var(--accent-hover); }
.border-moto-brand { border-color: var(--accent-color); }
.border-moto-brand-hover { border-color: var(--accent-hover); }
.ring-moto-brand { --tw-ring-color: var(--accent-color); }
.ring-moto-brand-hover { --tw-ring-color: var(--accent-hover); }
/* === END MOTO THEME UTILITIES === */
`;

const utilityOverrides = `
/* === MOTO STYLE UTILITY OVERRIDES (Tailwind CDN runtime parity) === */
.font-sans { font-family: 'Inter', sans-serif; }
.font-mono { font-family: 'JetBrains Mono', monospace; }
.font-russo { font-family: 'Russo One', sans-serif; }
.max-w-xl { max-width: 36rem; }
.max-w-md { max-width: 28rem; }
/* === END MOTO STYLE UTILITY OVERRIDES === */
`;
const baseReset = `
/* === BASE RESET (Tailwind preflight parity) === */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
button, input, select, textarea {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
}
button { cursor: pointer; }
a { color: inherit; text-decoration: none; }
/* === END BASE RESET === */
`;


const tailwindUtilityOverrides = `
/* === TAILWIND LITE UTILITIES (style App dependency) === */
.absolute { position: absolute; }
.relative { position: relative; }
.fixed { position: fixed; }
.flex { display: flex; }
.grid { display: grid; }
.block { display: block; }
.flex-1 { flex: 1 1 0%; }
.flex-col { flex-direction: column; }
.flex-grow { flex-grow: 1; }
.flex-wrap { flex-wrap: wrap; }
.grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
.grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.items-center { align-items: center; }
.justify-center { justify-content: center; }
.justify-between { justify-content: space-between; }
.justify-start { justify-content: flex-start; }
.shrink-0 { flex-shrink: 0; }
.appearance-none { appearance: none; }
.group\\/back { position: relative; }
.group\\/input { position: relative; }

.min-h-screen { min-height: 100vh; }
.max-w-xl { max-width: 36rem; }
.max-w-xs { max-width: 20rem; }
.max-w-md { max-width: 28rem; }
.max-h-\\[70vh\\] { max-height: 70vh; }
.w-full { width: 100%; }
.w-fit { width: fit-content; }
.w-1\\/3 { width: 33.333333%; }
.w-1 { width: 0.25rem; }
.w-0\\.5 { width: 0.125rem; }
.w-8 { width: 2rem; }
.w-20 { width: 5rem; }
.w-\\[600px\\] { width: 600px; }
.w-\\[800px\\] { width: 800px; }
.h-full { height: 100%; }
.h-0\\.5 { height: 0.125rem; }
.h-8 { height: 2rem; }
.h-12 { height: 3rem; }
.h-14 { height: 3.5rem; }
.h-20 { height: 5rem; }
.h-48 { height: 12rem; }
.h-\\[110px\\] { height: 110px; }
.h-\\[600px\\] { height: 600px; }
.h-\\[700px\\] { height: 700px; }
.h-\\[800px\\] { height: 800px; }

.overflow-hidden { overflow: hidden; }
.overflow-y-auto { overflow-y: auto; }
.pointer-events-none { pointer-events: none; }

.inset-0 { inset: 0; }
.inset-y-0 { top: 0; bottom: 0; }
.top-0 { top: 0; }
.top-1\\/2 { top: 50%; }
.top-4 { top: 1rem; }
.top-\\[-20%\\] { top: -20%; }
.bottom-2 { bottom: 0.5rem; }
.bottom-4 { bottom: 1rem; }
.bottom-\\[-10%\\] { bottom: -10%; }
.left-0 { left: 0; }
.left-2 { left: 0.5rem; }
.left-4 { left: 1rem; }
.left-\\[-10%\\] { left: -10%; }
.left-\\[15px\\] { left: 15px; }
.right-2 { right: 0.5rem; }
.right-\\[-10%\\] { right: -10%; }

.z-10 { z-index: 10; }
.\\-z-10 { z-index: -10; }
.z-50 { z-index: 50; }
.z-\\[999\\] { z-index: 999; }
.z-\\[1000\\] { z-index: 1000; }

.p-1 { padding: 0.25rem; }
.p-2 { padding: 0.5rem; }
.p-3 { padding: 0.75rem; }
.p-4 { padding: 1rem; }
.p-5 { padding: 1.25rem; }
.p-6 { padding: 1.5rem; }
.p-8 { padding: 2rem; }
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
.px-8 { padding-left: 2rem; padding-right: 2rem; }
.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
.py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
.py-4 { padding-top: 1rem; padding-bottom: 1rem; }
.py-6 { padding-top: 1.5rem; padding-bottom: 1.5rem; }
.py-10 { padding-top: 2.5rem; padding-bottom: 2.5rem; }
.pt-4 { padding-top: 1rem; }
.pt-6 { padding-top: 1.5rem; }
.pb-0\\.5 { padding-bottom: 0.125rem; }
.pb-2 { padding-bottom: 0.5rem; }
.pl-1 { padding-left: 0.25rem; }
.pl-12 { padding-left: 3rem; }
.pr-2 { padding-right: 0.5rem; }
.pr-4 { padding-right: 1rem; }
.pr-24 { padding-right: 6rem; }
.mt-3 { margin-top: 0.75rem; }
.mt-6 { margin-top: 1.5rem; }
.mt-10 { margin-top: 2.5rem; }
.mt-16 { margin-top: 4rem; }
.mb-2 { margin-bottom: 0.5rem; }
.mb-4 { margin-bottom: 1rem; }
.mb-6 { margin-bottom: 1.5rem; }
.mb-8 { margin-bottom: 2rem; }
.mx-2 { margin-left: 0.5rem; margin-right: 0.5rem; }
.mx-auto { margin-left: auto; margin-right: auto; }
.gap-1 { gap: 0.25rem; }
.gap-2 { gap: 0.5rem; }
.gap-3 { gap: 0.75rem; }
.gap-4 { gap: 1rem; }
.gap-5 { gap: 1.25rem; }
.space-y-3 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.75rem; }
.space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: 1rem; }
.space-y-5 > :not([hidden]) ~ :not([hidden]) { margin-top: 1.25rem; }
.space-y-6 > :not([hidden]) ~ :not([hidden]) { margin-top: 1.5rem; }
.space-y-8 > :not([hidden]) ~ :not([hidden]) { margin-top: 2rem; }
.space-y-10 > :not([hidden]) ~ :not([hidden]) { margin-top: 2.5rem; }

.rounded-lg { border-radius: 0.5rem; }
.rounded-xl { border-radius: 0.75rem; }
.rounded-2xl { border-radius: 1rem; }
.rounded-full { border-radius: 9999px; }
.rounded-\\[32px\\] { border-radius: 32px; }

.border { border-width: 1px; }
.border-b { border-bottom-width: 1px; }
.border-t { border-top-width: 1px; }
.border-none { border: 0; }

.ring-1 { box-shadow: 0 0 0 1px var(--tw-ring-color, rgba(255, 255, 255, 0.05)); }
.focus\\:ring-1:focus { box-shadow: 0 0 0 1px var(--tw-ring-color, rgba(255, 255, 255, 0.05)); }

.shadow-lg { box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -4px rgba(0, 0, 0, 0.4); }
.shadow-2xl { box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6); }
.shadow-\\[0_0_50px_0_rgba\\(0\\,0\\,0\\,0\\.5\\)\\] { box-shadow: 0 0 50px 0 rgba(0, 0, 0, 0.5); }
.shadow-\\[inset_0_2px_4px_rgba\\(0\\,0\\,0\\,0\\.1\\)\\] { box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1); }
.shadow-\\[inset_0_2px_4px_rgba\\(0\\,0\\,0\\,0\\.2\\)\\] { box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2); }
.shadow-\\[inset_0_2px_4px_rgba\\(0\\,0\\,0\\,0\\.3\\)\\] { box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3); }

.text-xs { font-size: 0.75rem; line-height: 1rem; }
.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.text-base { font-size: 1rem; line-height: 1.5rem; }
.text-lg { font-size: 1.125rem; line-height: 1.75rem; }
.text-xl { font-size: 1.25rem; line-height: 1.75rem; }
.text-2xl { font-size: 1.5rem; line-height: 2rem; }
.text-\\[10px\\] { font-size: 10px; line-height: 1.2; }

.font-bold { font-weight: 700; }
.font-light { font-weight: 300; }
.uppercase { text-transform: uppercase; }
.tracking-wide { letter-spacing: 0.025em; }
.tracking-wider { letter-spacing: 0.05em; }
.tracking-widest { letter-spacing: 0.1em; }
.tracking-tighter { letter-spacing: -0.02em; }
.leading-relaxed { line-height: 1.625; }
.whitespace-nowrap { white-space: nowrap; }

.bg-transparent { background-color: transparent; }
.bg-white\\/5 { background-color: rgba(255, 255, 255, 0.05); }
.bg-gray-200 { background-color: #e5e7eb; }
.bg-blue-500\\/5 { background-color: rgba(59, 130, 246, 0.05); }
.bg-red-500\\/10 { background-color: rgba(239, 68, 68, 0.1); }
.text-red-400 { color: #f87171; }
.border-red-500\\/20 { border-color: rgba(239, 68, 68, 0.2); }

.bg-gradient-to-br { background-image: linear-gradient(to bottom right, var(--tw-gradient-stops)); }
.bg-gradient-to-t { background-image: linear-gradient(to top, var(--tw-gradient-stops)); }
.to-transparent { --tw-gradient-to: transparent; }

.backdrop-blur { backdrop-filter: blur(12px); }
.backdrop-blur-sm { backdrop-filter: blur(6px); }
.backdrop-blur-md { backdrop-filter: blur(12px); }
.blur-\\[150px\\] { filter: blur(150px); }

.opacity-10 { opacity: 0.1; }
.opacity-20 { opacity: 0.2; }
.opacity-50 { opacity: 0.5; }

.transition-all { transition: all 0.3s ease; }
.transition-colors { transition: color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease; }
.transition-transform { transition: transform 0.3s ease; }
.duration-300 { transition-duration: 300ms; }
.duration-500 { transition-duration: 500ms; }
.duration-700 { transition-duration: 700ms; }
.duration-200 { transition-duration: 200ms; }

.animate-spin { animation: moto-spin 1s linear infinite; }
.animate-ping { animation: moto-ping 1.2s cubic-bezier(0, 0, 0.2, 1) infinite; }
.animate-in { animation: moto-fade-in 0.4s ease both; }
.fade-in { animation: moto-fade-in 0.4s ease both; }
.slide-in-from-top-2 { animation: moto-slide-top-2 0.4s ease both; }
.slide-in-from-top-4 { animation: moto-slide-top-4 0.4s ease both; }
.slide-in-from-bottom-8 { animation: moto-slide-bottom-8 0.5s ease both; }
.slide-in-from-right-8 { animation: moto-slide-right-8 0.5s ease both; }

@keyframes moto-spin { to { transform: rotate(360deg); } }
@keyframes moto-ping {
  75%, 100% { transform: scale(2); opacity: 0; }
}
@keyframes moto-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes moto-slide-top-2 { from { transform: translateY(-0.5rem); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes moto-slide-top-4 { from { transform: translateY(-1rem); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes moto-slide-bottom-8 { from { transform: translateY(2rem); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes moto-slide-right-8 { from { transform: translateX(2rem); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

.-translate-y-1\\/2 { transform: translateY(-50%); }
.group\\/back:hover .group-hover\\/back\\:-translate-x-1 { transform: translateX(-0.25rem); }
.group\\/back:hover .group-hover\\/back\\:translate-x-1 { transform: translateX(0.25rem); }
.group:hover .group-hover\\:translate-x-1 { transform: translateX(0.25rem); }
.rotate-45 { transform: rotate(45deg); }
.zoom-in-95 { transform: scale(0.95); }
.hover\\:bg-white\\/5:hover { background-color: rgba(255, 255, 255, 0.05); }
.hover\\:underline:hover { text-decoration: underline; }
.placeholder\\:text-moto-muted\\/50::placeholder { color: rgba(148, 163, 184, 0.5); }

.brightness-90 { filter: brightness(0.9); }
.grayscale-\\[0\\.2\\] { filter: grayscale(0.2); }
.custom-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: var(--bg-surface) var(--bg-app);
}
.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: var(--bg-app); }
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--bg-surface);
  border-radius: 10px;
  border: 1px solid #333;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover { background: var(--accent-color); }
/* === END TAILWIND LITE UTILITIES === */
`;

const motoVariantOverrides = () => {
  const brand30 = rgbaFromVar('accent-color', 0.3);
  const brand50 = rgbaFromVar('accent-color', 0.5);
  const muted50 = rgbaFromVar('text-muted', 0.5);

  if (!brand30 || !brand50 || !muted50) {
    console.warn('[styler-wizard] Missing computed color for moto variant overrides; skipping.');
    return '';
  }

  return `
/* === MOTO STYLE VARIANTS (hover/focus/gradient helpers) === */
.from-moto-inset {
  --tw-gradient-from: var(--bg-inset);
  --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to);
}
.from-moto-surface {
  --tw-gradient-from: var(--bg-surface);
  --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to);
}
.to-moto-base { --tw-gradient-to: var(--bg-app); }

.hover\\:text-moto-brand:hover { color: var(--accent-color); }
.hover\\:text-moto-brand-hover:hover { color: var(--accent-hover); }
.hover\\:text-moto-text:hover { color: var(--text-primary); }
.hover\\:border-moto-brand:hover { border-color: var(--accent-color); }

.group:hover .group-hover\\:border-moto-brand { border-color: var(--accent-color); }

.focus\\:ring-moto-brand\\/50:focus { --tw-ring-color: ${brand50}; }
.placeholder\\:text-moto-muted\\/50::placeholder { color: ${muted50}; }

.selection\\:bg-moto-brand\\/30::selection { background-color: ${brand30}; }
.selection\\:bg-moto-brand\\/30 *::selection { background-color: ${brand30}; }
/* === END MOTO STYLE VARIANTS === */
`;
};

const wizardColorOverrides = () => {
  const requiredVars = [
    'bg-app',
    'bg-surface',
    'bg-inset',
    'text-primary',
    'text-secondary',
    'text-muted',
    'accent-color',
    'accent-hover',
  ];
  for (const name of requiredVars) {
    if (!variables[name]) {
      console.warn(`[styler-wizard] Missing CSS var: ${name}. Skipping wizard overrides.`);
      return '';
    }
  }

  const base40 = rgbaFromVar('bg-app', 0.4);
  const base50 = rgbaFromVar('bg-app', 0.5);
  const base60 = rgbaFromVar('bg-app', 0.6);
  const base90 = rgbaFromVar('bg-app', 0.9);
  const surface20 = rgbaFromVar('bg-surface', 0.2);
  const surface30 = rgbaFromVar('bg-surface', 0.3);
  const surface40 = rgbaFromVar('bg-surface', 0.4);
  const surface50 = rgbaFromVar('bg-surface', 0.5);
  const surface60 = rgbaFromVar('bg-surface', 0.6);
  const surface80 = rgbaFromVar('bg-surface', 0.8);
  const inset80 = rgbaFromVar('bg-inset', 0.8);

  const accent10 = rgbaFromVar('accent-color', 0.1);
  const accent20 = rgbaFromVar('accent-color', 0.2);
  const accent30 = rgbaFromVar('accent-color', 0.3);
  const accent50 = rgbaFromVar('accent-color', 0.5);
  const accent30Light = rgbaFromVar('accent-hover', 0.3);

  const textSecondary10 = rgbaFromVar('text-secondary', 0.1);
  const textSecondary15 = rgbaFromVar('text-secondary', 0.15);
  const textMuted20 = rgbaFromVar('text-muted', 0.2);
  const textMuted25 = rgbaFromVar('text-muted', 0.25);
  const textMuted35 = rgbaFromVar('text-muted', 0.35);

  if (
    !base40
    || !base50
    || !base60
    || !base90
    || !surface20
    || !surface30
    || !surface40
    || !surface50
    || !surface60
    || !surface80
    || !inset80
    || !accent10
    || !accent20
    || !accent30
    || !accent50
    || !accent30Light
    || !textSecondary10
    || !textSecondary15
    || !textMuted20
    || !textMuted25
    || !textMuted35
  ) {
    console.warn('[styler-wizard] Missing computed color for wizard overrides; skipping.');
    return '';
  }

  return `
/* === WIZARD COLOR OVERRIDES (map wizard palette to moto theme) === */
.bg-slate-900 { background-color: var(--bg-app); }
.bg-slate-900\\/40 { background-color: ${base40}; }
.bg-slate-900\\/50 { background-color: ${base50}; }
.bg-slate-900\\/60 { background-color: ${base60}; }
.bg-slate-800 { background-color: var(--bg-surface); }
.bg-slate-800\\/20 { background-color: ${surface20}; }
.bg-slate-800\\/30 { background-color: ${surface30}; }
.bg-slate-800\\/40 { background-color: ${surface40}; }
.bg-slate-800\\/50 { background-color: ${surface50}; }
.bg-slate-700\\/80 { background-color: ${surface80}; }
.bg-black\\/80 { background-color: ${inset80}; }
.bg-indigo-500\\/10 { background-color: ${accent10}; }

.text-slate-200 { color: var(--text-secondary); }
.text-slate-300 { color: var(--text-secondary); }
.text-slate-400 { color: var(--text-muted); }
.text-slate-500 { color: var(--text-muted); }
.text-slate-600 { color: var(--text-muted); }
.text-white { color: var(--text-primary); }

.text-orange-500 { color: var(--accent-color); }
.text-orange-400 { color: var(--accent-hover); }
.text-orange-300 { color: var(--accent-hover); }

.bg-orange-500 { background-color: var(--accent-color); }
.bg-orange-500\\/10 { background-color: ${accent10}; }
.bg-orange-500\\/20 { background-color: ${accent20}; }
.bg-orange-600 { background-color: var(--accent-hover); }

.border-orange-500\\/30 { border-color: ${accent30}; }
.ring-orange-500\\/50 { --tw-ring-color: ${accent50}; }

.border-white\\/5 { border-color: ${textSecondary10}; }
.border-white\\/10 { border-color: ${textSecondary15}; }
.border-slate-700 { border-color: ${textMuted35}; }
.border-slate-700\\/50 { border-color: ${textMuted20}; }
.border-slate-800 { border-color: ${textMuted25}; }
.ring-white\\/5 { --tw-ring-color: ${textSecondary10}; }

.from-slate-800\\/40 {
  --tw-gradient-from: ${surface40};
  --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to);
}
.from-slate-900\\/90 {
  --tw-gradient-from: ${base90};
  --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to);
}
.via-slate-900\\/50 {
  --tw-gradient-via: ${base50};
  --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-via), var(--tw-gradient-to);
}
.to-slate-900\\/40 { --tw-gradient-to: ${base40}; }

.hover\\:bg-slate-800\\/50:hover { background-color: ${surface50}; }
.hover\\:bg-slate-800\\/60:hover { background-color: ${surface60}; }
.hover\\:bg-white\\/5:hover { background-color: ${textSecondary10}; }
.hover\\:text-slate-300:hover { color: var(--text-secondary); }
.hover\\:text-orange-300:hover { color: var(--accent-hover); }
.hover\\:text-orange-400:hover { color: var(--accent-hover); }
.hover\\:text-orange-500:hover { color: var(--accent-color); }
.hover\\:bg-orange-600:hover { background-color: var(--accent-hover); }
.hover\\:border-orange-500:hover { border-color: var(--accent-color); }

.focus\\:border-orange-500:focus { border-color: var(--accent-color); }
.focus\\:ring-orange-500\\/50:focus { --tw-ring-color: ${accent50}; }
.focus\\:ring-0:focus { --tw-ring-shadow: 0 0 #0000; }
.focus\\:outline-none:focus { outline: 0; }

.placeholder\\:text-slate-600::placeholder { color: var(--text-muted); }

.selection\\:bg-orange-500\\/30::selection { background-color: ${accent30}; }
.selection\\:bg-orange-500\\/30 *::selection { background-color: ${accent30}; }

.group:hover .group-hover\\:border-orange-500\\/50 { border-color: ${accent50}; }
.group:hover .group-hover\\:text-orange-500 { color: var(--accent-color); }
.group:hover .group-hover\\:bg-orange-500\\/20 { background-color: ${accent20}; }
.group:hover .group-hover\\:bg-orange-500\\/10 { background-color: ${accent10}; }
.group:hover .group-hover\\:shadow-\\[0_0_8px_rgba\\(249\\,115\\,22\\,0\\.5\\)\\] { box-shadow: 0 0 8px ${accent30Light}; }

.bg-transparent { background-color: transparent; }
.border-none { border: 0; }

input.bg-transparent,
textarea.bg-transparent,
select.bg-transparent {
  background-color: var(--bg-inset);
  box-shadow: var(--shadow-inset);
  border-bottom: var(--highlight-border);
}
/* === END WIZARD COLOR OVERRIDES === */
`;
};

const motoStylesSection = `
/* === MOTO STYLE GLOBAL STYLES (from dist/aistudio/style) === */

${USE_TAILWIND_CDN ? '' : baseReset}

${styleBlocks.join('\n').trim()}

${USE_TAILWIND_CDN ? '' : alphaOverrides()}

${USE_TAILWIND_CDN ? '' : themeOverrides}

${USE_TAILWIND_CDN ? '' : utilityOverrides}

${USE_TAILWIND_CDN ? '' : tailwindUtilityOverrides}

${USE_TAILWIND_CDN ? '' : motoVariantOverrides()}

${USE_TAILWIND_CDN ? '' : wizardColorOverrides()}

/* === END MOTO STYLE GLOBAL STYLES === */
`;

const rebuiltIndexCss = `/* === FONTS ZONE === */
/* Маппер подключает шрифты автоматически, не редактируйте вручную */
@import url('${fontsUrl}');
/* === END FONTS ZONE === */

${USE_TAILWIND_CDN ? '/* Tailwind utilities are provided at runtime via CDN. */' : `
@tailwind base;
@tailwind components;
@tailwind utilities;
`}

${motoStylesSection}
`;

fs.writeFileSync(INDEX_CSS, rebuiltIndexCss, 'utf8');
console.log('✅ Стили moto style перезаписаны в src/index.css (1:1 с dist/aistudio/style)');

logStep('Подключение Tailwind CDN в index.html');
if (fs.existsSync(ROOT_INDEX_HTML)) {
  let rootHtml = fs.readFileSync(ROOT_INDEX_HTML, 'utf8');
  const originalRootHtml = rootHtml;
  const indentBlock = (block: string, indent: string) =>
    block
      .split('\n')
      .map((line) => (line.length ? `${indent}${line}` : line))
      .join('\n');
  const insertIntoHead = (html: string, block: string) => {
    const headMatch = html.match(/<\/head>/i);
    if (!headMatch) return html;
    const indentMatch = html.match(/(^[ \t]*)<\/head>/im);
    const indent = indentMatch?.[1] ?? '';
    const normalized = indentBlock(block.trim(), indent);
    return html.replace(/^[ \t]*<\/head>/im, `${normalized}\n${indent}</head>`);
  };
  if (USE_TAILWIND_CDN) {
    const tailwindTag = '<script src="https://cdn.tailwindcss.com"></script>';
    if (!rootHtml.includes('cdn.tailwindcss.com')) {
      rootHtml = rootHtml.replace(/<\/head>/i, `  ${tailwindTag}\n  </head>`);
      console.log('✅ Tailwind CDN подключен в index.html');
    } else {
      console.log('ℹ️ Tailwind CDN уже подключен в index.html');
    }

    const tailwindConfigMatch = styleHtml.match(/<script>[\s\S]*?tailwind\.config[\s\S]*?<\/script>/i);
    if (tailwindConfigMatch && !rootHtml.includes('tailwind.config')) {
      rootHtml = rootHtml.replace(/<\/head>/i, `  ${tailwindConfigMatch[0]}\n  </head>`);
      console.log('✅ Tailwind config добавлен в index.html');
    }
  }

  const leafletMatch = styleHtml.match(/<link[^>]*href="https:\/\/unpkg\.com\/leaflet[^"]+"[^>]*>/i);
  if (leafletMatch && !rootHtml.includes('unpkg.com/leaflet')) {
    rootHtml = rootHtml.replace(/<\/head>/i, `  ${leafletMatch[0]}\n  </head>`);
    console.log('✅ Leaflet CSS добавлен в index.html');
  }

  // const inlineStyleContent = styleBlocks.join('\n').trim();
  // When using local build (USE_TAILWIND_CDN = false), we do NOT want to inject
  // the styles inline into index.html, because Vite will process src/index.css
  // (which now has @tailwind directives + our overrides) and inject them properly.
  if (USE_TAILWIND_CDN) {
    const inlineStyleBlock = `<style data-source="moto-style">\n${motoStylesSection}\n  </style>`;
    if (rootHtml.includes('data-source="moto-style"')) {
      rootHtml = rootHtml.replace(
        /<style data-source="moto-style">[\s\S]*?<\/style>/i,
        inlineStyleBlock,
      );
      console.log('✅ Style CSS обновлён inline в index.html');
    } else {
      rootHtml = insertIntoHead(rootHtml, inlineStyleBlock);
      console.log('✅ Style CSS инлайн вставлен в index.html');
    }
  } else {
    // Clean up inline styles if they exist from a previous run
    if (rootHtml.includes('data-source="moto-style"')) {
      rootHtml = rootHtml.replace(
        /<style data-source="moto-style">[\s\S]*?<\/style>/i,
        '',
      );
      console.log('✅ Style CSS удалён из index.html (используется @tailwind в src/index.css)');
    }
  }
  const fontsMatch = styleHtml.match(/<link[^>]*href="([^"]*fonts\.googleapis\.com[^"]*)"[^>]*>/i);
  if (fontsMatch) {
    const fontsLink = fontsMatch[0];
    const allFontsLinks = rootHtml.match(/<link[^>]*href="[^"]*fonts\.googleapis\.com[^"]*"[^>]*>/gi) || [];
    if (!rootHtml.includes(fontsMatch[1])) {
      if (allFontsLinks.length) {
        rootHtml = rootHtml.replace(allFontsLinks[0], fontsLink);
      } else {
        rootHtml = rootHtml.replace(/<\/head>/i, `  ${fontsLink}\n  </head>`);
      }
      console.log('✅ Fonts link синхронизирован с style');
    }
    if (allFontsLinks.length > 1) {
      for (const extraLink of allFontsLinks.slice(1)) {
        rootHtml = rootHtml.replace(extraLink, '');
      }
      console.log('✅ Лишние fonts ссылки удалены');
    }
  }

  if (rootHtml !== originalRootHtml) {
    fs.writeFileSync(ROOT_INDEX_HTML, rootHtml, 'utf8');
  }
} else {
  console.warn(`⚠️ index.html не найден: ${ROOT_INDEX_HTML}`);
}

logStep('Стили загружаются глобально через src/index.css');
console.log('   - Фон: radial-gradient(circle at 50% 0%, #1a1c24 0%, #0B0C10 80%)');
console.log('   - Шрифты: Inter, JetBrains Mono, Russo One');
console.log('   - Custom scrollbar и Leaflet стили применены');
console.log('   - Moto-классы: .city-tag, .btn-primary, .input-inset');
