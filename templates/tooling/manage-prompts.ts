import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase environment variables.');
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'create':
      await handleCreate(args);
      break;
    case 'list':
      await handleList(args);
      break;
    case 'activate':
      await handleActivate(args);
      break;
    case 'compare':
      await handleCompare(args);
      break;
    case 'export':
      await handleExport(args);
      break;
    default:
      printUsage();
      process.exit(1);
  }
}

async function handleCreate(args: string[]) {
  const [promptName, filePath, ...descriptionParts] = args;
  if (!promptName || !filePath) {
    console.error('Usage: npm run manage-prompts -- create <prompt_name> <file_path> [description]');
    process.exit(1);
  }

  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`Prompt file not found: ${fullPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const description = descriptionParts.join(' ') || null;
  const createdBy = process.env.PROMPT_AUTHOR_EMAIL || 'prompt-cli@katai.app';

  const { data, error } = await supabase
    .from('prompt_versions')
    .insert({
      prompt_name: promptName,
      content,
      description,
      created_by: createdBy,
    })
    .select('id, version, is_active')
    .single();

  if (error) {
    console.error('Failed to create prompt version:', error.message);
    process.exit(1);
  }

  console.log(`Created version v${data.version} (${data.id}) for ${promptName}`);
}

async function handleList(args: string[]) {
  const [promptName] = args;
  let query = supabase
    .from('prompt_versions')
    .select('id, prompt_name, version, description, is_active, activated_at, created_at, routes_generated, avg_tokens_used, avg_generation_time_ms, success_rate')
    .order('prompt_name')
    .order('version', { ascending: false });

  if (promptName) {
    query = query.eq('prompt_name', promptName);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Failed to fetch prompt versions:', error.message);
    process.exit(1);
  }

  if (!data?.length) {
    console.log('No prompt versions found.');
    return;
  }

  data.forEach((row) => {
    const activeMarker = row.is_active ? '🟢' : '⚪️';
    console.log(`${activeMarker} ${row.prompt_name} v${row.version} (${row.id})`);
    if (row.description) {
      console.log(`    ${row.description}`);
    }
    console.log(
      `    Metrics: ${row.routes_generated ?? 0} runs, avg ${row.avg_tokens_used ?? 0} tokens, ${row.avg_generation_time_ms ?? 0} ms, success ${(row.success_rate ?? 0) * 100}%`
    );
    console.log('');
  });
}

async function handleActivate(args: string[]) {
  const [versionId] = args;
  if (!versionId) {
    console.error('Usage: npm run manage-prompts -- activate <version_id>');
    process.exit(1);
  }

  const { error } = await supabase.rpc('activate_prompt_version', { version_id: versionId });
  if (error) {
    console.error('Failed to activate version:', error.message);
    process.exit(1);
  }

  console.log(`Activated prompt version ${versionId}`);
}

async function handleCompare(args: string[]) {
  const [a, b] = args;
  if (!a || !b) {
    console.error('Usage: npm run manage-prompts -- compare <version_a> <version_b>');
    process.exit(1);
  }

  const versions = await fetchVersions([a, b]);
  const first = versions[a];
  const second = versions[b];

  if (!first || !second) {
    console.error('Could not fetch both versions to compare.');
    process.exit(1);
  }

  console.log(`Comparing ${first.prompt_name} v${first.version} ↔ v${second.version}`);
  const diff = diffText(first.content, second.content);
  diff.forEach((line) => console.log(line));
}

async function handleExport(args: string[]) {
  const [promptName, outputPath] = args;
  if (!promptName || !outputPath) {
    console.error('Usage: npm run manage-prompts -- export <prompt_name> <output_path>');
    process.exit(1);
  }

  const { data, error } = await supabase
    .from('prompt_versions')
    .select('content')
    .eq('prompt_name', promptName)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('Failed to load active prompt:', error.message);
    process.exit(1);
  }

  if (!data) {
    console.error('No active prompt found.');
    process.exit(1);
  }

  const fullPath = path.resolve(process.cwd(), outputPath);
  fs.writeFileSync(fullPath, data.content, 'utf-8');
  console.log(`Exported active ${promptName} to ${fullPath}`);
}

async function fetchVersions(ids: string[]) {
  const { data, error } = await supabase
    .from('prompt_versions')
    .select('id, prompt_name, version, content')
    .in('id', ids);

  if (error) {
    console.error('Failed to fetch prompt versions:', error.message);
    process.exit(1);
  }

  return (data || []).reduce<Record<string, any>>((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});
}

function diffText(a: string, b: string): string[] {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const max = Math.max(aLines.length, bLines.length);
  const diff: string[] = [];

  for (let i = 0; i < max; i++) {
    const left = aLines[i];
    const right = bLines[i];
    if (left === right) {
      diff.push(`  ${left ?? ''}`);
      continue;
    }
    if (left !== undefined) {
      diff.push(`- ${left}`);
    }
    if (right !== undefined) {
      diff.push(`+ ${right}`);
    }
  }

  return diff;
}

function printUsage() {
  console.log('Prompt version CLI');
  console.log('Commands:');
  console.log('  create <prompt_name> <file_path> [description]');
  console.log('  list [prompt_name]');
  console.log('  activate <version_id>');
  console.log('  compare <version_a> <version_b>');
  console.log('  export <prompt_name> <output_path>');
}

main().catch((error) => {
  console.error('Prompt manager failed:', error);
  process.exit(1);
});
