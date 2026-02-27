import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Находим корень проекта относительно расположения скрипта, чтобы корректно
// собирать путь и на Windows, и в Unix-средах (без дублирования диска вроде
// "C:\\C:\\..."). Если package.json не найден рядом, поднимаемся вверх по
// директориям, пока не найдём его.
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function findProjectRoot(startDir) {
  let dir = startDir;

  while (true) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

const projectRoot =
  findProjectRoot(path.resolve(scriptDir, "..")) ||
  findProjectRoot(process.cwd());

if (!projectRoot) {
  console.error("❌ Не удалось найти package.json. Запустите скрипт из корня проекта.");
  process.exit(1);
}

const targets = [
  {
    label: "dayjs/locale/es",
    targetPath: ["node_modules", "dayjs", "locale", "es.js"],
    installAs: "dayjs",
  },
  {
    label: "leaflet",
    targetPath: ["node_modules", "leaflet"],
    installAs: "leaflet",
  },
  {
    label: "leaflet/dist/leaflet.css",
    targetPath: ["node_modules", "leaflet", "dist", "leaflet.css"],
    installAs: "leaflet",
  },
];

const missing = targets.filter(({ targetPath }) => {
  const absolutePath = path.join(projectRoot, ...targetPath);
  return !fs.existsSync(absolutePath);
});

if (missing.length === 0) {
  console.log("✅ Все обязательные зависимости найдены. Запускайте Vite без опасений!");
  process.exit(0);
}

console.error("⚠️ Найдены отсутствующие зависимости:");
missing.forEach(({ label }) => console.error(` - ${label}`));
console.error(
  "Запустите `npm install` в корне проекта, чтобы подтянуть пакеты. После установки ошибка Vite должна исчезнуть."
);

const packageJsonPath = path.join(projectRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const deps = packageJson.dependencies ?? {};

const missingPackages = [
  ...new Set(
    missing
      .map(({ installAs }) => installAs)
      .filter(Boolean)
  ),
]
  .map((pkg) => (deps[pkg] ? `${pkg}@${deps[pkg]}` : pkg))
  .filter(Boolean);

if (missingPackages.length > 0) {
  console.error("Можно установить только недостающие пакеты этой командой:");
  console.error(`  npm install ${missingPackages.join(" ")}`);
}
process.exit(1);
