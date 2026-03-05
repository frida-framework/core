#!/usr/bin/env tsx
/**
 * Merge mx_cities_casetas.yaml and mx_cities_gates.yaml into mx_cities_boundaries.yaml
 * 
 * - Combines cities from both files
 * - Merges exit_corridors for cities that appear in both
 * - For cities with 1-2 boundary points, adds points to form valid triangles
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

interface Gate {
  lat: string;
  lng: string;
}

interface ExitCorridor {
  name: string;
  highways: string[];
  direction: string;
  registry: string;
  leads_to: string;
  gate: Gate;
  gate_radius_km: number;
  notes: string;
}

interface City {
  index: number;
  city_id: string;
  name: string;
  gate_count: number;
  states: string[];
  exit_corridors: ExitCorridor[];
}

interface YAMLData {
  version: number;
  generated_at: string;
  country: string;
  stats: {
    city_count: number;
  };
  cities: City[];
}

// Simple YAML parser for this specific format
function parseYAML(content: string): YAMLData {
  const lines = content.split('\n');
  const data: any = {};
  let currentCity: any = null;
  let currentCorridor: any = null;
  let inCities = false;
  let inExitCorridors = false;
  let inHighways = false;
  let inStates = false;
  let currentKey = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') continue;
    
    const indent = line.search(/\S/);
    
    if (indent === 0) {
      // Top-level keys
      inCities = false;
      inExitCorridors = false;
      inHighways = false;
      inStates = false;
      currentCity = null;
      currentCorridor = null;
      
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.substring(0, colonIdx).trim();
        const value = trimmed.substring(colonIdx + 1).trim();
        
        if (key === 'cities') {
          inCities = true;
          data.cities = [];
        } else if (value !== '') {
          // Parse simple values
          if (value.startsWith("'") && value.endsWith("'")) {
            data[key] = value.slice(1, -1);
          } else if (!isNaN(Number(value))) {
            data[key] = Number(value);
          } else {
            data[key] = value;
          }
        }
      }
    } else if (indent === 2 && inCities) {
      // stats or cities array items
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.substring(0, colonIdx).trim();
        if (key === 'stats') {
          data.stats = {};
          currentKey = 'stats';
        }
      } else if (trimmed === '- index:') {
        // New city
        currentCity = { exit_corridors: [], states: [] };
        data.cities.push(currentCity);
        inExitCorridors = false;
        inHighways = false;
        inStates = false;
      } else if (trimmed.startsWith('- index:')) {
        // City on single line (shouldn't happen but handle it)
        const value = trimmed.substring(trimmed.indexOf(':') + 1).trim();
        currentCity = { index: Number(value), exit_corridors: [], states: [] };
        data.cities.push(currentCity);
        inExitCorridors = false;
      }
    } else if (indent === 4) {
      // Inside stats or city
      if (currentKey === 'stats' && !currentCity) {
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
          const key = trimmed.substring(0, colonIdx).trim();
          const value = trimmed.substring(colonIdx + 1).trim();
          data.stats[key] = Number(value);
        }
      } else if (currentCity) {
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
          const key = trimmed.substring(0, colonIdx).trim();
          const value = trimmed.substring(colonIdx + 1).trim();
          
          if (key === 'exit_corridors') {
            inExitCorridors = true;
            inHighways = false;
            inStates = false;
          } else if (key === 'states') {
            inStates = true;
            inExitCorridors = false;
            inHighways = false;
          } else if (value !== '') {
            if (value.startsWith("'") && value.endsWith("'")) {
              currentCity[key] = value.slice(1, -1);
            } else if (!isNaN(Number(value))) {
              currentCity[key] = Number(value);
            } else if (value === '[]') {
              currentCity[key] = [];
            } else {
              currentCity[key] = value;
            }
            inExitCorridors = false;
            inStates = false;
            inHighways = false;
          }
        }
      }
    } else if (indent === 6 && currentCity) {
      // Inside exit_corridors array or states array
      if (inStates) {
        if (trimmed.startsWith('- ')) {
          currentCity.states.push(trimmed.substring(2).trim());
        }
      } else if (inExitCorridors) {
        if (trimmed === '-') {
          currentCorridor = {};
          currentCity.exit_corridors.push(currentCorridor);
        } else if (trimmed.startsWith('- name:')) {
          // Corridor starting on same line
          currentCorridor = {};
          currentCity.exit_corridors.push(currentCorridor);
          const value = trimmed.substring(trimmed.indexOf(':') + 1).trim();
          currentCorridor.name = value;
        } else {
          const colonIdx = trimmed.indexOf(':');
          if (colonIdx > 0) {
            const key = trimmed.substring(0, colonIdx).trim();
            const value = trimmed.substring(colonIdx + 1).trim();
            
            if (key === 'highways') {
              inHighways = true;
              currentCorridor.highways = [];
            } else if (key === 'gate') {
              currentCorridor.gate = {};
            } else if (value !== '' && currentCorridor) {
              if (value.startsWith("'") && value.endsWith("'")) {
                currentCorridor[key] = value.slice(1, -1);
              } else if (!isNaN(Number(value))) {
                currentCorridor[key] = Number(value);
              } else {
                currentCorridor[key] = value;
              }
            }
          }
        }
      }
    } else if (indent === 8 && currentCorridor && inExitCorridors) {
      // Inside corridor or gate
      if (inHighways) {
        if (trimmed.startsWith('- ')) {
          currentCorridor.highways.push(trimmed.substring(2).trim());
        }
      } else {
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
          const key = trimmed.substring(0, colonIdx).trim();
          const value = trimmed.substring(colonIdx + 1).trim();
          
          if (key === 'lat' || key === 'lng') {
            if (!currentCorridor.gate) currentCorridor.gate = {};
            // Keep as string with quotes
            currentCorridor.gate[key] = value.replace(/'/g, '');
          } else if (value !== '') {
            if (value.startsWith("'") && value.endsWith("'")) {
              currentCorridor[key] = value.slice(1, -1);
            } else if (!isNaN(Number(value))) {
              currentCorridor[key] = Number(value);
            } else {
              currentCorridor[key] = value;
            }
          }
        }
      }
    } else if (indent === 10 && currentCorridor && inExitCorridors) {
      // Inside gate
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.substring(0, colonIdx).trim();
        const value = trimmed.substring(colonIdx + 1).trim();
        
        if (key === 'lat' || key === 'lng') {
          if (!currentCorridor.gate) currentCorridor.gate = {};
          currentCorridor.gate[key] = value.replace(/'/g, '');
        }
      }
    }
  }
  
  return data as YAMLData;
}

// Convert data back to YAML
function toYAML(data: YAMLData): string {
  const lines: string[] = [];
  
  lines.push('# Мerged city boundaries from casetas and gates');
  lines.push('# - Source files: mx_cities_casetas.yaml + mx_cities_gates.yaml');
  lines.push('# - Generated by merge-boundaries.ts script');
  lines.push('# - Cities with <3 boundary points have been expanded to triangles');
  lines.push('');
  lines.push(`version: ${data.version}`);
  lines.push(`generated_at: '${new Date().toISOString()}'`);
  lines.push(`country: ${data.country}`);
  lines.push('stats:');
  lines.push(`  city_count: ${data.stats.city_count}`);
  lines.push('cities:');
  
  for (const city of data.cities) {
    lines.push(`- index: ${city.index}`);
    lines.push(`  city_id: ${city.city_id}`);
    lines.push(`  name: ${city.name}`);
    lines.push(`  gate_count: ${city.gate_count}`);
    lines.push('  states:');
    for (const state of city.states) {
      lines.push(`  - ${state}`);
    }
    lines.push('  exit_corridors:');
    for (const corridor of city.exit_corridors) {
      lines.push(`  - name: ${corridor.name}`);
      lines.push('    highways:');
      for (const hw of corridor.highways) {
        lines.push(`    - ${hw}`);
      }
      lines.push(`    direction: ${corridor.direction}`);
      lines.push(`    registry: ${corridor.registry}`);
      lines.push(`    leads_to: ${corridor.leads_to}`);
      lines.push('    gate:');
      lines.push(`      lat: "${corridor.gate.lat}"`);
      lines.push(`      lng: "${corridor.gate.lng}"`);
      lines.push(`    gate_radius_km: ${corridor.gate_radius_km}`);
      lines.push(`    notes: ${corridor.notes}`);
    }
  }
  
  return lines.join('\n');
}

// Calculate centroid of points
function calculateCentroid(points: { lat: number; lng: number }[]): { lat: number; lng: number } {
  if (points.length === 0) {
    return { lat: 0, lng: 0 };
  }
  if (points.length === 1) {
    return points[0];
  }
  
  const sum = points.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 }
  );
  
  return {
    lat: sum.lat / points.length,
    lng: sum.lng / points.length
  };
}

// Generate triangle points around a center
function generateTrianglePoints(center: { lat: number; lng: number }, radiusDegrees: number = 0.015): { lat: string; lng: string }[] {
  const points: { lat: string; lng: string }[] = [];
  
  for (let i = 0; i < 3; i++) {
    const angle = (i * 120 - 90) * (Math.PI / 180); // Start from top, 120 degrees apart
    points.push({
      lat: (center.lat + radiusDegrees * Math.cos(angle)).toFixed(4),
      lng: (center.lng + radiusDegrees * Math.sin(angle)).toFixed(4)
    });
  }
  
  return points;
}

// Generate a third point to complete triangle with center inside
function generateThirdPoint(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }, center: { lat: number; lng: number }): { lat: string; lng: string } {
  // Calculate perpendicular direction from line p1-p2, pointing away from center
  const dx = p2.lng - p1.lng;
  const dy = p2.lat - p1.lat;
  
  // Midpoint
  const midLat = (p1.lat + p2.lat) / 2;
  const midLng = (p1.lng + p2.lng) / 2;
  
  // Perpendicular vector (normalized)
  const len = Math.sqrt(dx * dx + dy * dy);
  const perpX = -dy / len;
  const perpY = dx / len;
  
  // Determine which direction is away from center
  const toCenterX = center.lng - midLng;
  const toCenterY = center.lat - midLat;
  
  const dot = perpX * toCenterX + perpY * toCenterY;
  
  // Use the perpendicular direction (away from center if dot > 0, otherwise towards)
  const sign = dot > 0 ? -1 : 1;
  
  // Distance for third point
  const distance = 0.015; // degrees
  
  const thirdLat = midLat + sign * perpY * distance;
  const thirdLng = midLng + sign * perpX * distance;
  
  return {
    lat: thirdLat.toFixed(4),
    lng: thirdLng.toFixed(4)
  };
}

// Create a synthetic corridor for generated points
function createSyntheticCorridor(point: { lat: string; lng: string }, index: number, cityId: string): ExitCorridor {
  return {
    name: `Boundary point ${index + 1} (generated)`,
    highways: [],
    direction: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][index % 8],
    registry: 'SYNTHETIC',
    leads_to: `${cityId} boundary`,
    gate: point,
    gate_radius_km: 1,
    notes: `Generated boundary point for ${cityId}`
  };
}

// Main merge logic
function mergeCities(casetasData: YAMLData, gatesData: YAMLData): YAMLData {
  const cityMap = new Map<string, City>();
  
  // Process casetas first
  for (const city of casetasData.cities) {
    cityMap.set(city.city_id, JSON.parse(JSON.stringify(city)));
  }
  
  // Process gates - merge or add
  for (const city of gatesData.cities) {
    const existing = cityMap.get(city.city_id);
    if (existing) {
      // Merge exit_corridors
      // Add corridors from gates that don't duplicate existing ones
      for (const corridor of city.exit_corridors) {
        // Check if this corridor already exists (by gate coordinates)
        const exists = existing.exit_corridors.some(
          c => c.gate.lat === corridor.gate.lat && c.gate.lng === corridor.gate.lng
        );
        if (!exists) {
          existing.exit_corridors.push(JSON.parse(JSON.stringify(corridor)));
        }
      }
    } else {
      // Add new city
      cityMap.set(city.city_id, JSON.parse(JSON.stringify(city)));
    }
  }
  
  // Convert map to array and reindex
  const mergedCities = Array.from(cityMap.values());
  mergedCities.sort((a, b) => {
    // Sort by original index, then by city_id for new cities
    if (a.index !== b.index) return a.index - b.index;
    return a.city_id.localeCompare(b.city_id);
  });
  
  // Reindex
  mergedCities.forEach((city, idx) => {
    city.index = idx + 1;
    city.gate_count = city.exit_corridors.length;
  });
  
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    country: 'MX',
    stats: {
      city_count: mergedCities.length
    },
    cities: mergedCities
  };
}

// Ensure each city has at least 3 boundary points
function ensureValidBoundaries(data: YAMLData): { data: YAMLData; citiesNeedingPoints: string[] } {
  const citiesNeedingPoints: string[] = [];
  
  for (const city of data.cities) {
    const corridorCount = city.exit_corridors.length;
    
    if (corridorCount === 0) {
      // No points - create a triangle around city center
      // Use a default center (we could look this up, but for now use a reasonable default)
      citiesNeedingPoints.push(city.city_id);
      
      // For cities with no corridors, we'll need to estimate a center
      // Since we don't have city center data, skip adding points for empty cities
      console.log(`Warning: City ${city.city_id} has no boundary points and no center defined`);
    } else if (corridorCount === 1) {
      // One point - create triangle around it
      citiesNeedingPoints.push(city.city_id);
      
      const existingPoint = city.exit_corridors[0].gate;
      const center = {
        lat: parseFloat(existingPoint.lat),
        lng: parseFloat(existingPoint.lng)
      };
      
      const trianglePoints = generateTrianglePoints(center);
      for (let i = 0; i < trianglePoints.length; i++) {
        city.exit_corridors.push(createSyntheticCorridor(trianglePoints[i], i, city.city_id));
      }
      city.gate_count = city.exit_corridors.length;
    } else if (corridorCount === 2) {
      // Two points - add third to form triangle
      citiesNeedingPoints.push(city.city_id);
      
      const p1 = {
        lat: parseFloat(city.exit_corridors[0].gate.lat),
        lng: parseFloat(city.exit_corridors[0].gate.lng)
      };
      const p2 = {
        lat: parseFloat(city.exit_corridors[1].gate.lat),
        lng: parseFloat(city.exit_corridors[1].gate.lng)
      };
      
      const center = calculateCentroid([p1, p2]);
      const thirdPoint = generateThirdPoint(p1, p2, center);
      
      city.exit_corridors.push(createSyntheticCorridor(thirdPoint, 2, city.city_id));
      city.gate_count = city.exit_corridors.length;
    }
  }
  
  return { data, citiesNeedingPoints };
}

// Main execution
async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const rootDir = path.resolve(process.env.FRIDA_REPO_ROOT || process.cwd());
  const resourcesDir = path.join(rootDir, 'resources');
  
  const casetasPath = path.join(resourcesDir, 'mx_cities_casetas.yaml');
  const gatesPath = path.join(resourcesDir, 'mx_cities_gates.yaml');
  const outputPath = path.join(resourcesDir, 'mx_cities_boundaries.yaml');
  
  console.log('Reading source files...');
  const casetasContent = fs.readFileSync(casetasPath, 'utf-8');
  const gatesContent = fs.readFileSync(gatesPath, 'utf-8');
  
  console.log('Parsing YAML files...');
  const casetasData = parseYAML(casetasContent);
  const gatesData = parseYAML(gatesContent);
  
  console.log(`Casetas file: ${casetasData.cities.length} cities`);
  console.log(`Gates file: ${gatesData.cities.length} cities`);
  
  console.log('Merging cities...');
  const mergedData = mergeCities(casetasData, gatesData);
  console.log(`Merged: ${mergedData.cities.length} unique cities`);
  
  console.log('Ensuring valid boundaries (triangles)...');
  const { data: finalData, citiesNeedingPoints } = ensureValidBoundaries(mergedData);
  console.log(`Cities needing point additions: ${citiesNeedingPoints.length}`);
  
  if (citiesNeedingPoints.length > 0) {
    console.log('Cities that received additional points:', citiesNeedingPoints.join(', '));
  }
  
  console.log('Writing output file...');
  const yamlOutput = toYAML(finalData);
  fs.writeFileSync(outputPath, yamlOutput, 'utf-8');
  
  console.log(`\nMerge complete!`);
  console.log(`- Casetas source: ${casetasData.cities.length} cities`);
  console.log(`- Gates source: ${gatesData.cities.length} cities`);
  console.log(`- Cities needing point additions: ${citiesNeedingPoints.length}`);
  console.log(`- Total merged cities: ${finalData.cities.length}`);
  console.log(`- Output: ${outputPath}`);
}

main().catch(console.error);
