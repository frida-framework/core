/**
 * Generate Route Segment Script
 * 
 * Creates a single reusable route segment using Mapbox for routing
 * and ChatGPT for generating Spanish descriptions.
 * 
 * Usage:
 *   npm run generate-segment -- --start "Mexico City" --end "Teotihuacan"
 *   npm run generate-segment -- --start "CDMX" --end "Teotihuacan" --via "Ecatepec"
 */

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  CreateRouteSegmentInput,
  MapboxDirectionsResponse,
  ClaudeSegmentResponse,
} from '../src/types/routes';

// Load environment variables
const MAPBOX_TOKEN = process.env.MAPBOX_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!MAPBOX_TOKEN || !OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing required environment variables:');
  if (!MAPBOX_TOKEN) console.error('  - MAPBOX_API_KEY');
  if (!OPENAI_API_KEY) console.error('  - OPENAI_API_KEY');
  if (!SUPABASE_URL) console.error('  - VITE_SUPABASE_URL');
  if (!SUPABASE_ANON_KEY) console.error('  - VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const result: { start?: string; end?: string; via?: string[] } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start' && args[i + 1]) {
      result.start = args[i + 1];
      i++;
    } else if (args[i] === '--end' && args[i + 1]) {
      result.end = args[i + 1];
      i++;
    } else if (args[i] === '--via' && args[i + 1]) {
      result.via = args[i + 1].split(',').map(v => v.trim());
      i++;
    }
  }

  if (!result.start || !result.end) {
    console.error('Usage: npm run generate-segment -- --start "Start Location" --end "End Location" [--via "Waypoint1,Waypoint2"]');
    process.exit(1);
  }

  return result;
}

// Geocode a location name to coordinates using Mapbox Geocoding API
async function geocodeLocation(placeName: string): Promise<[number, number]> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(placeName)}.json?access_token=${MAPBOX_TOKEN}&country=MX&limit=1`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Geocoding error for "${placeName}": ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.features || data.features.length === 0) {
    throw new Error(`Could not geocode location: ${placeName}`);
  }

  return data.features[0].center as [number, number];
}

// Get route geometry from Mapbox
async function getMapboxRoute(start: string, end: string, via?: string[]) {
  console.log(`Fetching route from Mapbox: ${start} -> ${end}${via ? ` (via ${via.join(', ')})` : ''}`);

  // First geocode all locations to coordinates
  const locations = [start, ...(via || []), end];
  console.log(`Geocoding ${locations.length} locations...`);

  const coordinates = await Promise.all(locations.map(async (loc) => {
    const coords = await geocodeLocation(loc);
    console.log(`  ${loc} -> [${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}]`);
    return coords;
  }));

  // Build coordinates string for Mapbox Directions API (lng,lat format)
  const coordinatesString = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(';');

  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinatesString}?geometries=geojson&overview=full&steps=true&access_token=${MAPBOX_TOKEN}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Mapbox API error: ${response.statusText}`);
  }

  const data: MapboxDirectionsResponse = await response.json();

  if (!data.routes || data.routes.length === 0) {
    throw new Error('No routes found by Mapbox');
  }

  const route = data.routes[0];
  return {
    coordinates: route.geometry.coordinates as [number, number][],
    distance_km: route.distance / 1000,
    duration_minutes: Math.round(route.duration / 60),
  };
}

