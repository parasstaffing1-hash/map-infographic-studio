import { mkdir, readFile, writeFile } from 'node:fs/promises';
import parseZip from 'shpjs';

const DATA_DIR = new URL('../public/data/', import.meta.url);
const archive = await readFile(new URL('../official-india.zip', import.meta.url));
const raw = await parseZip(archive);
const source = Array.isArray(raw) ? raw[0] : raw;
const officialIndia = {
  type: 'FeatureCollection',
  features: source.features.map((feature, index) => ({
    ...feature,
    id: `india-${index}`,
    geometry: simplifyGeometry(feature.geometry, 0.05),
    properties: { ...feature.properties, name: 'India', source: 'survey-of-india-official', __name: 'India', __source: 'survey-of-india-official', __viewMode: 'india' },
  })),
};

await mkdir(DATA_DIR, { recursive: true });
await writeFile(new URL('india_official.json', DATA_DIR), JSON.stringify(officialIndia));
console.log(`Prepared official India outline with ${countPoints(officialIndia.features[0].geometry)} vertices.`);

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

function countPoints(geometry) {
  let total = 0;
  const visit = (value) => {
    if (Array.isArray(value) && typeof value[0] === 'number') total += 1;
    else if (Array.isArray(value)) value.forEach(visit);
  };
  visit(geometry.coordinates);
  return total;
}
