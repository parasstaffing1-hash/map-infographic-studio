import { mkdir, readFile, writeFile } from 'node:fs/promises';
import polygonClipping from 'polygon-clipping';
import parseZip, { parseDbf, parseShp } from 'shpjs';

const DATA_DIR = new URL('../public/data/', import.meta.url);
const GADM_1 = 'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_IND_1.json';
const GADM_2 = 'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_IND_2.json';
const GADM_USA_0 = 'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_USA_0.json';
const GADM_CHINA_0 = 'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_CHN_0.json';
const ASSEMBLY_BASE = 'https://raw.githubusercontent.com/datameet/maps/master/assembly-constituencies/India_AC';
const CITY_CSV = 'https://raw.githubusercontent.com/recurze/IndianCities/master/final_cities.csv';
const WORLD_GEOJSON = 'https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson';
const OFFICIAL_INDIA_OUTLINE = 'https://surveyofindia.gov.in/documents/Outline_of_India.zip';
const OFFICIAL_JK_LADAKH_SOURCE = 'https://raw.githubusercontent.com/AbhinavSwami28/india-official-geojson/main/india-states-simplified.geojson';
const JAMMU_KASHMIR_DISTRICTS = new Set([
  'Anantnag', 'Badgam', 'Bandipore', 'Baramulla', 'Doda', 'Ganderbal', 'Jammu', 'Kathua',
  'Kishtwar', 'Kulgam', 'Kupwara', 'Poonch', 'Pulwama', 'Rajouri', 'Ramban', 'Reasi',
  'Samba', 'Shupiyan', 'Srinagar', 'Udhampur',
]);

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
  return response.json();
}

async function getBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
  return response.arrayBuffer();
}

async function getText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
  return response.text();
}

function toFeatureCollection(geometries, records, keep) {
  return {
    type: 'FeatureCollection',
    features: geometries
      .map((geometry, index) => ({ type: 'Feature', geometry, properties: records[index] ?? {} }))
      .filter((feature) => keep(feature.properties)),
  };
}

function topCitiesFromCsv(csv) {
  const rows = csv.trim().split(/\r?\n/).slice(1).map((line) => {
    const [state, district, name, population, area, latitude, longitude] = line.split(',');
    return { state, district, name, population: Number(population), area: Number(area), latitude: Number(latitude), longitude: Number(longitude) };
  }).filter((row) => row.name && row.population > 0 && row.latitude !== 0 && row.longitude !== 0);
  const unique = new Map();
  for (const row of rows) {
    const key = `${row.state}:${row.name}`.toLowerCase();
    const current = unique.get(key);
    if (!current || row.population > current.population) unique.set(key, row);
  }
  return {
    type: 'FeatureCollection',
    features: [...unique.values()].sort((a, b) => b.population - a.population).slice(0, 100).map((row, index) => ({
      type: 'Feature',
      id: `city-${index + 1}`,
      geometry: { type: 'Point', coordinates: [row.longitude, row.latitude] },
      properties: { rank: index + 1, name: row.name, state: row.state, district: row.district, population: row.population, area_sq_km: row.area, period: '2011', source: 'census-2011-city-dataset' },
    })),
  };
}

await mkdir(DATA_DIR, { recursive: true });

const [gadm1, gadm2, usaRaw, chinaRaw, worldRaw] = await Promise.all([
  getJson(GADM_1),
  getJson(GADM_2),
  getJson(GADM_USA_0),
  getJson(GADM_CHINA_0),
  getJson(WORLD_GEOJSON),
]);
const officialJkLadakhRaw = await getJson(OFFICIAL_JK_LADAKH_SOURCE).catch(async () => JSON.parse(await readFile(new URL('jammu_kashmir_state.json', DATA_DIR), 'utf8')));
const officialIndiaRaw = await parseZip(await getBuffer(OFFICIAL_INDIA_OUTLINE));
const officialIndiaSource = Array.isArray(officialIndiaRaw) ? officialIndiaRaw[0] : officialIndiaRaw;
const officialIndia = {
  type: 'FeatureCollection',
  features: officialIndiaSource.features.map((feature, index) => ({
    ...feature,
    id: `india-${index}`,
    geometry: simplifyGeometry(feature.geometry, 0.05),
    properties: { ...feature.properties, name: 'India', source: 'survey-of-india-official', __name: 'India', __source: 'survey-of-india-official', __viewMode: 'india' },
  })),
};
const world = { type: 'FeatureCollection', features: worldRaw.features.map((feature) => ({ ...feature, properties: { ...feature.properties, source: 'natural-earth-world' } })) };
const usa = countryBoundary(usaRaw, 'USA');
const china = countryBoundary(chinaRaw, 'China', officialIndia);
const uttarakhand = gadm1.features.filter((feature) => feature.properties?.NAME_1 === 'Uttarakhand');
const districts = gadm2.features.filter((feature) => feature.properties?.NAME_1 === 'Uttarakhand');
const indiaDistricts = gadm2.features.map((feature) => ({ ...feature, geometry: simplifyGeometry(feature.geometry, 0.01) }));
const jammuKashmirState = officialJkLadakhRaw.features
  .filter((feature) => feature.properties?.NAME_1 === 'Jammu and Kashmir' || feature.properties?.NAME_1 === 'Ladakh')
  .map((feature, index) => ({
    ...feature,
    id: `jammu-kashmir-ladakh-${index}`,
    geometry: simplifyGeometry(feature.geometry, 0.01),
    properties: { ...feature.properties, source: 'survey-of-india-jk-ladakh', __name: feature.properties?.NAME_1 },
  }));
