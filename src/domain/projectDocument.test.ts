import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GEOGRAPHY,
  PROJECT_SCHEMA_VERSION,
  emptyProjectDocument,
  isViewMode,
  migrateProjectDocument,
} from './projectDocument';
import { createProject, projectFromDocument, pushVersion, restoreVersion, toProjectDocument, type BrandKit } from './projects';
import type { DataRow } from './infographic';

const rows: DataRow[] = [{ id: 'r1', region: 'Kerala', value: 42, year: '2024', raw: { Region: 'Kerala', Value: 42 } }];

describe('project document schema', () => {
  it('starts at the current version with a usable default geography', () => {
    const document = emptyProjectDocument('New story');
    expect(document.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(document.geography).toEqual(DEFAULT_GEOGRAPHY);
    expect(document.presentation.style.fill).toMatch(/^#/);
  });

  it('recognises every view mode the app can navigate to', () => {
    for (const mode of ['india', 'usa-counties', 'china-prefectures', 'india-assembly', 'india-parliament', 'jammu-kashmir', 'world']) {
      expect(isViewMode(mode), mode).toBe(true);
    }
    expect(isViewMode('not-a-view')).toBe(false);
    expect(isViewMode(undefined)).toBe(false);
  });

  it('migrates the original single-document localStorage payload', () => {
    const legacy = { rows, config: { title: 'Legacy story' }, annotations: [], currentYear: '2024' };
    const document = migrateProjectDocument(legacy);
    expect(document.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(document.name).toBe('Legacy story');
    expect(document.rows).toEqual(rows);
    expect(document.currentYear).toBe('2024');
    expect(document.geography.viewMode).toBe('india');
  });

  it('lifts a flat v1 project viewMode and districtScope into geography', () => {
    const document = migrateProjectDocument({ name: 'Flat', viewMode: 'usa-counties', districtScope: '06', rows });
    expect(document.geography.viewMode).toBe('usa-counties');
    expect(document.geography.districtScope).toBe('06');
  });

  it('keeps a current document intact', () => {
    const source = emptyProjectDocument('Keep me');
    source.geography = { viewMode: 'china-prefectures', districtScope: '5101', focusPlace: 'Chengdu', selectedIds: ['a', 'b'] };
    const document = migrateProjectDocument(source);
    expect(document.geography).toEqual(source.geography);
  });

  it('survives junk instead of throwing', () => {
    for (const junk of [null, undefined, 42, 'text', [], { schemaVersion: 2 }]) {
      const document = migrateProjectDocument(junk);
      expect(document.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
      expect(Array.isArray(document.rows)).toBe(true);
    }
  });

  it('ignores a view mode it does not recognise rather than trusting it', () => {
    const document = migrateProjectDocument({ viewMode: 'javascript:alert(1)' });
    expect(document.geography.viewMode).toBe('india');
  });
});

describe('project <-> document round trip', () => {
  it('carries geography, presentation, filters and the video spec', () => {
    const project = createProject('Round trip', {
      rows,
      geography: { viewMode: 'india-districts', districtScope: 'Kerala', focusPlace: 'Kerala', selectedIds: ['x'] },
      presentation: { style: { fill: '#123456', line: '#000000', opacity: 0.5, lineWidth: 2, labelField: '__name', theme: 'light' }, hiddenLayers: { roads: true } },
      filters: [{ id: 'f1', label: 'Margin', field: 'margin', operator: '<', value: '5', active: true }],
    });
    const document = toProjectDocument(project);
    const restored = projectFromDocument(document, { id: project.id });

    expect(restored.geography).toEqual(project.geography);
    expect(restored.presentation).toEqual(project.presentation);
    expect(restored.filters).toEqual(project.filters);
    expect(restored.rows).toEqual(rows);
    expect(restored.videoSpec).toEqual(project.videoSpec);
  });

  it('embeds the brand kit so a renderer needs no lookup', () => {
    const kit: BrandKit = { id: 'kit-1', name: 'Newsroom', colors: ['#111111', '#222222'], fontFamily: 'Georgia, serif', sourcePrefix: 'Source:', logoDataUrl: 'data:image/png;base64,AAAA' };
    const project = createProject('Branded', { brandKitId: 'kit-1' });
    const document = toProjectDocument(project, [kit]);
    expect(document.brandKit).toMatchObject({ id: 'kit-1', name: 'Newsroom', logoDataUrl: 'data:image/png;base64,AAAA' });
  });

  it('leaves the brand kit undefined when the project points at none', () => {
    expect(toProjectDocument(createProject('Plain')).brandKit).toBeUndefined();
  });
});

describe('version snapshots capture geography', () => {
  it('restores the map view along with the data', () => {
    const project = createProject('Versioned', {
      rows,
      geography: { viewMode: 'usa-counties', districtScope: '06', focusPlace: 'California', selectedIds: [] },
    });
    const saved = pushVersion(project, 'On California');

    const moved = {
      ...saved,
      geography: { viewMode: 'china-prefectures' as const, districtScope: '5101', focusPlace: 'Chengdu', selectedIds: [] },
      rows: [],
    };

    const restored = restoreVersion(moved, saved.versions[0].id);
    expect(restored.geography.viewMode).toBe('usa-counties');
    expect(restored.geography.districtScope).toBe('06');
    expect(restored.rows).toEqual(rows);
  });

  it('keeps the current view when restoring a snapshot that predates geography capture', () => {
    const project = createProject('Old snapshot', {
      geography: { viewMode: 'india-parliament', districtScope: 'Bihar', selectedIds: [] },
    });
    const withLegacyVersion = {
      ...project,
      versions: [{ id: 'ver-old', savedAt: new Date().toISOString(), label: 'Legacy', rows, config: project.config, annotations: [] }],
    };
    const restored = restoreVersion(withLegacyVersion, 'ver-old');
    expect(restored.geography.viewMode).toBe('india-parliament');
    expect(restored.rows).toEqual(rows);
  });
});
