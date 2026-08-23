import { mkdir, readFile, writeFile } from 'node:fs/promises';
import polygonClipping from 'polygon-clipping';
import parseZip from 'shpjs';

const DATA_DIR = new URL('../public/data/', import.meta.url);
const CENSUS_BASE = 'https://www2.census.gov/geo/tiger/GENZ2024/shp';
const USA_SOURCES = {
  states: `${CENSUS_BASE}/cb_2024_us_state_5m.zip`,
  counties: `${CENSUS_BASE}/cb_2024_us_county_5m.zip`,
  stateHouse: `${CENSUS_BASE}/cb_2024_us_sldl_500k.zip`,
  congress: `${CENSUS_BASE}/cb_2024_us_cd119_500k.zip`,
};
const CHINA_SOURCES = {
  provinces: 'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_CHN_1.json',
  prefectures: 'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_CHN_2.json',
  counties: 'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_CHN_3.json',
};
const USA_STATE_FIPS = new Set([
  '01', '02', '04', '05', '06', '08', '09', '10', '11', '12', '13', '15', '16',
  '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29',
  '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42',
  '44', '45', '46', '47', '48', '49', '50', '51', '53', '54', '55', '56',
]);

await mkdir(DATA_DIR, { recursive: true });

const [usaStatesRaw, usaCountiesRaw, usaStateHouseRaw, usaCongressRaw, chinaProvincesRaw, chinaPrefecturesRaw, chinaCountiesRaw, officialIndia] = await Promise.all([
  loadShapefile(USA_SOURCES.states),
  loadShapefile(USA_SOURCES.counties),
  loadShapefile(USA_SOURCES.stateHouse),
  loadShapefile(USA_SOURCES.congress),
  loadJson(CHINA_SOURCES.provinces),
  loadJson(CHINA_SOURCES.prefectures),
  loadJson(CHINA_SOURCES.counties),
  readFile(new URL('india_official.json', DATA_DIR), 'utf8').then(JSON.parse),
]);

const usaStateNames = new Map(
  usaStatesRaw.features
    .filter((feature) => USA_STATE_FIPS.has(String(feature.properties.STATEFP)))
    .map((feature) => [String(feature.properties.STATEFP), String(feature.properties.NAME)]),
);

const usaStates = featureCollection(usaStatesRaw.features
  .filter(isIncludedUsState)
  .map((feature) => normalizeUsFeature(feature, 'state', 0.01, usaStateNames)));
const usaCounties = featureCollection(usaCountiesRaw.features
  .filter(isIncludedUsState)
  .map((feature) => normalizeUsFeature(feature, 'county', 0.008, usaStateNames)));
const usaStateHouse = featureCollection(usaStateHouseRaw.features
  .filter(isIncludedUsState)
  .map((feature) => normalizeUsFeature(feature, 'state-house', 0.004, usaStateNames)));
const usaCongress = featureCollection(usaCongressRaw.features
  .filter(isIncludedUsState)
  .map((feature) => normalizeUsFeature(feature, 'congress', 0.005, usaStateNames)));

const indiaMask = officialIndia.features.map((feature) => feature.geometry).filter(Boolean);
const maskBounds = boundsForGeometries(indiaMask);
const chinaProvinces = featureCollection(groupChinaProvinces(chinaProvincesRaw.features, indiaMask, maskBounds));
const chinaPrefectures = featureCollection(chinaPrefecturesRaw.features
  .map((feature) => normalizeChinaFeature(feature, 'prefecture', 0.009, indiaMask, maskBounds))
  .filter(Boolean));
const chinaCounties = featureCollection(chinaCountiesRaw.features
  .map((feature) => normalizeChinaFeature(feature, 'county', 0.006, indiaMask, maskBounds))
  .filter(Boolean));
const chinaNpc = featureCollection(chinaProvinces.features.map((feature) => ({
  ...feature,
  properties: {
    ...feature.properties,
    source: 'npc-china-admin-context',
    legislative_context: 'Province-level NPC electoral-unit context; not constituency polygons',
  },
})));

