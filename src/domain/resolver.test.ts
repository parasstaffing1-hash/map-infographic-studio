import { describe, expect, it } from 'vitest';
import { parseMapRequest } from './parser';
import { resolvePlace, resolveRamnagarCandidates } from './resolver';

describe('place resolver', () => {
  it('resolves Ramnagar to the OSM-backed town record', () => {
    const request = parseMapRequest('Make me a map of Ramnagar, Uttarakhand');
    const entity = resolvePlace(request);
    expect(entity?.name).toBe('Ramnagar');
    expect(entity?.districtName).toBe('Nainital');
    expect(entity?.sourceId).toBe('osm-nominatim-ramnagar');
  });

  it('keeps ambiguous Ramnagar interpretations available for review', () => {
    const candidates = resolveRamnagarCandidates();
    expect(candidates.map((candidate) => candidate.metadata.status)).toContain('candidate');
    expect(candidates.some((candidate) => candidate.entityType === 'town')).toBe(true);
    expect(candidates.some((candidate) => candidate.entityType === 'assembly_constituency')).toBe(true);
  });

  it('resolves New York City from the global place catalog', () => {
    const entity = resolvePlace(parseMapRequest('nyc map'));
    expect(entity?.name).toBe('New York City');
    expect(entity?.parentName).toBe('United States');
    expect(entity?.sourceId).toBe('osm-nominatim-global');
  });
});
