/**
 * Generate Routes Status Page
 *
 * @deprecated This script is a deployment artifact. Consider using Supabase
 * dashboard or a dedicated observability tool for route monitoring.
 * This file is scheduled for removal in a future version.
 *
 * Создает HTML страницу с текущим состоянием прекешированных маршрутов
 * из базы данных Supabase.
 *
 * Usage:
 *   npm run generate-routes-status
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing required environment variables:');
  if (!SUPABASE_URL) console.error('  - VITE_SUPABASE_URL');
  if (!SUPABASE_ANON_KEY) console.error('  - VITE_SUPABASE_PUBLISHABLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface RouteStats {
  total_routes: number;
  total_segments: number;
  tier1_routes: number;
  tier2_routes: number;
  total_distance_km: number;
}

interface RouteInfo {
  route_id: string;
  name: string;
  route_type: string;
  total_distance_km: number;
  total_duration_minutes: number;
  max_difficulty: number;
  segment_ids: string[];
  created_at: string;
  updated_at: string;
  hit_count: number;
}

interface SegmentInfo {
  segment_id: string;
  start_location: string;
  end_location: string;
  distance_km: number;
  duration_minutes: number;
  difficulty: number;
  section_type: string;
  used_in_routes: number;
  created_at: string;
}

async function getRouteStats(): Promise<RouteStats> {
  const { data: routes, error: routesError } = await supabase
    .from('route_compositions')
    .select('route_type, total_distance_km');

  const { data: segments, error: segmentsError } = await supabase
    .from('route_segments')
    .select('segment_id');

  if (routesError || segmentsError) {
    throw new Error('Failed to fetch stats from database');
  }

  const tier1 = routes?.filter(r => r.route_type === 'tier1').length || 0;
  const tier2 = routes?.filter(r => r.route_type === 'tier2').length || 0;
  const totalDistance = routes?.reduce((sum, r) => sum + parseFloat(r.total_distance_km), 0) || 0;

  return {
    total_routes: routes?.length || 0,
    total_segments: segments?.length || 0,
    tier1_routes: tier1,
    tier2_routes: tier2,
    total_distance_km: totalDistance,
  };
}

async function getAllRoutes(): Promise<RouteInfo[]> {
  const { data, error } = await supabase
    .from('route_compositions')
    .select('*')
    .order('route_type', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    throw new Error('Failed to fetch routes from database');
  }

  return data || [];
}

async function getAllSegments(): Promise<SegmentInfo[]> {
  const { data, error } = await supabase
    .from('route_segments')
    .select('*')
    .order('used_in_routes', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error('Failed to fetch segments from database');
  }

  return data || [];
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function getDifficultyColor(difficulty: number): string {
  const colors = ['#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444'];
  return colors[difficulty - 1] || '#6b7280';
}

function getSectionTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    'straight_highway': 'Autopista',
    'serpentine_section': 'Serpenteante',
    'urban_transit': 'Urbano',
    'scenic_cruise': 'Escénico',
    'damaged_road': 'Camino dañado',
  };
  return labels[type] || type;
}

function generateHTML(stats: RouteStats, routes: RouteInfo[], segments: SegmentInfo[]): string {
  const now = new Date().toLocaleString('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Estado de Rutas Pre-cacheadas - kaTai</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #1f2937;
      padding: 2rem;
      min-height: 100vh;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 1rem;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    
    header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 3rem 2rem;
      text-align: center;
    }
    
    h1 {
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
    }
    
    .subtitle {
      opacity: 0.9;
      font-size: 1.1rem;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1.5rem;
      padding: 2rem;
      background: #f9fafb;
    }
    
    .stat-card {
      background: white;
      padding: 1.5rem;
      border-radius: 0.5rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      text-align: center;
    }
    
    .stat-value {
      font-size: 2.5rem;
      font-weight: bold;
      color: #667eea;
    }
    
    .stat-label {
      color: #6b7280;
      margin-top: 0.5rem;
      font-size: 0.9rem;
    }
    
    .section {
      padding: 2rem;
    }
    
    h2 {
      font-size: 1.8rem;
      margin-bottom: 1.5rem;
      color: #111827;
    }
    
    .route-card, .segment-card {
      background: #f9fafb;
      border-radius: 0.5rem;
      padding: 1.5rem;
      margin-bottom: 1rem;
      border-left: 4px solid #667eea;
    }
    
    .route-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 1rem;
    }
    
    .route-name {
      font-size: 1.3rem;
      font-weight: 600;
      color: #111827;
    }
    
    .route-type {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 600;
      background: #ddd6fe;
      color: #5b21b6;
    }
    
    .route-type.tier1 {
      background: #dbeafe;
      color: #1e40af;
    }
    
    .route-type.tier2 {
      background: #fef3c7;
      color: #92400e;
    }
    
    .route-meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-top: 1rem;
    }
    
    .meta-item {
      font-size: 0.9rem;
      color: #6b7280;
    }
    
    .meta-value {
      font-weight: 600;
      color: #111827;
    }
    
    .difficulty-badge {
      display: inline-block;
      width: 1.5rem;
      height: 1.5rem;
      border-radius: 50%;
      margin: 0 0.1rem;
    }
    
    .segments-list {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid #e5e7eb;
    }
    
    .segment-tag {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      margin: 0.25rem;
      background: white;
      border-radius: 0.25rem;
      font-size: 0.85rem;
      color: #4b5563;
    }
    
    .timestamp {
      text-align: center;
      padding: 2rem;
      color: #6b7280;
      font-size: 0.9rem;
      background: #f9fafb;
    }
    
    .section-type {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.8rem;
      background: #e5e7eb;
      color: #374151;
      margin-left: 0.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🏍️ kaTai Routes Status</h1>
      <p class="subtitle">Estado de Rutas Pre-cacheadas</p>
    </header>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${stats.total_routes}</div>
        <div class="stat-label">Rutas Totales</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.total_segments}</div>
        <div class="stat-label">Segmentos</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.tier1_routes}</div>
        <div class="stat-label">Rutas Tier 1</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.tier2_routes}</div>
        <div class="stat-label">Rutas Tier 2</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.total_distance_km.toFixed(0)}</div>
        <div class="stat-label">km Total</div>
      </div>
    </div>
    
    <div class="section">
      <h2>📍 Rutas Pre-cacheadas</h2>
      ${routes.map(route => `
        <div class="route-card">
          <div class="route-header">
            <div class="route-name">${route.name}</div>
            <span class="route-type ${route.route_type}">${route.route_type.toUpperCase()}</span>
          </div>
          
          <div class="route-meta">
            <div class="meta-item">
              <div class="meta-value">${route.total_distance_km.toFixed(1)} km</div>
              Distancia
            </div>
            <div class="meta-item">
              <div class="meta-value">${formatDuration(route.total_duration_minutes)}</div>
              Duración
            </div>
            <div class="meta-item">
              <div class="meta-value">
                ${Array.from({length: route.max_difficulty}, (_, i) => 
                  `<span class="difficulty-badge" style="background: ${getDifficultyColor(i + 1)}"></span>`
                ).join('')}
              </div>
              Dificultad
            </div>
            <div class="meta-item">
              <div class="meta-value">${route.hit_count}</div>
              Accesos
            </div>
          </div>
          
          <div class="segments-list">
            <strong>Segmentos (${route.segment_ids.length}):</strong>
            ${route.segment_ids.map(sid => `<span class="segment-tag">${sid}</span>`).join('')}
          </div>
          
          <div style="margin-top: 1rem; font-size: 0.85rem; color: #6b7280;">
            Creado: ${formatDate(route.created_at)} | Actualizado: ${formatDate(route.updated_at)}
          </div>
        </div>
      `).join('')}
    </div>
    
    <div class="section">
      <h2>🛣️ Segmentos Reutilizables</h2>
      ${segments.map(segment => `
        <div class="segment-card">
          <div style="display: flex; justify-content: space-between; align-items: start;">
            <div>
              <strong>${segment.start_location}</strong> → <strong>${segment.end_location}</strong>
              <span class="section-type">${getSectionTypeLabel(segment.section_type)}</span>
            </div>
            <div style="text-align: right; font-size: 0.9rem; color: #6b7280;">
              ${segment.distance_km.toFixed(1)} km • ${formatDuration(segment.duration_minutes)}
            </div>
          </div>
          
          <div class="route-meta" style="margin-top: 1rem;">
            <div class="meta-item">
              <div class="meta-value">
                ${Array.from({length: segment.difficulty}, (_, i) => 
                  `<span class="difficulty-badge" style="background: ${getDifficultyColor(i + 1)}"></span>`
                ).join('')}
              </div>
              Dificultad
            </div>
            <div class="meta-item">
              <div class="meta-value">${segment.used_in_routes}</div>
              Usado en rutas
            </div>
            <div class="meta-item">
              <div class="meta-value">${segment.segment_id}</div>
              ID
            </div>
          </div>
          
          <div style="margin-top: 0.75rem; font-size: 0.8rem; color: #9ca3af;">
            Creado: ${formatDate(segment.created_at)}
          </div>
        </div>
      `).join('')}
    </div>
    
    <div class="timestamp">
      Última actualización: ${now}
    </div>
  </div>
</body>
</html>`;
}

async function main() {
  console.log('📊 Generating routes status page...');

  try {
    // Fetch data from Supabase
    const stats = await getRouteStats();
    const routes = await getAllRoutes();
    const segments = await getAllSegments();

    console.log(`Found ${stats.total_routes} routes and ${stats.total_segments} segments`);

    // Generate HTML
    const html = generateHTML(stats, routes, segments);

    // Create output directory
    const outputDir = path.join(process.cwd(), 'public', 'routes-status');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write HTML file
    const outputPath = path.join(outputDir, 'index.html');
    fs.writeFileSync(outputPath, html, 'utf-8');

    console.log(`✅ Routes status page generated: ${outputPath}`);
    console.log(`📍 Stats: ${stats.total_routes} routes, ${stats.total_segments} segments, ${stats.total_distance_km.toFixed(0)} km total`);

  } catch (error) {
    console.error('❌ Error generating status page:', error);
    process.exit(1);
  }
}

main();
