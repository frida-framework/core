#!/usr/bin/env node

/**
 * Test script to verify GLM route request functionality
 * This script tests the v2-preview edge function that uses GLM-4-Plus
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration - Update these values as needed
const SUPABASE_URL = 'https://gorsxaqhpxsikawsryfp.supabase.co';
const V2_PREVIEW_FUNCTION = 'v2-preview';

// Test request payload
const testRequest = {
  origin: {
    label: 'Mexico City, CDMX',
    lat: 19.4326,
    lng: -99.1332
  },
  destination: {
    label: 'Puebla, PUE',
    lat: 19.0414,
    lng: -98.2063
  },
  departure_date: new Date().toISOString(),
  outbound_style: 'scenic',
  return_mode: 'none',
  locale: 'es',
  include_tolls_metric: true
};

async function testGLMRoute() {
  console.log('🧪 Testing GLM Route Request via v2-preview Edge Function');
  console.log('='.repeat(70));
  console.log('');

  try {
    // Read Supabase anon key from .env or use a placeholder
    let supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    
    if (!supabaseKey) {
      console.error('❌ ERROR: SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY not found in environment');
      console.log('');
      console.log('Please set one of these environment variables:');
      console.log('  - SUPABASE_ANON_KEY');
      console.log('  - VITE_SUPABASE_ANON_KEY');
      console.log('');
      console.log('You can find this key in your Supabase project settings.');
      process.exit(1);
    }

    console.log('📡 Request Details:');
    console.log(`  Origin: ${testRequest.origin.label}`);
    console.log(`  Destination: ${testRequest.destination.label}`);
    console.log(`  Style: ${testRequest.outbound_style}`);
    console.log(`  Departure: ${testRequest.departure_date}`);
    console.log('');

    console.log('🔗 Endpoint:');
    console.log(`  ${SUPABASE_URL}/functions/v1/${V2_PREVIEW_FUNCTION}`);
    console.log('');

    console.log('⏳ Sending request...');
    console.log('');

    const startTime = Date.now();
    
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${V2_PREVIEW_FUNCTION}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testRequest)
    });

    const duration = Date.now() - startTime;
    console.log(`⏱️  Response time: ${duration}ms`);
    console.log('');

    console.log('📊 Response Status:');
    console.log(`  Status: ${response.status} ${response.statusText}`);
    console.log('');

    const responseText = await response.text();
    
    if (!response.ok) {
      console.error('❌ ERROR: Request failed');
      console.log('');
      console.log('Error Response:');
      console.log(responseText);
      console.log('');
      process.exit(1);
    }

    console.log('✅ SUCCESS: Request completed successfully');
    console.log('');

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      console.error('❌ ERROR: Failed to parse response as JSON');
      console.log('');
      console.log('Raw Response:');
      console.log(responseText);
      console.log('');
      process.exit(1);
    }

    console.log('📄 Response Structure:');
    console.log(`  Has outbound: ${!!responseData.outbound}`);
    console.log(`  Has provenance: ${!!responseData.provenance}`);
    console.log('');

    if (responseData.outbound) {
      console.log('📍 Outbound Route:');
      console.log(`  Points: ${responseData.outbound.points?.length || 0}`);
      console.log(`  Segments: ${responseData.outbound.segments?.length || 0}`);
      console.log(`  Has skeleton: ${!!responseData.outbound.skeleton}`);
      console.log('');

      if (responseData.outbound.skeleton) {
        console.log('🦴 GLM Skeleton:');
        console.log(`  Waypoints: ${responseData.outbound.skeleton.waypoints?.length || 0}`);
        console.log(`  Segments: ${responseData.outbound.skeleton.segments?.length || 0}`);
        console.log('');

        if (responseData.outbound.skeleton.waypoints?.length > 0) {
          console.log('  Waypoints:');
          responseData.outbound.skeleton.waypoints.forEach((wp, i) => {
            console.log(`    ${i}. ${wp.name} (${wp.trigger})`);
          });
          console.log('');
        }

        if (responseData.outbound.skeleton.segments?.length > 0) {
          console.log('  Segments:');
          responseData.outbound.skeleton.segments.forEach((seg, i) => {
            console.log(`    ${i}. ${seg.type} (${seg.difficulty}): ${seg.expect}`);
          });
          console.log('');
        }
      }

      if (responseData.outbound.provenance) {
        console.log('🔍 Provenance:');
        console.log(`  Geo: ${responseData.outbound.provenance.geo}`);
        console.log(`  Land: ${responseData.outbound.provenance.land}`);
        console.log(`  Segments: ${responseData.outbound.provenance.segments}`);
        console.log('');
      }
    }

    if (responseData.provenance) {
      console.log('🏷️  Overall Provenance:');
      console.log(`  Geo: ${responseData.provenance.geo}`);
      console.log(`  Land: ${responseData.provenance.land}`);
      console.log(`  Segments: ${responseData.provenance.segments}`);
      console.log('');
    }

    // Validate the skeleton structure
    if (responseData.outbound?.skeleton) {
      const skeleton = responseData.outbound.skeleton;
      const expectedSegments = skeleton.waypoints.length - 1;
      
      if (skeleton.segments.length === expectedSegments) {
        console.log('✅ Skeleton validation: PASSED');
        console.log(`   Segments count (${skeleton.segments.length}) matches waypoints - 1`);
      } else {
        console.log('⚠️  Skeleton validation: WARNING');
        console.log(`   Expected ${expectedSegments} segments, got ${skeleton.segments.length}`);
      }
      console.log('');
    }

    console.log('='.repeat(70));
    console.log('✅ GLM route request test completed successfully!');
    console.log('');

  } catch (error) {
    console.error('❌ FATAL ERROR:');
    console.error(error.message);
    console.error('');
    console.error('Stack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testGLMRoute();