// Generate hash for deduplication
function generateGeometryHash(coordinates: [number, number][]): string {
  const normalized = coordinates.map(([lng, lat]) =>
    `${lng.toFixed(6)},${lat.toFixed(6)}`
  ).join('|');
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

// Load system prompt
function loadSystemPrompt(): string {
  const promptPath = path.join(process.cwd(), 'prompts', 'segment-generation.md');
  if (!fs.existsSync(promptPath)) {
    throw new Error(`System prompt not found at ${promptPath}`);
  }
  return fs.readFileSync(promptPath, 'utf-8');
}

// Generate segment description using ChatGPT
async function generateSegmentDescription(
  start: string,
  end: string,
  distance_km: number,
  duration_minutes: number,
  coordinates: [number, number][]
): Promise<ClaudeSegmentResponse> {
  console.log('Generating segment description with ChatGPT...');

  const systemPrompt = loadSystemPrompt();

  const userPrompt = `
Generate a segment description for the following motorcycle route:

Start: ${start}
End: ${end}
Distance: ${distance_km.toFixed(2)} km
Estimated Duration: ${duration_minutes} minutes
Number of waypoints: ${coordinates.length}

Based on this information, provide:
1. A compelling narrative description in Spanish (2-3 paragraphs)
2. Section types breakdown (must sum to 100%)
3. Road quality rating (1-5)
4. Scenic value rating (1-5)
5. Technical difficulty rating (1-5)
6. Best seasons for riding
7. Weather considerations
8. Rider notes

Return the response as a valid JSON object matching the ClaudeSegmentResponse type.
`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
    temperature: 0.7,
    max_tokens: 2000,
  });

  const content = completion.choices[0].message.content;
  if (!content) {
    throw new Error('Empty response from ChatGPT');
  }

  // Parse JSON response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not extract JSON from ChatGPT response');
  }

  const response: ClaudeSegmentResponse = JSON.parse(jsonMatch[0]);

  // Validate section types sum to 100%
  const totalPercentage = response.section_types.reduce((sum, section) => sum + section.percentage, 0);
  if (Math.abs(totalPercentage - 100) > 0.1) {
    console.warn(`Warning: Section types sum to ${totalPercentage}%, adjusting...`);
    // Normalize percentages
    response.section_types = response.section_types.map(section => ({
      ...section,
      percentage: (section.percentage / totalPercentage) * 100,
    }));
  }

  return response;
}

// Save segment to database
async function saveSegment(segmentData: CreateRouteSegmentInput) {
  console.log('Saving segment to database...');

  const geometryHash = generateGeometryHash(segmentData.coordinates);

  // Check if segment with same geometry already exists
  const { data: existing, error: checkError } = await supabase
    .from('route_segments')
    .select('id, name')
    .eq('geometry_hash', geometryHash)
    .single();

  if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = not found
    throw checkError;
  }

  if (existing) {
    console.log(`Segment already exists: ${existing.name} (${existing.id})`);
    return existing;
  }

  // Insert new segment
  const { data, error } = await supabase
    .from('route_segments')
    .insert({
      ...segmentData,
      geometry_hash: geometryHash,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  console.log(`Segment created successfully: ${data.name} (${data.id})`);
  return data;
}

// Main execution
async function main() {
  const args = parseArgs();

  try {
    // Step 1: Get route from Mapbox
    const mapboxRoute = await getMapboxRoute(args.start!, args.end!, args.via);

    // Step 2: Generate description with ChatGPT
    const chatgptResponse = await generateSegmentDescription(
      args.start!,
      args.end!,
      mapboxRoute.distance_km,
      mapboxRoute.duration_minutes,
      mapboxRoute.coordinates
    );

    // Step 3: Prepare segment data
    const segmentData: CreateRouteSegmentInput = {
      name: `${args.start} - ${args.end}`,
      start_location: args.start!,
      end_location: args.end!,
      coordinates: mapboxRoute.coordinates,
      distance_km: mapboxRoute.distance_km,
      estimated_duration_minutes: mapboxRoute.duration_minutes,
      description: chatgptResponse.description,
      section_types: chatgptResponse.section_types,
      road_quality: chatgptResponse.road_quality,
      scenic_value: chatgptResponse.scenic_value,
      technical_difficulty: chatgptResponse.technical_difficulty,
      best_seasons: chatgptResponse.best_seasons,
      weather_considerations: chatgptResponse.weather_considerations,
      rider_notes: chatgptResponse.rider_notes,
    };

    // Step 4: Save to database
    const savedSegment = await saveSegment(segmentData);

    console.log('\n✅ Segment generation complete!');
    console.log(`   Segment ID: ${savedSegment.id}`);
    console.log(`   Name: ${savedSegment.name}`);
    console.log(`   Distance: ${savedSegment.distance_km.toFixed(2)} km`);
    console.log(`   Duration: ${savedSegment.estimated_duration_minutes} min`);

  } catch (error) {
    console.error('❌ Error generating segment:', error);
    process.exit(1);
  }
}

main();
