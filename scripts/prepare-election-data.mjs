import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseDbf, parseShp } from 'shpjs';

const DATA_DIR = new URL('../public/data/', import.meta.url);
const ASSEMBLY_BASE = 'https://raw.githubusercontent.com/datameet/maps/master/assembly-constituencies/India_AC';
const PARLIAMENT_BASE = 'https://raw.githubusercontent.com/datameet/maps/master/parliamentary-constituencies/india_pc_2019';

const stateScopes = new Map([
  ['ANDAMAN & NICOBAR', 'AndamanandNicobar'],
  ['ANDAMAN & NICOBAR ISLANDS', 'AndamanandNicobar'],
  ['ANDHRA PRADESH', 'AndhraPradesh'],
  ['ARUNACHAL PRADESH', 'ArunachalPradesh'],
  ['ASSAM', 'Assam'],
  ['BIHAR', 'Bihar'],
  ['CHANDIGARH', 'Chandigarh'],
  ['CHHATTISGARH', 'Chhattisgarh'],
  ['DADRA & NAGAR HAVELI', 'DadraandNagarHaveli'],
  ['DAMAN & DIU', 'DamanandDiu'],
  ['DELHI', 'NCTofDelhi'],
  ['GOA', 'Goa'],
  ['GUJARAT', 'Gujarat'],
  ['HARYANA', 'Haryana'],
  ['HIMACHAL PRADESH', 'HimachalPradesh'],
  ['JAMMU & KASHMIR', 'JammuandKashmir'],
  ['JHARKHAND', 'Jharkhand'],
  ['KARNATAKA', 'Karnataka'],
  ['KERALA', 'Kerala'],
  ['LAKSHADWEEP', 'Lakshadweep'],
  ['MADHYA PRADESH', 'MadhyaPradesh'],
  ['MAHARASHTRA', 'Maharashtra'],
  ['MANIPUR', 'Manipur'],
  ['MEGHALAYA', 'Meghalaya'],
  ['MIZORAM', 'Mizoram'],
  ['NAGALAND', 'Nagaland'],
  ['ORISSA', 'Odisha'],
  ['ODISHA', 'Odisha'],
  ['PUDUCHERRY', 'Puducherry'],
  ['PUNJAB', 'Punjab'],
  ['RAJASTHAN', 'Rajasthan'],
  ['SIKKIM', 'Sikkim'],
  ['TAMIL NADU', 'TamilNadu'],
  ['TELANGANA', 'Telangana'],
  ['TRIPURA', 'Tripura'],
  ['UTTAR PRADESH', 'UttarPradesh'],
  ['UTTARAKHAND', 'Uttarakhand'],
  ['WEST BENGAL', 'WestBengal'],
]);

const assemblyNameCorrections = new Map([
  ['7:1', 'Narela'],
  ['7:10', 'Sultanpur Majra (SC)'],
  ['7:12', 'Mangol Puri (SC)'],
  ['7:48', 'Ambedkar Nagar (SC)'],
  ['7:65', 'Seelampur'],
]);

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
  return response.arrayBuffer();
}

async function loadShapefile(base) {
  const [shape, database] = await Promise.all([fetchBuffer(`${base}.shp`), fetchBuffer(`${base}.dbf`)]);
  const geometries = parseShp(shape);
  const rows = parseDbf(database);
  return geometries.map((geometry, index) => ({ type: 'Feature', geometry, properties: rows[index] ?? {} }));
}

await mkdir(DATA_DIR, { recursive: true });

