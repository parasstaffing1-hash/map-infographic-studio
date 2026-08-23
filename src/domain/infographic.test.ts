import { describe, expect, it } from 'vitest';
import { DEFAULT_INFOGRAPHIC_CONFIG, createVisualization, dataYears, parseDelimitedText } from './infographic';
import type { GeoFeature } from './types';

const features: GeoFeature[] = [
  { type: 'Feature', id: 'delhi', geometry: { type: 'Polygon', coordinates: [] }, properties: { __name: 'NCT of Delhi', SCOPE_NAME: 'India' } },
  { type: 'Feature', id: 'karnataka', geometry: { type: 'Polygon', coordinates: [] }, properties: { __name: 'Karnataka', SCOPE_NAME: 'India' } },
  { type: 'Feature', id: 'odisha', geometry: { type: 'Polygon', coordinates: [] }, properties: { __name: 'Odisha', SCOPE_NAME: 'India' } },
];

describe('infographic data pipeline', () => {
  it('parses pasted CSV and detects region, value, year, and parent columns', () => {
    const rows = parseDelimitedText('State,Value,Year,Parent\nDelhi,"1,250",2023,India\nKarnataka,42,2024,India');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ region: 'Delhi', value: '1,250', year: '2023', parent: 'India' });
    expect(dataYears(rows)).toEqual(['2023', '2024']);
  });

  it('matches common aliases and builds a numeric colour scale', () => {
    const rows = parseDelimitedText('Region,Value\nDelhi,10\nOrissa,30\nKarnataka,20');
    const result = createVisualization(rows, features, undefined, DEFAULT_INFOGRAPHIC_CONFIG);
    expect(result.matchedRows).toBe(3);
    expect(result.unmatchedRows).toHaveLength(0);
    expect(result.dataKind).toBe('numeric');
    expect(result.byFeatureId.delhi.formattedValue).toBe('10');
    expect(result.legend).toHaveLength(DEFAULT_INFOGRAPHIC_CONFIG.classes);
  });

  it('supports categorical maps and reports unmatched rows', () => {
    const rows = parseDelimitedText('Region,Party\nDelhi,A\nKarnataka,B\nAtlantis,C');
    const result = createVisualization(rows, features, undefined, { ...DEFAULT_INFOGRAPHIC_CONFIG, scaleMode: 'categorical' });
    expect(result.dataKind).toBe('categorical');
    expect(result.matchedRows).toBe(2);
    expect(result.unmatchedRows.map((row) => row.region)).toEqual(['Atlantis']);
    expect(result.legend.map((item) => item.label)).toEqual(['A', 'B']);
  });

  it('colours every geometry fragment when a region is split across source features', () => {
    const fragments: GeoFeature[] = [
      { type: 'Feature', id: 'uk-main', geometry: { type: 'Polygon', coordinates: [] }, properties: { __name: 'Uttarakhand' } },
      { type: 'Feature', id: 'uk-fragment', geometry: { type: 'Polygon', coordinates: [] }, properties: { __name: 'Uttarakhand' } },
    ];
    const result = createVisualization(parseDelimitedText('Region,Value\nUttarakhand,25'), fragments, undefined, DEFAULT_INFOGRAPHIC_CONFIG);
    expect(result.matchedRows).toBe(1);
    expect(result.ambiguousRows).toHaveLength(0);
    expect(result.byFeatureId['uk-main'].value).toBe(25);
    expect(result.byFeatureId['uk-fragment'].value).toBe(25);
  });

  it('uses Parent to disambiguate repeated district names', () => {
    const repeated: GeoFeature[] = [
      { type: 'Feature', id: 'aur-state-a', geometry: { type: 'Polygon', coordinates: [] }, properties: { __name: 'Aurangabad', NAME_1: 'Bihar' } },
      { type: 'Feature', id: 'aur-state-b', geometry: { type: 'Polygon', coordinates: [] }, properties: { __name: 'Aurangabad', NAME_1: 'Maharashtra' } },
    ];
    const result = createVisualization(parseDelimitedText('District,Value,Parent\nAurangabad,12,Maharashtra'), repeated, undefined, DEFAULT_INFOGRAPHIC_CONFIG);
    expect(result.matchedRows).toBe(1);
    expect(result.byFeatureId['aur-state-b'].value).toBe(12);
    expect(result.byFeatureId['aur-state-a'].hasData).toBe(false);
  });
});