const provenance = JSON.parse(await readFile(new URL('provenance.json', DATA_DIR), 'utf8'));
const newSources = [
  {
    id: 'us-census-2024',
    organization: 'United States Census Bureau',
    reference: USA_SOURCES.counties,
    license: 'U.S. Census Bureau cartographic boundary files; public-domain U.S. government work',
    quality: '2024 1:5,000,000 state and county cartographic boundaries; 50 states and District of Columbia',
  },
  {
    id: 'us-census-2024-sldl',
    organization: 'United States Census Bureau · 2024 State Legislative Districts',
    reference: USA_SOURCES.stateHouse,
    license: 'U.S. Census Bureau cartographic boundary files; public-domain U.S. government work',
    quality: '2024 lower-chamber state legislative district plans submitted by states',
  },
  {
    id: 'us-census-2024-cd119',
    organization: 'United States Census Bureau · 119th Congress',
    reference: USA_SOURCES.congress,
    license: 'U.S. Census Bureau cartographic boundary files; public-domain U.S. government work',
    quality: '119th Congressional Districts in effect for January 2025–2027',
  },
  {
    id: 'gadm-4.1-china-admin',
    organization: 'GADM · China administrative divisions',
    reference: CHINA_SOURCES.prefectures,
    license: 'GADM license; verify terms before redistribution',
    quality: 'Province, prefecture, and county context; clipped against the Survey of India outline',
  },
  {
    id: 'npc-china-admin-context',
    organization: 'National People’s Congress · constitutional structure with GADM geometry',
    reference: 'https://www.npc.gov.cn/englishnpc/constitution2019/201911/t20191120_384295.html',
    license: 'Legal reference with GADM administrative geometry; GADM terms apply',
    quality: 'Province-level electoral-unit context only; not published constituency polygons',
  },
];
const sourceIds = new Set(newSources.map((source) => source.id));
provenance.sources = [...provenance.sources.filter((source) => !sourceIds.has(source.id)), ...newSources];
provenance.generatedAt = new Date().toISOString();

await Promise.all([
  writeFile(new URL('usa_states.json', DATA_DIR), JSON.stringify(usaStates)),
  writeFile(new URL('usa_counties.json', DATA_DIR), JSON.stringify(usaCounties)),
  writeFile(new URL('usa_state_house.json', DATA_DIR), JSON.stringify(usaStateHouse)),
  writeFile(new URL('usa_congress.json', DATA_DIR), JSON.stringify(usaCongress)),
  writeFile(new URL('china_provinces.json', DATA_DIR), JSON.stringify(chinaProvinces)),
  writeFile(new URL('china_prefectures.json', DATA_DIR), JSON.stringify(chinaPrefectures)),
  writeFile(new URL('china_counties.json', DATA_DIR), JSON.stringify(chinaCounties)),
  writeFile(new URL('china_npc.json', DATA_DIR), JSON.stringify(chinaNpc)),
  writeFile(new URL('provenance.json', DATA_DIR), JSON.stringify(provenance, null, 2)),
]);

console.log(`Prepared USA: ${usaStates.features.length} states/DC, ${usaCounties.features.length} counties, ${usaStateHouse.features.length} lower-chamber districts, ${usaCongress.features.length} congressional districts.`);
console.log(`Prepared China: ${chinaProvinces.features.length} provinces, ${chinaPrefectures.features.length} prefectures, ${chinaCounties.features.length} counties, ${chinaNpc.features.length} NPC administrative units.`);

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
  return response.json();
}

