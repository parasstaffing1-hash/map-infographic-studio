import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFeatures } from './data';

const worldSource = {
  type: 'FeatureCollection' as const,
  features: [
    { type: 'Feature' as const, id: 'IND', geometry: { type: 'Polygon', coordinates: [] }, properties: { name: 'India', source: 'natural-earth-world' } },
    { type: 'Feature' as const, id: 'USA', geometry: { type: 'Polygon', coordinates: [] }, properties: { name: 'United States', source: 'natural-earth-world' } },
  ],
};

const officialIndiaSource = {
  type: 'FeatureCollection' as const,
  features: [
    { type: 'Feature' as const, geometry: { type: 'MultiPolygon', coordinates: [[[[68, 8], [97, 8], [97, 35], [68, 35], [68, 8]]]] }, properties: { name: 'India', source: 'survey-of-india-official' } },
  ],
};

describe('world boundary source', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('replaces Natural Earth India with the official Survey of India outline', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('world.json') ? worldSource : officialIndiaSource))));

    const collection = await loadFeatures('world');
    const india = collection.features.find((feature) => feature.properties.__name === 'India');

    expect(collection.features).toHaveLength(2);
    expect(india?.id).toBe('world-india-official');
    expect(india?.properties.__source).toBe('survey-of-india-official');
    expect(india?.properties.__officialIndia).toBe(true);
    expect(india?.geometry).toEqual(officialIndiaSource.features[0].geometry);
  });
});
