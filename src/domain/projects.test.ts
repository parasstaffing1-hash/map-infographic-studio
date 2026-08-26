import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildShareUrl,
  can,
  createProject,
  decodeSharePayload,
  duplicateProject,
  encodeSharePayload,
  LEGACY_PROJECT_KEY,
  loadBrandKits,
  loadProjectStore,
  MAX_VERSIONS,
  migrateLegacyProject,
  pushVersion,
  readSharedProjectFromLocation,
  restoreVersion,
  saveProjectStore,
  toSharePayload,
} from './projects';
import { DEFAULT_INFOGRAPHIC_CONFIG, type DataRow } from './infographic';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  limit = Infinity;
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) {
    if (value.length > this.limit) throw new DOMException('QuotaExceededError');
    this.map.set(key, value);
  }
}

const rows: DataRow[] = [{ id: 'r1', region: 'Delhi', value: 10, raw: { Region: 'Delhi', Value: 10 } }];
let storage: MemoryStorage;

beforeEach(() => { storage = new MemoryStorage(); });

describe('project lifecycle', () => {
  it('creates a project with sane defaults', () => {
    const project = createProject('My map');
    expect(project.name).toBe('My map');
    expect(project.archived).toBe(false);
    expect(project.config).toEqual(DEFAULT_INFOGRAPHIC_CONFIG);
  });

  it('duplicates without carrying over version history or the id', () => {
    const original = pushVersion(createProject('Original', { rows }), 'v1');
    const copy = duplicateProject(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('Original copy');
    expect(copy.versions).toHaveLength(0);
    expect(copy.rows).toEqual(rows);
  });

  it('caps stored versions', () => {
    let project = createProject('Capped');
    for (let index = 0; index < MAX_VERSIONS + 5; index += 1) project = pushVersion(project, `v${index}`);
    expect(project.versions).toHaveLength(MAX_VERSIONS);
    expect(project.versions[0].label).toBe(`v${MAX_VERSIONS + 4}`);
  });

  it('restores an earlier version and keeps the pre-restore state', () => {
    const first = pushVersion(createProject('Restore me', { rows }), 'with data');
    const changed = { ...first, rows: [] };
    const restored = restoreVersion(changed, first.versions[0].id);
    expect(restored.rows).toEqual(rows);
    expect(restored.versions[0].label).toBe('Before restore');
  });

  it('ignores an unknown version id', () => {
    const project = createProject('Untouched', { rows });
    expect(restoreVersion(project, 'nope')).toBe(project);
  });
});

describe('persistence', () => {
  it('round-trips the project store', () => {
    const project = createProject('Saved', { rows });
    expect(saveProjectStore(storage, { projects: [project], activeId: project.id })).toBe(true);
    const loaded = loadProjectStore(storage);
    expect(loaded.projects).toHaveLength(1);
    expect(loaded.activeId).toBe(project.id);
    expect(loaded.projects[0].rows).toEqual(rows);
  });

  it('drops version history rather than losing the project when quota is hit', () => {
    let project = createProject('Big', { rows });
    for (let index = 0; index < MAX_VERSIONS; index += 1) project = pushVersion(project, `v${index}`);
    storage.limit = JSON.stringify({ projects: [{ ...project, versions: project.versions.slice(0, 2) }] }).length + 200;
    expect(saveProjectStore(storage, { projects: [project] })).toBe(true);
    expect(loadProjectStore(storage).projects[0].versions.length).toBeLessThanOrEqual(2);
  });

  it('migrates a pre-projects single-document save', () => {
    storage.setItem(LEGACY_PROJECT_KEY, JSON.stringify({ rows, config: { title: 'Legacy story' }, annotations: [], currentYear: '2024' }));
    const migrated = migrateLegacyProject(storage);
    expect(migrated?.name).toBe('Legacy story');
    expect(migrated?.rows).toEqual(rows);
    expect(loadProjectStore(storage).projects).toHaveLength(1);
  });

  it('returns an empty store when nothing is saved', () => {
    expect(loadProjectStore(storage).projects).toEqual([]);
  });

  it('survives corrupted storage instead of throwing', () => {
    storage.setItem('map-studio-projects-v1', '{broken');
    expect(loadProjectStore(storage).projects).toEqual([]);
  });
});

describe('sharing', () => {
  it('round-trips a share payload through the URL encoding', () => {
    const project = createProject('Shared story', { rows, currentYear: '2024' });
    const decoded = decodeSharePayload(encodeSharePayload(toSharePayload(project)));
    expect(decoded?.name).toBe('Shared story');
    expect(decoded?.rows).toEqual(rows);
    expect(decoded?.currentYear).toBe('2024');
  });

  it('handles non-ASCII titles', () => {
    const project = createProject('भारत का नक्शा', { rows });
    expect(decodeSharePayload(encodeSharePayload(toSharePayload(project)))?.name).toBe('भारत का नक्शा');
  });

  it('flags a link that is too long to be usable', () => {
    const many = Array.from({ length: 4000 }, (_, index) => ({ id: `r${index}`, region: `Region ${index}`, value: index, raw: {} }));
    expect(buildShareUrl('https://studio.example', createProject('Huge', { rows: many })).tooLong).toBe(true);
    expect(buildShareUrl('https://studio.example', createProject('Small', { rows })).tooLong).toBe(false);
  });

  it('reads a shared project back out of the location', () => {
    const { url } = buildShareUrl('https://studio.example', createProject('From link', { rows }));
    const [, hash] = url.split('#');
    expect(readSharedProjectFromLocation('?view=shared', `#${hash}`)?.name).toBe('From link');
  });

  it('returns null when the location carries no share payload', () => {
    expect(readSharedProjectFromLocation('', '')).toBeNull();
    expect(readSharedProjectFromLocation('?view=shared', '#d=not-base64!!')).toBeNull();
  });
});

describe('roles and brand kits', () => {
  it('stops a viewer from editing but still allows export', () => {
    expect(can('viewer', 'edit')).toBe(false);
    expect(can('viewer', 'export')).toBe(true);
    expect(can('editor', 'share')).toBe(false);
    expect(can('owner', 'remove')).toBe(true);
  });

  it('always offers the built-in brand kits', () => {
    expect(loadBrandKits(storage).map((kit) => kit.id)).toContain('studio-default');
  });
});
