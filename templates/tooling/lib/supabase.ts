/**
 * Shared Supabase Client Module for Scripts
 *
 * Centralizes Supabase client initialization with flexible env var support.
 * Handles multiple env var naming conventions used across the project.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import 'dotenv/config';

/**
 * Get environment variable from multiple possible names
 */
function getEnvVar(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

/**
 * Get Supabase URL from various env var sources
 */
export function getSupabaseUrl(): string | undefined {
  return getEnvVar(['SUPABASE_URL', 'VITE_SUPABASE_URL']);
}

/**
 * Get Supabase anon key from various env var sources
 */
export function getSupabaseAnonKey(): string | undefined {
  return getEnvVar([
    'SUPABASE_ANON_KEY',
    'VITE_SUPABASE_ANON_KEY',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
  ]);
}

/**
 * Get Supabase service role key (admin access)
 */
export function getSupabaseServiceKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Create a Supabase client with anon key.
 * Falls back to service key if anon key not available.
 *
 * @throws Error if credentials are missing
 */
export function createSupabaseClient(): SupabaseClient {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey() || getSupabaseServiceKey();

  if (!url || !key) {
    console.error('Missing Supabase credentials.');
    console.error('Set one of:');
    console.error('  URL: SUPABASE_URL or VITE_SUPABASE_URL');
    console.error('  Key: SUPABASE_ANON_KEY, VITE_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  return createClient(url, key);
}

/**
 * Create a Supabase admin client with service role key.
 * Required for operations that bypass RLS.
 *
 * @throws Error if service role key is missing
 */
export function createAdminClient(): SupabaseClient {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceKey();

  if (!url || !key) {
    throw new Error(
      'Admin client requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  return createClient(url, key);
}

/**
 * Validate that required Supabase credentials are available.
 * Useful for early validation in scripts.
 *
 * @param requireAdmin - If true, requires service role key
 * @returns true if valid, exits process with error if not
 */
export function validateCredentials(requireAdmin = false): boolean {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  const serviceKey = getSupabaseServiceKey();

  const errors: string[] = [];

  if (!url) {
    errors.push('Missing SUPABASE_URL or VITE_SUPABASE_URL');
  }

  if (requireAdmin && !serviceKey) {
    errors.push('Missing SUPABASE_SERVICE_ROLE_KEY (required for admin operations)');
  } else if (!anonKey && !serviceKey) {
    errors.push('Missing Supabase key (SUPABASE_ANON_KEY, VITE_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY)');
  }

  if (errors.length > 0) {
    console.error('Supabase credential validation failed:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  return true;
}
