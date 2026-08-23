import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import proj4 from 'proj4';
import { parseDbf, parseShp } from 'shpjs';

const DATA_DIR = new URL('../public/data/', import.meta.url);
const DISTRICT_CACHE = new URL('../.tmp-delhi-data/district_nwic.GeoJSON', import.meta.url);
const DISTRICT_ARCHIVE = 'https://nwdp.nwic.gov.in/dataset/6c1af675-1dec-4927-882c-c1ba9d73f76b/resource/8d9aa2e9-9806-4f26-a4ac-48ba21e9b96d/download/district_nwic_geojson.zip';
const ASSEMBLY_BASE = 'https://raw.githubusercontent.com/datameet/maps/master/assembly-constituencies/India_AC';
const INDIA_NSF_LCC = '+proj=lcc +lat_0=24 +lon_0=80 +lat_1=12.472955 +lat_2=35.1728044444444 +x_0=4000000 +y_0=4000000 +datum=WGS84 +units=m +no_defs';

const assemblyNameCorrections = new Map([
  [1, 'Narela'],
  [10, 'Sultanpur Majra (SC)'],
  [12, 'Mangol Puri (SC)'],
  [48, 'Ambedkar Nagar (SC)'],
  [65, 'Seelampur'],
]);

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
  return response.arrayBuffer();
}

async function loadDistrictCollection() {
  try {
    return JSON.parse(await readFile(DISTRICT_CACHE, 'utf8'));
  } catch {
    const archive = unzipSync(new Uint8Array(await fetchBuffer(DISTRICT_ARCHIVE)));
    const entry = Object.entries(archive).find(([name]) => /\.geojson$/i.test(name));
    if (!entry) throw new Error('The NWIC district archive did not contain a GeoJSON file');
    return JSON.parse(strFromU8(entry[1]));
  }
}

await mkdir(DATA_DIR, { recursive: true });

const districtCollection = await loadDistrictCollection();
const delhiDistricts = {
  type: 'FeatureCollection',
  features: districtCollection.features
    .filter((feature) => String(feature.properties?.state ?? '') === 'DL')
    .map((feature, index) => {
      const name = String(feature.properties?.district ?? `Delhi district ${index + 1}`);
      const code = String(feature.properties?.dtcode ?? index + 1);
      return {
        ...feature,
        id: `delhi-district-${code}`,
        geometry: {
          ...feature.geometry,
          coordinates: reprojectCoordinates(feature.geometry.coordinates),
        },
        properties: {
          ...feature.properties,
          NAME_1: 'Delhi',
          NAME_2: name,
          DIST_NAME: name,
          source: 'nwic-gsi-districts',
          published_model: '11 districts · dataset updated 2025-05-05',
        },
      };
    }),
};

const [shapeResponse, databaseResponse] = await Promise.all([
  fetchBuffer(`${ASSEMBLY_BASE}.shp`),
  fetchBuffer(`${ASSEMBLY_BASE}.dbf`),
]);
const geometries = parseShp(shapeResponse);
const rows = parseDbf(databaseResponse);
const delhiAssemblies = {
  type: 'FeatureCollection',
  features: geometries
    .map((geometry, index) => ({ type: 'Feature', geometry, properties: rows[index] ?? {} }))
    .filter((feature) => String(feature.properties.ST_NAME ?? '').toUpperCase() === 'DELHI')
    .sort((first, second) => Number(first.properties.AC_NO) - Number(second.properties.AC_NO))
    .map((feature) => {
      const number = Number(feature.properties.AC_NO);
      return {
        ...feature,
        id: `delhi-ac-${number}`,
        properties: {
          ...feature.properties,
          AC_NAME: assemblyNameCorrections.get(number) ?? feature.properties.AC_NAME,
          source: 'datameet-india-ac',
          official_reference: 'Chief Electoral Officer, Delhi · 70 Assembly constituencies',
        },
      };
    }),
};

if (delhiDistricts.features.length !== 11) throw new Error(`Expected 11 published Delhi district geometries, found ${delhiDistricts.features.length}`);
if (delhiAssemblies.features.length !== 70) throw new Error(`Expected 70 Delhi Assembly constituencies, found ${delhiAssemblies.features.length}`);

const provenanceUrl = new URL('provenance.json', DATA_DIR);
const provenance = await readFile(provenanceUrl, 'utf8').then(JSON.parse).catch(() => ({ generatedAt: new Date().toISOString(), sources: [] }));
const delhiSources = [
  {
    id: 'nwic-gsi-districts',
    organization: 'National Water Data Portal · Geological Survey of India',
    reference: 'https://www.nwdp.nwic.gov.in/dataset/district-boundary',
    license: 'Government of India open-data resource; access terms apply',
    quality: 'May 2025 published vector with Delhi\'s 11 pre-reorganisation district boundaries; reprojected from EPSG:7755 to WGS 84',
  },
  {
    id: 'ceo-delhi-ac-reference',
    organization: 'Chief Electoral Officer, Delhi',
    reference: 'https://ceodelhi.gov.in/AcListEng.aspx',
    license: 'Government of NCT of Delhi; access terms apply',
    quality: 'official reference list validating Delhi\'s 70 Assembly constituencies',
  },
];
const delhiSourceIds = new Set(delhiSources.map((source) => source.id));
provenance.sources = [...provenance.sources.filter((source) => !delhiSourceIds.has(source.id)), ...delhiSources];

await Promise.all([
  writeFile(new URL('delhi_districts.json', DATA_DIR), JSON.stringify(delhiDistricts)),
  writeFile(new URL('delhi_assemblies.json', DATA_DIR), JSON.stringify(delhiAssemblies)),
  writeFile(provenanceUrl, JSON.stringify(provenance, null, 2)),
]);

console.log(`Prepared ${delhiDistricts.features.length} published Delhi districts and ${delhiAssemblies.features.length} Delhi Assembly constituencies.`);

function reprojectCoordinates(value) {
  if (typeof value?.[0] === 'number') return proj4(INDIA_NSF_LCC, 'EPSG:4326', value);
  return value.map(reprojectCoordinates);
}
