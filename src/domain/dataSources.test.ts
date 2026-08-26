import { describe, expect, it, vi } from 'vitest';
import {
  applyColumnMapping,
  applyRegionOverrides,
  assertFetchableUrl,
  attributionLine,
  countMissingValues,
  dedupeRows,
  EMPTY_DATASET_META,
  fetchRemoteDataset,
  findDuplicateRows,
  googleSheetCsvUrl,
  suggestColumnMapping,
  suggestRegionMatches,
  tableFromDelimitedText,
  tableFromJson,
  tableFromJsonText,
} from './dataSources';
import type { DataRow } from './infographic';

function row(id: string, region: string, value: string | number, year?: string): DataRow {
  return { id, region, value, year, raw: { Region: region, Value: value } };
}

describe('googleSheetCsvUrl', () => {
  it('rewrites a share link into the CSV export endpoint', () => {
    expect(googleSheetCsvUrl('https://docs.google.com/spreadsheets/d/abc123XYZ/edit#gid=456'))
      .toBe('https://docs.google.com/spreadsheets/d/abc123XYZ/export?format=csv&gid=456');
  });

  it('defaults to the first tab when no gid is present', () => {
    expect(googleSheetCsvUrl('https://docs.google.com/spreadsheets/d/abc123XYZ/edit'))
      .toBe('https://docs.google.com/spreadsheets/d/abc123XYZ/export?format=csv&gid=0');
  });

  it('returns null for a non-Sheets URL', () => {
    expect(googleSheetCsvUrl('https://api.example.com/data.json')).toBeNull();
  });
});

describe('assertFetchableUrl', () => {
  it('rejects non-http schemes', () => {
    expect(() => assertFetchableUrl('file:///etc/passwd')).toThrow(/http/);
    expect(() => assertFetchableUrl('javascript:alert(1)')).toThrow(/http/);
  });

  it('accepts https URLs', () => {
    expect(assertFetchableUrl('https://example.com/a.csv')).toBe('https://example.com/a.csv');
  });
});

describe('JSON ingestion', () => {
  it('reads a bare array of objects', () => {
    const table = tableFromJson([{ state: 'Delhi', population: 20 }, { state: 'Kerala', population: 35 }]);
    expect(table.headers).toEqual(['state', 'population']);
    expect(table.records).toEqual([['Delhi', 20], ['Kerala', 35]]);
  });

  it('finds the record array inside a wrapper object', () => {
    const table = tableFromJsonText(JSON.stringify({ status: 'ok', data: [{ name: 'Bihar', gdp: 7.4 }] }));
    expect(table.headers).toEqual(['name', 'gdp']);
  });

  it('flattens nested objects into dotted columns', () => {
    const table = tableFromJson([{ name: 'Goa', stats: { gdp: 9, rank: 2 } }]);
    expect(table.headers).toEqual(['name', 'stats.gdp', 'stats.rank']);
    expect(table.records[0]).toEqual(['Goa', 9, 2]);
  });

  it('raises a readable error for malformed JSON', () => {
    expect(() => tableFromJsonText('{not json')).toThrow(/valid JSON/);
  });
});

describe('suggestColumnMapping', () => {
  it('picks the region name column and a numeric value column', () => {
    const table = tableFromDelimitedText('State,Population,Year\nDelhi,20,2021\nKerala,35,2021');
    const mapping = suggestColumnMapping(table);
    expect(mapping.region).toBe('State');
    expect(mapping.value).toBe('Population');
    expect(mapping.year).toBe('Year');
  });

  it('does not reuse the region column as the value column', () => {
    const table = tableFromDelimitedText('District,Total\nSurat,4\nRajkot,9');
    const mapping = suggestColumnMapping(table);
    expect(mapping.region).toBe('District');
    expect(mapping.value).toBe('Total');
  });
});

