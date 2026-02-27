import { readFile, writeFile, upsertBetweenMarkers, logStep } from './lib/mapper-utils';

const FONTS_START = '/* === FONTS ZONE === */';
const FONTS_END = '/* === END FONTS ZONE === */';

logStep('Чтение style/index.html для поиска шрифтов');
const styleHtml = readFile('dist/aistudio/style/index.html');
const fontHrefMatch = styleHtml.match(/<link[^>]*href="([^"]*fonts\.googleapis\.com[^"]*)"[^>]*>/i);

if (!fontHrefMatch) {
  console.warn('⚠️ Не найден тег <link> с Google Fonts в dist/style/index.html');
  process.exit(0);
}

const fontHref = fontHrefMatch[1];
logStep(`Найден шрифт: ${fontHref}`);

const indexCss = readFile('src/index.css');

if (indexCss.includes(`@import url('${fontHref}')`)) {
  console.log('✅ Шрифты уже подключены, пропускаем обновление.');
  process.exit(0);
}

const updated = upsertBetweenMarkers(indexCss, FONTS_START, FONTS_END, `
/* Маппер подключает шрифты автоматически, не редактируйте вручную */
@import url('${fontHref}');
`);

writeFile('src/index.css', updated);
console.log('✅ Шрифты добавлены в src/index.css');
