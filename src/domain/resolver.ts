import type { MapRequest, ResolvedEntity } from './types';

const placeCatalog: ResolvedEntity[] = [
  {
    id: 'osm-node-245768140',
    name: 'Ramnagar',
    entityType: 'town',
    parentName: 'Uttarakhand',
    districtName: 'Nainital',
    centroid: [79.126934, 29.394835],
    sourceId: 'osm-nominatim-ramnagar',
    confidence: 0.98,
    metadata: { osm_id: 245768140, osm_type: 'node', place_type: 'town' },
  },
  {
    id: 'state-in-uttarakhand',
    name: 'Uttarakhand',
    entityType: 'state',
    parentName: 'India',
    sourceId: 'gadm-4.1',
    confidence: 0.99,
    metadata: { iso1: 'IN-UT' },
  },
  {
    id: 'geonames-new-york-city',
    name: 'New York City',
    entityType: 'city',
    parentName: 'United States',
    centroid: [-74.0060152, 40.7127281],
    sourceId: 'osm-nominatim-global',
    confidence: 0.98,
    metadata: { country_code: 'US', place_type: 'city', osm_id: 175905, status: 'place context' },
  },
  {
    id: 'district-in-nainital',
    name: 'Nainital',
    entityType: 'district',
    parentName: 'Uttarakhand',
    sourceId: 'gadm-4.1',
    confidence: 0.97,
    metadata: { gadm_level: 2 },
  },
];

export function resolvePlace(request: MapRequest): ResolvedEntity | null {
  const target = (request.place ?? request.parentGeography ?? '').toLowerCase();
  if (!target) return null;
  const candidates = placeCatalog.filter((entity) => entity.name.toLowerCase() === target);
  const typeMatch = candidates.find((entity) => entity.entityType === request.entityType);
  return typeMatch ?? candidates[0] ?? null;
}

export function resolveRamnagarCandidates(): ResolvedEntity[] {
  return [
    placeCatalog[0],
    { ...placeCatalog[0], id: 'ramnagar-tehsil', name: 'Ramnagar', entityType: 'district', confidence: 0.72, metadata: { admin_level: 'tehsil', status: 'candidate' } },
    { ...placeCatalog[0], id: 'ramnagar-assembly', name: 'Ramnagar Assembly Constituency', entityType: 'assembly_constituency', confidence: 0.86, metadata: { boundary_source: 'DataMeet', status: 'candidate' } },
  ];
}
