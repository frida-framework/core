import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';
import { glob } from 'glob';
import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface RouteSegmentConfig {
  start: string;
  end: string;
  existing_segment_id?: string | null;
  generate_if_missing?: boolean;
  name?: string;
  notes?: string;
  via?: string[];
}

interface RouteMetadata {
  tags?: string[];
  estimated_hours?: number;
  difficulty?: number;
  best_season?: string[];
  rider_level?: string;
  motorcycle_type?: string[];
  notes?: string;
}

interface RouteConfig {
  route_id: string;
  name: string;
  description?: string;
  start: string;
  end: string;
  segments: RouteSegmentConfig[];
  metadata?: RouteMetadata;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  config?: RouteConfig;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(process.env.FRIDA_REPO_ROOT || process.cwd());
const SCHEMA_PATH = path.resolve(ROOT_DIR, 'config/schemas/route-config.schema.json');

if (!fs.existsSync(SCHEMA_PATH)) {
  console.error(`Schema file not found at ${SCHEMA_PATH}. Did you run Task-005?`);
  process.exit(1);
}

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true, validateFormats: true });
addFormats(ajv);
const validateSchema = ajv.compile<RouteConfig>(schema);

function formatAjvError(error: ErrorObject): string {
  const instancePath = error.instancePath || '/';
  return `${instancePath} ${error.message ?? ''}`.trim();
}

function createSupabaseClientFromEnv(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key);
}

function normalizePath(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath);
  return relative.startsWith('..') ? filePath : relative;
}

async function validateRouteConfig(
  filePath: string,
  supabaseClient: SupabaseClient | null
): Promise<ValidationResult> {
  const normalizedPath = normalizePath(filePath);
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };

  if (!fs.existsSync(filePath)) {
    result.valid = false;
    result.errors.push(`File not found: ${normalizedPath}`);
    return result;
  }

  let parsed: unknown;
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    parsed = yaml.parse(fileContent);
  } catch (error) {
    result.valid = false;
    const message = error instanceof Error ? error.message : 'Unknown error';
    result.errors.push(`YAML parse error: ${message}`);
    return result;
  }

  const schemaValid = validateSchema(parsed);
  if (!schemaValid) {
    result.valid = false;
    const schemaErrors = validateSchema.errors ?? [];
    result.errors.push(...schemaErrors.map(formatAjvError));
    return result;
  }

  const config = parsed as RouteConfig;

  // Normalize optional fields
  config.segments = config.segments.map((segment) => ({
    ...segment,
    generate_if_missing: segment.generate_if_missing ?? true,
  }));

  // Custom logical checks
  validateSegmentChain(config, result);
  validateSegmentCount(config, result);

  if (supabaseClient) {
    await validateAgainstDatabase(config, result, supabaseClient);
  }

  result.config = config;
  return result;
}

function validateSegmentCount(config: RouteConfig, result: ValidationResult) {
  if (config.segments.length > 10) {
    result.warnings.push(
      `Too many segments (${config.segments.length}). Practical maximum is 10.`
    );
  }
}

function validateSegmentChain(config: RouteConfig, result: ValidationResult) {
  const { segments, start, end } = config;

  if (!segments.length) {
    result.valid = false;
    result.errors.push('segments must contain at least one entry');
    return;
  }

  const first = segments[0];
  if (first.start !== start) {
    result.valid = false;
    result.errors.push(
      `Chain broken: first segment starts at "${first.start}", expected "${start}"`
    );
  }

  const last = segments[segments.length - 1];
  if (last.end !== end) {
    result.valid = false;
    result.errors.push(
      `Chain broken: last segment ends at "${last.end}", expected "${end}"`
    );
  }

  for (let i = 0; i < segments.length - 1; i++) {
    const current = segments[i];
    const next = segments[i + 1];
    if (current.end !== next.start) {
      result.valid = false;
      result.errors.push(
        `Chain broken at segment ${i + 2}: expected start "${current.end}", got "${next.start}"`
      );
    }
  }
}

async function validateAgainstDatabase(
  config: RouteConfig,
  result: ValidationResult,
  supabaseClient: SupabaseClient
) {
  try {
    const { data: existingRoute, error } = await supabaseClient
      .from('route_compositions')
      .select('route_id')
      .eq('route_id', config.route_id)
      .maybeSingle();

    if (error) {
      result.warnings.push(`Database route check failed: ${error.message}`);
    } else if (existingRoute) {
      result.warnings.push(`route_id '${config.route_id}' already exists in database`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    result.warnings.push(`Database route check failed: ${message}`);
  }

  const lookups = config.segments
    .map((segment, index) => ({ index, id: segment.existing_segment_id }))
    .filter((entry): entry is { index: number; id: string } => Boolean(entry.id));

  for (const lookup of lookups) {
    try {
      const { data, error } = await supabaseClient
        .from('route_segments')
        .select('id')
        .eq('id', lookup.id)
        .maybeSingle();

      if (error) {
        result.warnings.push(
          `Segment ${lookup.index + 1}: database lookup failed (${error.message})`
        );
        continue;
      }

      if (!data) {
        result.valid = false;
        result.errors.push(
          `Segment ${lookup.index + 1}: existing_segment_id '${lookup.id}' not found in database`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.warnings.push(
        `Segment ${lookup.index + 1}: database lookup failed (${message})`
      );
    }
  }
}

function printResult(filePath: string, result: ValidationResult) {
  const displayPath = normalizePath(filePath);

  if (result.valid && result.warnings.length === 0) {
    console.log(`✅ ${displayPath}`);
    if (result.config) {
      console.log(`   Route: ${result.config.start} → ${result.config.end}`);
      console.log(`   Segments: ${result.config.segments.length}`);
      console.log(`   Chain: valid`);
    }
  } else if (result.valid) {
    console.log(`⚠️  ${displayPath}`);
    for (const warning of result.warnings) {
      console.log(`   Warning: ${warning}`);
    }
    console.log('✅ Validation passed (with warnings)');
  } else {
    console.log(`❌ ${displayPath}`);
    for (const error of result.errors) {
      console.log(`   Error: ${error}`);
    }
  }

  console.log('');
}

async function gatherFiles(patterns: string[]): Promise<string[]> {
  const files = new Set<string>();

  for (const pattern of patterns) {
    const matches = await glob(pattern, { nodir: true, absolute: true });
    if (matches.length === 0 && fs.existsSync(pattern)) {
      files.add(path.resolve(process.cwd(), pattern));
    } else {
      matches.forEach((match) => files.add(path.resolve(match)));
    }
  }

  return Array.from(files);
}

async function main() {
  const patterns = process.argv.slice(2);
  if (patterns.length === 0) {
    console.error('Usage: npm run validate-route -- <glob-pattern>');
    console.error('Example: npm run validate-route -- "config/routes/*.yaml"');
    process.exit(1);
  }

  const files = await gatherFiles(patterns);
  if (files.length === 0) {
    console.error(`No files found matching pattern(s): ${patterns.join(', ')}`);
    process.exit(1);
  }

  const supabaseClient = createSupabaseClientFromEnv();
  if (!supabaseClient) {
    console.warn('ℹ️  SUPABASE_URL/SUPABASE_KEY not set. Skipping database-backed checks.');
  }

  let hasErrors = false;
  for (const file of files) {
    const result = await validateRouteConfig(file, supabaseClient);
    printResult(file, result);
    if (!result.valid) {
      hasErrors = true;
    }
  }

  if (hasErrors) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Validator failed with an unexpected error:', error);
  process.exit(1);
});
