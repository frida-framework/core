import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const DEFAULT_PROJECT_REF = "gorsxaqhpxsikawsryfp";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const configPath = path.join(repoRoot, "supabase", "config.toml");

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");

let token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("SUPABASE_ACCESS_TOKEN not found, using SUPABASE_SERVICE_ROLE_KEY as fallback.");
  token = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_ACCESS_TOKEN = token;
}

if (!token) {
  console.error(
    "SUPABASE_ACCESS_TOKEN is not set. PowerShell: $env:SUPABASE_ACCESS_TOKEN=\"sbp_...\"; bash: export SUPABASE_ACCESS_TOKEN=\"sbp_...\""
  );
  process.exit(1);
}
console.warn(
  "WARNING: SUPABASE_ACCESS_TOKEN does not start with \"sbp_\". This might fail."
);
// process.exit(1); // Proceed anyway as key might be different type

let projectRef = process.env.SUPABASE_PROJECT_REF;
if (!projectRef && fs.existsSync(configPath)) {
  const config = fs.readFileSync(configPath, "utf8");
  const match = config.match(/project_id\s*=\s*"([^"]+)"/);
  if (match?.[1]) {
    projectRef = match[1];
  }
}
if (!projectRef) {
  projectRef = DEFAULT_PROJECT_REF;
}
if (!projectRef) {
  console.error("Unable to resolve Supabase project ref.");
  process.exit(1);
}

const localBin = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "supabase.cmd" : "supabase"
);

let supabaseCmd = null;
if (fs.existsSync(localBin)) {
  supabaseCmd = localBin;
} else {
  const versionCheck = spawnSync("supabase", ["--version"], { stdio: "ignore" });
  if (versionCheck.status === 0) {
    supabaseCmd = "supabase";
  }
}

if (!supabaseCmd) {
  console.error(
    "Supabase CLI not found. Install it with `npm install` (local) or `npm install -g supabase` (global), then re-run."
  );
  process.exit(1);
}

const useShell = process.platform === "win32" && supabaseCmd.endsWith(".cmd");

const supportsYes = (commandArgs) => {
  const result = spawnSync(supabaseCmd, [...commandArgs, "--help"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: useShell,
  });
  if (result.status !== 0) {
    return false;
  }
  return (result.stdout || "").includes("--yes");
};

const runSupabase = (commandArgs) => {
  const result = spawnSync(supabaseCmd, commandArgs, {
    stdio: "inherit",
    shell: useShell,
    env: {
      ...process.env,
      SUPABASE_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD,
    },
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

console.log(`Linking Supabase project: ${projectRef}`);
const linkArgs = ["link", "--project-ref", projectRef];
if (supportsYes(["link"])) {
  linkArgs.push("--yes");
}
runSupabase(linkArgs);

const pushArgs = ["db", "push"];
if (isDryRun) {
  pushArgs.push("--dry-run");
}
if (supportsYes(["db", "push"])) {
  pushArgs.push("--yes");
}
runSupabase(pushArgs);
