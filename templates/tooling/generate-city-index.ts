import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

// --- Types ---

interface Gate {
    lat: string;
    lng: string;
}

interface ExitCorridor {
    name: string;
    gate: Gate;
}

interface CityInput {
    city_id: string;
    name: string;
    exit_corridors: ExitCorridor[];
}

interface Dataset {
    version: number;
    generated_at: string;
    cities: CityInput[];
}

interface Point {
    lat: number;
    lng: number;
}

interface CityOutput {
    city_id: string;
    polygon: [number, number][]; // [lng, lat] per PolylinePoint definition
    bbox: {
        minLat: number;
        maxLat: number;
        minLng: number;
        maxLng: number;
    };
}

interface OutputArtifact {
    version: number;
    generated_at: string;
    city_ids: string[];
    cities: CityOutput[];
}

// --- Constants ---

const RESOURCES_DIR = path.resolve(process.cwd(), 'resources');
const OUTPUT_FILE = path.resolve(RESOURCES_DIR, '_generated', 'city_polygon_index.ts');
const INPUT_FILES = [
    path.resolve(RESOURCES_DIR, 'mx_cities_gates.yaml'),
    path.resolve(RESOURCES_DIR, 'mx_cities_casetas.yaml'),
];

// --- Utilities ---

/**
 * Counts decimal places in a coordinate string.
 * Fails if exactly 2 decimals are found.
 */
function validatePrecision(val: string, context: string) {
    const parts = val.split('.');
    if (parts.length !== 2) return;

    const decimals = parts[1].length;
    if (decimals === 2) {
        throw new Error(`CRITICAL: Coordinate "${val}" has exactly 2 decimal places in ${context}. Build FAILED.`);
    }
}

/**
 * Monotone Chain algorithm for Convex Hull.
 * Ported to TS.
 */
function getConvexHull(points: Point[]): Point[] {
    if (points.length <= 2) return points;

    // Pre-sort for Monotone Chain (already sorted by lng, then lat)

    const crossProduct = (a: Point, b: Point, c: Point) => {
        return (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
    };

    const lower: Point[] = [];
    for (const p of points) {
        while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
            lower.pop();
        }
        lower.push(p);
    }

    const upper: Point[] = [];
    for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
            upper.pop();
        }
        upper.push(p);
    }

    upper.pop();
    lower.pop();
    return lower.concat(upper);
}

// --- Main ---

async function main() {
    console.log('🏙️ Generating city polygon index artifact...');

    const combinedCities = new Map<string, Point[]>();

    let maxGeneratedAt = '1970-01-01T00:00:00Z';

    for (const filePath of INPUT_FILES) {
        console.log(`  Reading ${path.basename(filePath)}...`);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const data = yaml.parse(fileContent) as Dataset;

        if (data.generated_at && data.generated_at > maxGeneratedAt) {
            maxGeneratedAt = data.generated_at;
        }

        for (const city of data.cities) {
            if (!combinedCities.has(city.city_id)) {
                combinedCities.set(city.city_id, []);
            }

            const cityPoints = combinedCities.get(city.city_id)!;

            for (const corridor of city.exit_corridors) {
                if (!corridor.gate) continue;

                const { lat, lng } = corridor.gate;
                const context = `city ${city.city_id} in ${path.basename(filePath)}`;

                validatePrecision(lat, context);
                validatePrecision(lng, context);

                cityPoints.push({
                    lat: parseFloat(lat),
                    lng: parseFloat(lng),
                });
            }
        }
    }

    const outputCities: CityOutput[] = [];

    // Sort city IDs for determinism
    const sortedCityIds = Array.from(combinedCities.keys()).sort();

    for (const cityId of sortedCityIds) {
        const rawPoints = combinedCities.get(cityId)!;

        // Deduplicate points (deterministicly)
        // Map with string key for exact matching
        const pointMap = new Map<string, Point>();
        for (const p of rawPoints) {
            const key = `${p.lng},${p.lat}`;
            if (!pointMap.has(key)) {
                pointMap.set(key, p);
            }
        }

        const uniquePoints = Array.from(pointMap.values());

        // Sort unique points: lng asc, then lat asc (normative requirement)
        uniquePoints.sort((a, b) => a.lng - b.lng || a.lat - b.lat);

        if (uniquePoints.length < 3) {
            console.warn(`  ! City "${cityId}" has only ${uniquePoints.length} points. Skipping polygon (fallback applied).`);
            continue;
        }

        const hull = getConvexHull(uniquePoints);

        // Calculate bbox
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        for (const p of hull) {
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
            if (p.lng < minLng) minLng = p.lng;
            if (p.lng > maxLng) maxLng = p.lng;
        }

        outputCities.push({
            city_id: cityId,
            polygon: hull.map(p => [p.lng, p.lat] as [number, number]),
            bbox: { minLat, maxLat, minLng, maxLng }
        });
    }

    const result: OutputArtifact = {
        version: 1,
        generated_at: maxGeneratedAt,
        city_ids: outputCities.map(c => c.city_id), // Membership rule: city_ids == cities[].city_id set
        cities: outputCities
    };

    const tsContent = `// AUTO-GENERATED FROM resources/mx_cities_*.yaml - DO NOT EDIT MANUALLY
// Generated at: ${result.generated_at}

export const CITY_POLYGON_INDEX = ${JSON.stringify(result, null, 2)} as const;

export type CityPolygonIndex = typeof CITY_POLYGON_INDEX;
`;

    // Ensure artifacts directory exists
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, tsContent, 'utf8');

    console.log(`✅ Artifact generated: ${path.relative(process.cwd(), OUTPUT_FILE)}`);
    console.log(`   Cities in registry: ${result.city_ids.length}`);
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