describe('applyColumnMapping', () => {
  const table = tableFromDelimitedText('State,Seats,Year\nDelhi,7,2024\nGoa,,2024');

  it('builds rows from an explicit mapping', () => {
    const rows = applyColumnMapping(table, { region: 'State', value: 'Seats', year: 'Year' });
    expect(rows).toHaveLength(2);
    expect(rows[0].region).toBe('Delhi');
    expect(rows[0].year).toBe('2024');
  });

  it('drops rows with missing values when asked', () => {
    expect(applyColumnMapping(table, { region: 'State', value: 'Seats' }, 'drop')).toHaveLength(1);
  });

  it('substitutes zero when the policy says so', () => {
    const rows = applyColumnMapping(table, { region: 'State', value: 'Seats' }, 'zero');
    expect(rows[1].value).toBe(0);
  });

  it('keeps every original column available for charting', () => {
    const rows = applyColumnMapping(table, { region: 'State', value: 'Seats' });
    expect(Object.keys(rows[0].raw)).toEqual(['State', 'Seats', 'Year']);
  });
});

describe('duplicates and missing values', () => {
  const rows = [row('a', 'Delhi', 1, '2020'), row('b', 'Delhi', 2, '2020'), row('c', 'Delhi', 3, '2021'), row('d', 'Kerala', '')];

  it('treats a repeated region and year as a duplicate', () => {
    const groups = findDuplicateRows(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('does not treat a genuine time series as duplicated', () => {
    expect(findDuplicateRows([row('a', 'Delhi', 1, '2020'), row('b', 'Delhi', 2, '2021')])).toHaveLength(0);
  });

  it('keeps the last row of each duplicate group', () => {
    expect(dedupeRows(rows).map((entry) => entry.id)).toEqual(['b', 'c', 'd']);
  });

  it('counts blank values', () => {
    expect(countMissingValues(rows)).toBe(1);
  });
});

describe('region correction', () => {
  it('rewrites a name so it matches the boundary file', () => {
    const rows = applyRegionOverrides([row('a', 'Pondicherry', 5)], { Pondicherry: 'Puducherry' });
    expect(rows[0].region).toBe('Puducherry');
  });

  it('leaves rows untouched when there are no overrides', () => {
    const original = [row('a', 'Delhi', 1)];
    expect(applyRegionOverrides(original, {})).toBe(original);
  });

  it('ranks close boundary names first', () => {
    const matches = suggestRegionMatches('Tamilnadu', ['Tamil Nadu', 'Telangana', 'Tripura']);
    expect(matches[0].candidate).toBe('Tamil Nadu');
  });
});

describe('fetchRemoteDataset', () => {
  it('parses a CSV response', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('State,Value\nDelhi,10', { headers: { 'content-type': 'text/csv' } }));
    const result = await fetchRemoteDataset('https://example.com/a.csv', fetcher as unknown as typeof fetch);
    expect(result.rows).toHaveLength(1);
    expect(result.meta.origin).toBe('rest-api');
  });

  it('parses a JSON API response and marks the Google Sheet origin', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ State: 'Goa', Value: 3 }]), { headers: { 'content-type': 'application/json' } }));
    const result = await fetchRemoteDataset('https://docs.google.com/spreadsheets/d/abc/edit', fetcher as unknown as typeof fetch);
    expect(result.meta.origin).toBe('google-sheet');
    expect(result.rows[0].region).toBe('Goa');
  });

  it('surfaces an HTTP failure instead of returning empty data', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('nope', { status: 403, statusText: 'Forbidden' }));
    await expect(fetchRemoteDataset('https://example.com/a.csv', fetcher as unknown as typeof fetch)).rejects.toThrow(/403/);
  });
});

describe('attributionLine', () => {
  it('builds a source line from the recorded provenance', () => {
    expect(attributionLine({ ...EMPTY_DATASET_META, publisher: 'MoSPI', releaseDate: '2024-03-01' }, 'fallback'))
      .toBe('Source: MoSPI · 2024-03-01');
  });

  it('labels synthetic demo data explicitly', () => {
    expect(attributionLine({ ...EMPTY_DATASET_META, synthetic: true }, 'Source: demo')).toMatch(/SYNTHETIC DEMO DATA/);
  });
});