const jammuKashmirDistricts = gadm2.features.filter((feature) => feature.properties?.NAME_1 === 'JammuandKashmir' && JAMMU_KASHMIR_DISTRICTS.has(feature.properties?.NAME_2));

await writeFile(new URL('uttarakhand.json', DATA_DIR), JSON.stringify({ type: 'FeatureCollection', features: uttarakhand }));
await writeFile(new URL('india_states.json', DATA_DIR), JSON.stringify({ type: 'FeatureCollection', features: gadm1.features }));
await writeFile(new URL('india_districts.json', DATA_DIR), JSON.stringify({ type: 'FeatureCollection', features: indiaDistricts }));
await writeFile(new URL('districts.json', DATA_DIR), JSON.stringify({ type: 'FeatureCollection', features: districts }));
await writeFile(new URL('jammu_kashmir.json', DATA_DIR), JSON.stringify({ type: 'FeatureCollection', features: jammuKashmirDistricts }));
await writeFile(new URL('jammu_kashmir_state.json', DATA_DIR), JSON.stringify({ type: 'FeatureCollection', features: jammuKashmirState }));
await writeFile(new URL('world.json', DATA_DIR), JSON.stringify(world));
await writeFile(new URL('usa.json', DATA_DIR), JSON.stringify(usa));
await writeFile(new URL('china.json', DATA_DIR), JSON.stringify(china));
await writeFile(new URL('india_official.json', DATA_DIR), JSON.stringify(officialIndia));

const [shp, dbf] = await Promise.all([
  getBuffer(`${ASSEMBLY_BASE}.shp`),
  getBuffer(`${ASSEMBLY_BASE}.dbf`),
]);
const assemblyGeometry = parseShp(shp);
const assemblyRows = parseDbf(dbf);
const assemblies = toFeatureCollection(assemblyGeometry, assemblyRows, (properties) => {
  const values = Object.values(properties).map((value) => String(value ?? '').toLowerCase());
  return String(properties.ST_NAME ?? '').toUpperCase() === 'UTTARKHAND';
});
await writeFile(new URL('assemblies.json', DATA_DIR), JSON.stringify(assemblies));

const cities = topCitiesFromCsv(await getText(CITY_CSV));
await writeFile(new URL('cities_top_100.json', DATA_DIR), JSON.stringify(cities));

const provenance = {
  generatedAt: new Date().toISOString(),
  sources: [
    {
      id: 'gadm-4.1',
      organization: 'Database of Global Administrative Areas',
      reference: GADM_1,
      license: 'GADM license; verify terms before redistribution',
      quality: 'context-only',
    },
    {
      id: 'gadm-4.1-usa',
      organization: 'GADM · USA',
      reference: GADM_USA_0,
      license: 'GADM license; verify terms before redistribution',
      quality: 'country boundary context-only',
    },
    {
      id: 'gadm-4.1-china',
      organization: 'GADM · China',
      reference: GADM_CHINA_0,
      license: 'GADM license; verify terms before redistribution',
      quality: 'country boundary clipped against the Survey of India outline',
    },
    {
      id: 'datameet-india-ac',
      organization: 'DataMeet',
      reference: 'https://github.com/datameet/maps/tree/master/assembly-constituencies',
      license: 'CC BY 4.0',
      quality: 'open electoral boundary source; verify against current official delimitation before production use',
    },
    {
      id: 'osm-nominatim-ramnagar',
      organization: 'OpenStreetMap contributors / Nominatim',
      reference: 'https://nominatim.openstreetmap.org/',
      license: 'ODbL',
      quality: 'place resolution context',
    },
    {
      id: 'census-2011-city-dataset',
      organization: 'IndianCities dataset',
      reference: 'https://github.com/recurze/IndianCities',
      license: 'Open source repository; verify terms before redistribution',
      quality: 'Census 2011-derived city population ranking; verify against official Census tables before production use',
    },
    {
      id: 'natural-earth-world',
      organization: 'Natural Earth / D3 Graph Gallery mirror',
      reference: WORLD_GEOJSON,
      license: 'Public domain Natural Earth derivative',
      quality: 'low-resolution country context; use higher-resolution boundary versions for production analysis',
    },
    {
      id: 'survey-of-india-official',
      organization: 'Survey of India · Government of India',
      reference: OFFICIAL_INDIA_OUTLINE,
      license: 'Government of India; access terms apply',
      quality: 'official generalized outline vector at 1:16M scale',
    },
    {
      id: 'survey-of-india-jk-ladakh',
      organization: 'Survey of India · J&K and Ladakh',
      reference: `https://www.surveyofindia.gov.in/pages/geospatial-digital-data-register · ${OFFICIAL_JK_LADAKH_SOURCE}`,
      license: 'Source-aligned public GeoJSON; verify against current Survey of India data before production use',
      quality: 'separate current Union Territory outlines for J&K and Ladakh',
    },
  ],
};
await writeFile(new URL('provenance.json', DATA_DIR), JSON.stringify(provenance, null, 2));