async function loadShapefile(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
  const parsed = await parseZip(await response.arrayBuffer());
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function featureCollection(features) {
  return { type: 'FeatureCollection', features: features.filter((feature) => feature?.geometry?.coordinates?.length) };
}

function isIncludedUsState(feature) {
  return USA_STATE_FIPS.has(String(feature.properties.STATEFP));
}

function normalizeUsFeature(feature, level, tolerance, stateNames) {
  const properties = feature.properties;
  const stateCode = String(properties.STATEFP);
  const stateName = stateNames.get(stateCode) ?? String(properties.STATE_NAME ?? 'United States');
  const baseName = level === 'state'
    ? String(properties.NAME)
    : level === 'county'
      ? String(properties.NAMELSAD ?? properties.NAME)
      : level === 'state-house'
        ? String(properties.NAMELSAD ?? `State House District ${properties.SLDLST}`)
        : String(properties.NAMELSAD ?? `Congressional District ${properties.CD119FP}`);
  const displayName = level === 'state' || level === 'county' ? baseName : `${stateName} · ${baseName}`;
  return {
    ...feature,
    id: `usa-${level}-${String(properties.GEOID ?? properties.GEOIDFQ)}`,
    geometry: simplifyGeometry(shiftUsLongitudes(feature.geometry), tolerance),
    properties: {
      ...properties,
      DISPLAY_NAME: displayName,
      SCOPE_CODE: stateCode,
      SCOPE_NAME: stateName,
      COUNTRY_SCOPE: 'USA',
      source: level === 'state-house' ? 'us-census-2024-sldl' : level === 'congress' ? 'us-census-2024-cd119' : 'us-census-2024',
    },
  };
}

function groupChinaProvinces(features, indiaMask, maskBounds) {
  const groups = new Map();
  for (const feature of features) {
    const key = String(feature.properties.NAME_1);
    const current = groups.get(key) ?? [];
    current.push(feature);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([scope, parts], index) => {
    const polygons = parts.flatMap((feature) => asMultiPolygon(feature.geometry));
    const union = polygons.length > 1 ? polygonClipping.union(...polygons) : polygons;
    const geometry = clipChinaGeometry({ type: 'MultiPolygon', coordinates: union }, indiaMask, maskBounds);
    return {
      type: 'Feature',
      id: `china-province-${index + 1}`,
      geometry: simplifyGeometry(geometry, 0.015),
      properties: {
        ...parts[0].properties,
        DISPLAY_NAME: formatChinaName(scope),
        SCOPE_CODE: scope,
        SCOPE_NAME: formatChinaName(scope),
        COUNTRY_SCOPE: 'China',
        source: 'gadm-4.1-china-admin',
        boundaryPolicy: 'clipped-against-survey-of-india-outline',
      },
    };
  });
}

function normalizeChinaFeature(feature, level, tolerance, indiaMask, maskBounds) {
  const properties = feature.properties;
  const scope = String(properties.NAME_1);
  const name = level === 'prefecture' ? String(properties.NAME_2) : String(properties.NAME_3);
  const geometry = simplifyGeometry(clipChinaGeometry(feature.geometry, indiaMask, maskBounds), tolerance);
  if (!geometry?.coordinates?.length) return null;
  return {
    ...feature,
    id: `china-${level}-${String(properties[`GID_${level === 'prefecture' ? 2 : 3}`])}`,
    geometry,
    properties: {
      ...properties,
      DISPLAY_NAME: formatChinaName(name),
      SCOPE_CODE: scope,
      SCOPE_NAME: formatChinaName(scope),
      COUNTRY_SCOPE: 'China',
      source: 'gadm-4.1-china-admin',
      boundaryPolicy: 'clipped-against-survey-of-india-outline',
    },
  };
}

function formatChinaName(value) {
  const names = {
    HongKong: 'Hong Kong',
    NeiMongol: 'Inner Mongolia',
    NingxiaHui: 'Ningxia',
    XinjiangUygur: 'Xinjiang',
    Xizang: 'Tibet',
  };
  return names[value] ?? value;
}

function clipChinaGeometry(geometry, indiaMask, maskBounds) {
  if (!intersectsBounds(boundsForGeometries([geometry]), maskBounds)) return geometry;
  const subject = asMultiPolygon(geometry);
  const clips = indiaMask.map(asMultiPolygon).filter((item) => item.length);
  if (!subject.length || !clips.length) return geometry;
  const coordinates = polygonClipping.difference(subject, ...clips) ?? [];
  return { type: 'MultiPolygon', coordinates };
}

function shiftUsLongitudes(geometry) {
  return { ...geometry, coordinates: mapCoordinates(geometry.coordinates, ([longitude, latitude]) => [longitude > 0 ? longitude - 360 : longitude, latitude]) };
}

function mapCoordinates(value, transform) {
  if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') return transform(value);
  return Array.isArray(value) ? value.map((child) => mapCoordinates(child, transform)) : value;
}

function asMultiPolygon(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function simplifyGeometry(geometry, tolerance) {
  if (!geometry) return geometry;
  if (geometry.type === 'Polygon') return { ...geometry, coordinates: geometry.coordinates.map((ring) => simplifyLine(ring, tolerance)).filter((ring) => ring.length >= 4) };
  if (geometry.type === 'MultiPolygon') {
    const polygons = geometry.coordinates
      .map((polygon) => polygon.map((ring) => simplifyLine(ring, tolerance)).filter((ring) => ring.length >= 4))
      .filter((polygon) => polygon.length);
    return { ...geometry, coordinates: polygons };
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

function boundsForGeometries(geometries) {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const geometry of geometries) extendBounds(geometry?.coordinates, bounds);
  return bounds;
}

function extendBounds(value, bounds) {
  if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') {
    bounds.minX = Math.min(bounds.minX, value[0]);
    bounds.minY = Math.min(bounds.minY, value[1]);
    bounds.maxX = Math.max(bounds.maxX, value[0]);
    bounds.maxY = Math.max(bounds.maxY, value[1]);
    return;
  }
  if (Array.isArray(value)) value.forEach((child) => extendBounds(child, bounds));
}

function intersectsBounds(first, second) {
  return first.minX <= second.maxX && first.maxX >= second.minX && first.minY <= second.maxY && first.maxY >= second.minY;
}
