/**
 * Compose Route Script
 * 
 * Creates a full route composition from a YAML configuration file.
 * Reads segment definitions, generates missing segments, and assembles
 * them into a complete route.
 * 
 * Usage:
 *   npm run compose-route -- config/routes/cdmx-teotihuacan.yaml
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import dotenv from 'dotenv';
import type {
  RouteConfig,
  CreateRouteCompositionInput,
} from '../src/types/routes';

// Load environment variables from .env file
dotenv.config();

// Import segment generation functions
// (In a real implementation, you'd want to refactor generate-segment.ts
// to export these functions for reuse)

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required environment variables:');
  if (!SUPABASE_URL) console.error('  - VITE_SUPABASE_URL');
  if (!SUPABASE_SERVICE_KEY) console.error('  - SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: npm run compose-route -- <config-file.yaml>');
    console.error('Example: npm run compose-route -- config/routes/cdmx-teotihuacan.yaml');
    process.exit(1);
  }
  return args[0];
}

function loadRouteConfig(configPath: string): RouteConfig {
  const fullPath = path.resolve(process.cwd(), configPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Config file not found: ${fullPath}`);
  }

  const yamlContent = fs.readFileSync(fullPath, 'utf-8');
  const config = YAML.parse(yamlContent) as RouteConfig;

  // Validate config structure
  if (!config.name || !config.segments || !config.metadata) {
    throw new Error('Invalid route configuration: missing required fields');
  }

  return config;
}

async function findOrGenerateSegment(
  start: string,
  end: string,
  via?: string[]
): Promise<string> {
  console.log(`Looking for segment: ${start} -> ${end}`);

  // Search for existing segment
  const { data: segments, error } = await supabase
    .from('route_segments')
    .select('id, name, start_location, end_location')
    .ilike('start_location', `%${start}%`)
    .ilike('end_location', `%${end}%`);

  if (error) {
    throw error;
  }

  if (segments && segments.length > 0) {
    console.log(`  ✓ Found existing segment: ${segments[0].name} (${segments[0].id})`);
    return segments[0].id;
  }

  // Generate new segment
  console.log(`  → Generating new segment...`);
  console.log(`     Run: npm run generate-segment -- --start "${start}" --end "${end}"${via ? ` --via "${via.join(',')}"` : ''}`);
  throw new Error(`Segment not found. Please generate it first using the command above.`);
}

async function composeRoute(config: RouteConfig) {
  console.log(`\n📍 Composing route: ${config.name}`);
  console.log(`   Description: ${config.description}`);
  console.log(`   Segments to process: ${config.segments.length}\n`);

  // Step 1: Find or identify missing segments
  const segmentIds: string[] = [];
  const missingSegments: string[] = [];

  for (const segmentConfig of config.segments) {
    try {
      const segmentId = await findOrGenerateSegment(
        segmentConfig.start,
        segmentConfig.end,
        segmentConfig.via
      );
      segmentIds.push(segmentId);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        missingSegments.push(`${segmentConfig.start} -> ${segmentConfig.end}`);
      } else {
        throw error;
      }
    }
  }

  if (missingSegments.length > 0) {
    console.error('\n❌ Missing segments. Please generate them first:');
    missingSegments.forEach(segment => console.error(`   - ${segment}`));
    process.exit(1);
  }

  // Step 2: Fetch segment details to calculate totals
  const { data: segments, error: fetchError } = await supabase
    .from('route_segments')
    .select('*')
    .in('id', segmentIds);

  if (fetchError) {
    throw fetchError;
  }

  if (!segments || segments.length !== segmentIds.length) {
    throw new Error('Failed to fetch all segments');
  }

  // Reorder segments to match input order
  const orderedSegments = segmentIds.map(id =>
    segments.find(s => s.id === id)!
  );

  const totalDistance = orderedSegments.reduce((sum, s) => sum + s.distance_km, 0);
  const totalDuration = orderedSegments.reduce((sum, s) => sum + s.estimated_duration_minutes, 0);

  console.log(`\n✓ All segments found:`);
  orderedSegments.forEach((segment, i) => {
    console.log(`   ${i + 1}. ${segment.name} (${segment.distance_km.toFixed(2)} km, ${segment.estimated_duration_minutes} min)`);
  });

  console.log(`\n   Total Distance: ${totalDistance.toFixed(2)} km`);
  console.log(`   Total Duration: ${totalDuration} min (${(totalDuration / 60).toFixed(1)} hours)`);

  // Step 3: Create route composition
  const compositionData: CreateRouteCompositionInput = {
    name: config.name,
    description: config.description,
    segment_ids: segmentIds,
    overall_difficulty: config.metadata.overall_difficulty,
    scenic_rating: config.metadata.scenic_rating,
    rider_level: config.metadata.rider_level,
    motorcycle_type: config.metadata.motorcycle_type,
    route_notes: config.metadata.route_notes,
    waypoints: config.metadata.waypoints,
    recommended_stops: config.metadata.recommended_stops,
  };

  const { data: composition, error: insertError } = await supabase
    .from('route_compositions')
    .insert({
      ...compositionData,
      start_location: orderedSegments[0].start_location,
      end_location: orderedSegments[orderedSegments.length - 1].end_location,
      total_distance_km: totalDistance,
      total_duration_minutes: totalDuration,
      best_seasons: config.metadata.best_seasons,
      is_public: true,
    })
    .select()
    .single();

  if (insertError) {
    throw insertError;
  }

  console.log(`\n✅ Route composition created successfully!`);
  console.log(`   Route ID: ${composition.id}`);
  console.log(`   Name: ${composition.name}`);
  console.log(`   Public: ${composition.is_public}`);
  console.log(`\n   You can now view this route in the application.`);
}

async function main() {
  const configPath = parseArgs();

  try {
    const config = loadRouteConfig(configPath);
    await composeRoute(config);
  } catch (error) {
    console.error('❌ Error composing route:', error);
    process.exit(1);
  }
}

main();
