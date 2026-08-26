import { describe, expect, it } from 'vitest';
import { configForInfographicTemplate, infographicCategories, infographicTemplates, rowsForInfographicTemplate, searchInfographicTemplates, testGeneralInfographicTemplates, testMapInfographicTemplates, testVideoTemplates } from './infographicTemplates';
import type { GeoFeature } from './types';

const features: GeoFeature[] = [
  { type: 'Feature', id: 'a', geometry: { type: 'Polygon', coordinates: [] }, properties: { __name: 'Region A', SCOPE_NAME: 'Demo' } },
  { type: 'Feature', id: 'a-fragment', geometry: { type: 'Polygon', coordinates: [] }, properties: { __name: 'Region A', SCOPE_NAME: 'Demo' } },
  { type: 'Feature', id: 'b', geometry: { type: 'Polygon', coordinates: [] }, properties: { __name: 'Region B', SCOPE_NAME: 'Demo' } },
];

describe('integrated InfoGraphics templates', () => {
  it('exposes the source catalog across countries and topics', () => {
    expect(infographicTemplates).toHaveLength(35);
    expect(infographicTemplates.some((template) => template.geoScope === 'India')).toBe(true);
    expect(infographicTemplates.some((template) => template.viewMode === 'world')).toBe(true);
    expect(infographicCategories).toContain('Tech & AI');
  });

  it('contains exactly 10 map demos, 5 story demos, and 1 video demo', () => {
    expect(testMapInfographicTemplates).toHaveLength(10);
    expect(testGeneralInfographicTemplates).toHaveLength(5);
    expect(testVideoTemplates).toHaveLength(1);
    expect(searchInfographicTemplates('', 'All', 'Demo test pack')).toHaveLength(16);
  });

  it('loads the production clean-energy sample with source values', () => {
    const template = infographicTemplates.find((item) => item.id === 'india_clean_energy_transition_2024')!;
    const rows = rowsForInfographicTemplate(template);
    const config = configForInfographicTemplate(template);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ region: 'Rajasthan', value: 28.4, year: '2024' });
    expect(config).toMatchObject({ suffix: ' GW', decimals: 1, aspect: '4:5', showTitle: true, presentation: 'editorial', labelMode: 'value' });
  });

  it('ships a Statista-style ranked map preset', () => {
    const template = infographicTemplates.find((item) => item.id === 'india_clean_energy_ranked_2024')!;
    expect(configForInfographicTemplate(template)).toMatchObject({ presentation: 'statista', aspect: '4:5', labelMode: 'value' });
    expect(rowsForInfographicTemplate(template)).toHaveLength(8);
  });

  it('ships a source-backed 15-country GDP video from 1960 through 2026', () => {
    const template = infographicTemplates.find((item) => item.id === 'world_gdp_top_15_1960_2026')!;
    const rows = rowsForInfographicTemplate(template);
    const config = configForInfographicTemplate(template);
    expect(template).toMatchObject({ defaultDurationSeconds: 300, viewMode: 'world', openPanel: 'video', dataQuality: 'verified', alwaysUseSampleRows: true, compositionId: 'world-gdp-race' });
    expect(config).toMatchObject({ prefix: '$', suffix: 'T', decimals: 2, presentation: 'statista' });
    expect(new Set(rows.map((row) => row.region)).size).toBe(15);
    expect(new Set(rows.map((row) => row.year)).size).toBe(67);
    expect(rows.some((row) => row.year === '2026' && row.raw.projected === true)).toBe(true);
    expect(rows.some((row) => row.year === '1960' && row.region === 'Russia')).toBe(false);
  });

  it('filters templates by category and free text', () => {
    expect(searchInfographicTemplates('', 'Fintech').map((template) => template.id)).toEqual(['india_upi_digital_payments', 'central_bank_gold_reserves']);
    expect(searchInfographicTemplates('satellite')).toHaveLength(1);
    expect(searchInfographicTemplates('India').length).toBeGreaterThan(3);
  });

  it('generates deterministic, deduplicated demo rows from published geometry', () => {
    const mapTemplate = testMapInfographicTemplates[0];
    const first = rowsForInfographicTemplate(mapTemplate, features);
    const second = rowsForInfographicTemplate(mapTemplate, features);
    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first.map((row) => row.region)).toEqual(['Region A', 'Region B']);
    expect(first.every((row) => row.raw.demo === true)).toBe(true);
  });

  it('generates five years for the animated video preset', () => {
    const rows = rowsForInfographicTemplate(testVideoTemplates[0], features);
    expect(rows).toHaveLength(10);
    expect([...new Set(rows.map((row) => row.year))]).toEqual(['2020', '2021', '2022', '2023', '2024']);
  });
});