const rawAssemblyFeatures = await loadShapefile(ASSEMBLY_BASE);
const assemblyBySeat = new Map();
for (const feature of rawAssemblyFeatures) {
  const stateName = String(feature.properties.ST_NAME ?? '').toUpperCase();
  const stateCode = Number(feature.properties.ST_CODE);
  const number = Number(feature.properties.AC_NO);
  if (!number) continue;
  const correctedName = assemblyNameCorrections.get(`${stateCode}:${number}`) ?? feature.properties.AC_NAME;
  const key = `${stateCode}:${number}`;
  const current = assemblyBySeat.get(key);
  if (current) {
    current.geometry = mergePolygonGeometry(current.geometry, feature.geometry);
    continue;
  }
  assemblyBySeat.set(key, {
    ...feature,
    id: `india-ac-${stateCode}-${number}`,
    properties: {
      ...feature.properties,
      AC_NAME: correctedName,
      STATE_SCOPE: stateScopes.get(stateName) ?? stateName,
      source: 'datameet-india-ac',
    },
  });
}
const assemblyFeatures = [...assemblyBySeat.values()].map((feature) => ({ ...feature, geometry: simplifyGeometry(feature.geometry, 0.003) }));

const parliamentFeatures = (await loadShapefile(PARLIAMENT_BASE)).map((feature, index) => {
  const stateName = String(feature.properties.ST_NAME ?? '').toUpperCase();
  const stateCode = String(feature.properties.ST_CODE ?? '');
  const number = Number(feature.properties.PC_CODE);
  return {
    ...feature,
    id: `india-pc-${stateCode}-${number}-${index}`,
    geometry: simplifyGeometry(feature.geometry, 0.008),
    properties: {
      ...feature.properties,
      PC_NO: number,
      STATE_SCOPE: stateScopes.get(stateName) ?? stateName,
      source: 'datameet-india-pc-2019',
    },
  };
});

if (rawAssemblyFeatures.length !== 4182) throw new Error(`Expected 4,182 raw Assembly records, found ${rawAssemblyFeatures.length}`);
if (assemblyFeatures.length !== 4095) throw new Error(`Expected 4,095 unique positive-number Assembly seats, found ${assemblyFeatures.length}`);
if (parliamentFeatures.length !== 543) throw new Error(`Expected 543 parliamentary constituencies, found ${parliamentFeatures.length}`);

const provenanceUrl = new URL('provenance.json', DATA_DIR);
const provenance = await readFile(provenanceUrl, 'utf8').then(JSON.parse).catch(() => ({ generatedAt: new Date().toISOString(), sources: [] }));
const parliamentarySource = {
  id: 'datameet-india-pc-2019',
  organization: 'DataMeet · 2019 parliamentary constituencies',
  reference: 'https://github.com/datameet/maps/tree/master/parliamentary-constituencies',
  license: 'CC BY 4.0',
  quality: '543-seat 2019 Lok Sabha boundary source; verify against current delimitation before production analysis',
};
provenance.sources = [...provenance.sources.filter((source) => source.id !== parliamentarySource.id), parliamentarySource];

await Promise.all([
  writeFile(new URL('india_assemblies.json', DATA_DIR), JSON.stringify({ type: 'FeatureCollection', features: assemblyFeatures })),
  writeFile(new URL('india_parliament.json', DATA_DIR), JSON.stringify({ type: 'FeatureCollection', features: parliamentFeatures })),
  writeFile(provenanceUrl, JSON.stringify(provenance, null, 2)),
]);

console.log(`Prepared ${assemblyFeatures.length} Assembly records and ${parliamentFeatures.length} parliamentary constituencies.`);

function mergePolygonGeometry(first, second) {
  const polygons = [...asMultiPolygon(first), ...asMultiPolygon(second)];
  return { type: 'MultiPolygon', coordinates: polygons };
}

function asMultiPolygon(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function simplifyGeometry(geometry, tolerance) {
  if (!geometry) return geometry;
  if (geometry.type === 'Polygon') return { ...geometry, coordinates: geometry.coordinates.map((ring) => simplifyLine(ring, tolerance)) };
  if (geometry.type === 'MultiPolygon') return { ...geometry, coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => simplifyLine(ring, tolerance))).filter((polygon) => polygon.every((ring) => ring.length >= 4)) };
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