console.log(`Prepared ${world.features.length} world countries, ${usa.features.length} USA boundary feature, ${china.features.length} China boundary feature, ${uttarakhand.length} state feature, ${indiaDistricts.length} India district features, ${districts.length} Uttarakhand district features, ${jammuKashmirDistricts.length} J&K district features, ${assemblies.features.length} assembly features, ${cities.features.length} city points.`);

function countryBoundary(collection, name, clipMask) {
  const clipGeometries = clipMask?.features.map((feature) => feature.geometry).filter(Boolean) ?? [];
  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature, index) => {
      const simplified = simplifyGeometry(feature.geometry, 0.02);
      const geometry = clipGeometries.length ? subtractGeometries(simplified, clipGeometries) : simplified;
      return {
        ...feature,
        id: `${name.toLowerCase()}-${index}`,
        geometry,
        properties: {
          ...feature.properties,
          name,
          source: `gadm-4.1-${name.toLowerCase()}`,
          boundaryPolicy: clipGeometries.length ? 'clipped-against-survey-of-india-outline' : undefined,
        },
      };
    }).filter((feature) => feature.geometry?.coordinates?.length),
  };
}

function subtractGeometries(subjectGeometry, clipGeometries) {
  const subject = asMultiPolygon(subjectGeometry);
  const clips = clipGeometries.map(asMultiPolygon).filter((geometry) => geometry.length);
  if (!subject.length || !clips.length) return subjectGeometry;
  const coordinates = polygonClipping.difference(subject, ...clips) ?? [];
  return { type: 'MultiPolygon', coordinates };
}

function asMultiPolygon(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function simplifyGeometry(geometry, tolerance) {
  if (!geometry) return geometry;
  if (geometry.type === 'Polygon') return { ...geometry, coordinates: geometry.coordinates.map((ring) => simplifyLine(ring, tolerance)) };
  if (geometry.type === 'MultiPolygon') {
    const polygons = geometry.coordinates.map((polygon) => polygon.map((ring) => simplifyLine(ring, tolerance))).filter((polygon) => polygon.every((ring) => ring.length >= 4));
    return { ...geometry, coordinates: polygons.sort((first, second) => polygonExtent(second) - polygonExtent(first)).slice(0, 24) };
  }
  return geometry;
}

function simplifyLine(points, tolerance) {
  if (points.length <= 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  simplifySegment(points, 0, points.length - 1, tolerance * tolerance, keep);
  const simplified = points.filter((_, index) => keep[index]);
  return simplified.length < 4 ? points : simplified;
}

function simplifySegment(points, start, end, toleranceSquared, keep) {
  let maximumDistance = toleranceSquared;
  let splitIndex = -1;
  const startPoint = points[start];
  const endPoint = points[end];
  const deltaX = endPoint[0] - startPoint[0];
  const deltaY = endPoint[1] - startPoint[1];
  const denominator = deltaX * deltaX + deltaY * deltaY;

  for (let index = start + 1; index < end; index += 1) {
    let projection = denominator === 0 ? 0 : ((points[index][0] - startPoint[0]) * deltaX + (points[index][1] - startPoint[1]) * deltaY) / denominator;
    projection = Math.max(0, Math.min(1, projection));
    const projectedPoint = [startPoint[0] + projection * deltaX, startPoint[1] + projection * deltaY];
    const distance = squaredDistance(points[index], projectedPoint);
    if (distance > maximumDistance) {
      maximumDistance = distance;
      splitIndex = index;
    }
  }

  if (splitIndex === -1) return;
  keep[splitIndex] = 1;
  simplifySegment(points, start, splitIndex, toleranceSquared, keep);
  simplifySegment(points, splitIndex, end, toleranceSquared, keep);
}

function squaredDistance(first, second) {
  const deltaX = first[0] - second[0];
  const deltaY = first[1] - second[1];
  return deltaX * deltaX + deltaY * deltaY;
}

function polygonExtent(polygon) {
  const coordinates = polygon[0] ?? [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of coordinates) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return (maxX - minX) * (maxY - minY);
}
