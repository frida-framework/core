/**
 * Test Route Generation with ChatGPT
 * 
 * Tests route generation with different parameters and validates outputs
 */

import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY 
});

interface TestCase {
  name: string;
  start: string;
  end: string;
  distance_km: number;
  duration_minutes: number;
  rider_level?: string;
  motorcycle_type?: string;
}

const testCases: TestCase[] = [
  {
    name: "Short Urban Route",
    start: "Mexico City, CDMX",
    end: "Teotihuacan",
    distance_km: 64,
    duration_minutes: 90,
    rider_level: "principiante",
    motorcycle_type: "touring"
  },
  {
    name: "Long Highway Route",
    start: "Guadalajara, Jalisco",
    end: "Puerto Vallarta, Jalisco",
    distance_km: 340,
    duration_minutes: 300,
    rider_level: "intermedio",
    motorcycle_type: "adventure"
  },
  {
    name: "Mountain Route",
    start: "Oaxaca, Oaxaca",
    end: "Puerto Escondido, Oaxaca",
    distance_km: 240,
    duration_minutes: 360,
    rider_level: "experto",
    motorcycle_type: "sport"
  }
];

const FORBIDDEN_WORDS = [
  'delve',
  'crucial',
  'significant',
  'embark on a journey',
  'treasure trove',
  'world of',
  'in summary'
];

async function testRouteGeneration(testCase: TestCase) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${testCase.name}`);
  console.log(`${'='.repeat(60)}`);
  
  const systemPrompt = fs.readFileSync(
    path.join(process.cwd(), 'prompts', 'route-generation-full.md'), 
    'utf-8'
  );
  
  const userPrompt = `
Genera una ruta completa de motocicleta con los siguientes datos:

**Punto de inicio:** ${testCase.start}
**Punto final:** ${testCase.end}
**Perfil del motociclista:** ${testCase.rider_level || 'intermedio'}
**Tipo de moto:** ${testCase.motorcycle_type || 'adventure'}

**Datos de Mapbox:**
- Distancia total: ${testCase.distance_km} km
- Duración estimada: ${testCase.duration_minutes} min

Genera una descripción completa de la ruta con 3-5 segmentos lógicos.
Incluye descripción, POIs, gasolineras, advertencias y recomendaciones.

Responde SOLO con JSON válido en el formato especificado en el system prompt.
NO incluyas markdown, backticks ni texto adicional.
`;

  const startTime = Date.now();
  
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 3000
    });
    
    const duration = Date.now() - startTime;
    const responseText = completion.choices[0].message.content;
    
    if (!responseText) {
      throw new Error('Empty response from ChatGPT');
    }
    
    // Try to extract JSON (handle markdown backticks if present)
    let jsonText = responseText;
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
      console.log('⚠️  Response contained markdown backticks (should be fixed in prompt)');
    } else {
      const jsonMatchPlain = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatchPlain) {
        jsonText = jsonMatchPlain[0];
      }
    }
    
    // Parse JSON
    const routeData = JSON.parse(jsonText);
    
    // Validation
    console.log(`\n✅ Generation successful`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Tokens: ${completion.usage?.total_tokens || 'N/A'}`);
    console.log(`   Segments: ${routeData.segments?.length || 0}`);
    console.log(`   Distance: ${routeData.total_distance_km} km`);
    console.log(`   Max Difficulty: ${routeData.max_difficulty}/5`);
    console.log(`   Overall Scenic: ${routeData.metadata?.overall_scenic || 'N/A'}/10`);
    
    // Check for forbidden words
    const responseTextLower = responseText.toLowerCase();
    const foundForbidden = FORBIDDEN_WORDS.filter(word => 
      responseTextLower.includes(word.toLowerCase())
    );
    
    if (foundForbidden.length > 0) {
      console.log(`\n⚠️  FORBIDDEN WORDS FOUND: ${foundForbidden.join(', ')}`);
    } else {
      console.log(`\n✅ No forbidden words detected`);
    }
    
    // Check for forbidden symbols
    const hasDash = responseText.includes('—');
    const hasApprox = responseText.includes('≈');
    if (hasDash || hasApprox) {
      console.log(`⚠️  FORBIDDEN SYMBOLS FOUND:`);
      if (hasDash) console.log('   - Em-dash (—)');
      if (hasApprox) console.log('   - Approx symbol (≈)');
    } else {
      console.log(`✅ No forbidden symbols detected`);
    }
    
    // Validate structure
    const errors: string[] = [];
    if (!routeData.route_id) errors.push('Missing route_id');
    if (!routeData.name) errors.push('Missing name');
    if (!routeData.segments || routeData.segments.length === 0) {
      errors.push('Missing or empty segments');
    }
    if (!routeData.metadata) errors.push('Missing metadata');
    
    if (errors.length > 0) {
      console.log(`\n❌ VALIDATION ERRORS:`);
      errors.forEach(err => console.log(`   - ${err}`));
    } else {
      console.log(`✅ Structure validation passed`);
    }
    
    // Save result
    const resultsDir = path.join(process.cwd(), 'test-results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    
    const filename = testCase.name.replace(/\s+/g, '-').toLowerCase() + '.json';
    const filepath = path.join(resultsDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(routeData, null, 2));
    console.log(`\n💾 Result saved: test-results/${filename}`);
    
    return {
      success: true,
      duration,
      tokens: completion.usage?.total_tokens || 0,
      forbiddenWords: foundForbidden,
      errors
    };
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  console.log('\n🧪 Testing Route Generation with ChatGPT');
  console.log('==========================================\n');
  
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY environment variable not set');
    process.exit(1);
  }
  
  const results = [];
  
  for (const testCase of testCases) {
    const result = await testRouteGeneration(testCase);
    results.push({ testCase: testCase.name, ...result });
    
    // Rate limit delay
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Summary
  console.log('\n\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`\nTests run: ${results.length}`);
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}`);
  
  if (successful > 0) {
    const avgDuration = results
      .filter(r => r.success && r.duration)
      .reduce((sum, r) => sum + (r.duration || 0), 0) / successful;
    const totalTokens = results
      .filter(r => r.success && r.tokens)
      .reduce((sum, r) => sum + (r.tokens || 0), 0);
    
    console.log(`\nAverage duration: ${Math.round(avgDuration)}ms`);
    console.log(`Total tokens used: ${totalTokens}`);
  }
  
  const testsWithForbiddenWords = results.filter(
    r => r.success && r.forbiddenWords && r.forbiddenWords.length > 0
  );
  
  if (testsWithForbiddenWords.length > 0) {
    console.log(`\n⚠️  ${testsWithForbiddenWords.length} test(s) contained forbidden words`);
  }
  
  console.log('\n✅ All tests completed!');
  console.log('   Results saved in test-results/\n');
}

main();
