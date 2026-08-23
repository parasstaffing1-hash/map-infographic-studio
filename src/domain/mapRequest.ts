import { MapRequestSchema, type MapRequest } from './types';

export function createMapRequest(query: string, overrides: Partial<MapRequest> = {}): MapRequest {
  return MapRequestSchema.parse({
    query,
    entityType: 'state',
    mapType: 'general',
    interactionMode: 'interactive',
    layers: ['auto'],
    filters: [],
    style: 'clean',
    output: 'interactive',
    countryCode: 'IN',
    viewport: {},
    ...overrides,
  });
}
