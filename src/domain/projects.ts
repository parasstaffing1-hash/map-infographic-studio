import type { ChartSpec } from './charts';
import { DEFAULT_COMPOSITION_ID } from './composition';
import { EMPTY_DATASET_META, type DatasetMeta, type RegionOverrides } from './dataSources';
import { DEFAULT_INFOGRAPHIC_CONFIG, type Annotation, type DataRow, type InfographicConfig } from './infographic';
import {
  DEFAULT_GEOGRAPHY,
  DEFAULT_MAP_STYLE,
  PROJECT_SCHEMA_VERSION,
  isViewMode,
  migrateProjectDocument,
  type MapGeography,
  type MapPresentation,
  type ProjectDocument,
} from './projectDocument';
import { DEFAULT_VIDEO_SPEC, type VideoSpec } from './videoTimeline';
import type { FilterSpec, ViewMode } from './types';

export const PROJECT_STORAGE_KEY = 'map-studio-projects-v1';
/** The single-project key used before projects existed. Migrated on first load. */
export const LEGACY_PROJECT_KEY = 'map-studio-infographic-v1';
export const BRAND_KIT_STORAGE_KEY = 'map-studio-brand-kits-v1';

export type ProjectVersion = {
  id: string;
  savedAt: string;
  label: string;
  rows: DataRow[];
  config: InfographicConfig;
  annotations: Annotation[];
  /** Geography is snapshotted too, so restoring a version restores the map view. */
  geography?: MapGeography;
  presentation?: MapPresentation;
  compositionId?: string;
  chartOverrides?: Record<string, Partial<ChartSpec>>;
  currentYear?: string;
};

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  /** Where the map was pointed. Restored verbatim on reload and on reopen. */
  geography: MapGeography;
  /** Map paint state, so a reopened project looks the way it was left. */
  presentation: MapPresentation;
  filters: FilterSpec[];
  videoSpec: VideoSpec;
  compositionId: string;
  chartOverrides: Record<string, Partial<ChartSpec>>;
  config: InfographicConfig;
  rows: DataRow[];
  annotations: Annotation[];
  currentYear?: string;
  datasetMeta: DatasetMeta;
  regionOverrides: RegionOverrides;
  brandKitId?: string;
  /** Newest first, capped so localStorage cannot grow without bound. */
  versions: ProjectVersion[];
};

export type BrandKit = {
  id: string;
  name: string;
  colors: string[];
  fontFamily: string;
  logoDataUrl?: string;
  sourcePrefix: string;
};

export const MAX_VERSIONS = 20;

export const DEFAULT_BRAND_KITS: BrandKit[] = [
  { id: 'studio-default', name: 'Studio default', colors: ['#fff7d6', '#84c69b', '#3c9d91', '#176b87', '#173f5f'], fontFamily: 'Inter, system-ui, sans-serif', sourcePrefix: 'Source:' },
  { id: 'newsroom', name: 'Newsroom', colors: ['#fff1e6', '#f7c59f', '#ef8a62', '#d8574f', '#4b2840'], fontFamily: 'Georgia, "Times New Roman", serif', sourcePrefix: 'Source:' },
  { id: 'research', name: 'Research brief', colors: ['#eef5ff', '#c8daf7', '#91b4ea', '#5f88d0', '#293d77'], fontFamily: 'Inter, system-ui, sans-serif', sourcePrefix: 'Data:' },
];

export function createProject(name = 'Untitled project', patch: Partial<Project> = {}): Project {
  const now = new Date().toISOString();
  return {
    id: newId('prj'),
    name,
    createdAt: now,
    updatedAt: now,
    archived: false,
    geography: { ...DEFAULT_GEOGRAPHY },
    presentation: { style: { ...DEFAULT_MAP_STYLE }, hiddenLayers: {} },
    filters: [],
    videoSpec: { ...DEFAULT_VIDEO_SPEC },
    compositionId: DEFAULT_COMPOSITION_ID,
    chartOverrides: {},
    config: { ...DEFAULT_INFOGRAPHIC_CONFIG },
    rows: [],
    annotations: [],
    datasetMeta: { ...EMPTY_DATASET_META },
    regionOverrides: {},
    versions: [],
    ...patch,
  };
}

export function duplicateProject(project: Project): Project {
  const now = new Date().toISOString();
  return { ...deepCopy(project), id: newId('prj'), name: `${project.name} copy`, createdAt: now, updatedAt: now, archived: false, versions: [] };
}

/** Appends a version snapshot, keeping only the most recent MAX_VERSIONS. */
export function pushVersion(project: Project, label = 'Autosave'): Project {
  const version: ProjectVersion = {
    id: newId('ver'),
    savedAt: new Date().toISOString(),
    label,
    rows: project.rows,
    config: project.config,
    annotations: project.annotations,
    geography: project.geography,
    presentation: project.presentation,
    compositionId: project.compositionId,
    chartOverrides: project.chartOverrides,
    currentYear: project.currentYear,
  };
  return { ...project, updatedAt: version.savedAt, versions: [version, ...project.versions].slice(0, MAX_VERSIONS) };
}

export function restoreVersion(project: Project, versionId: string): Project {
  const version = project.versions.find((entry) => entry.id === versionId);
  if (!version) return project;
  // Snapshot the current state first so restoring is itself undoable.
  const snapshotted = pushVersion(project, 'Before restore');
  return {
    ...snapshotted,
    rows: version.rows,
    config: version.config,
    annotations: version.annotations,
    // Older snapshots predate geography capture; keep the current view in that case.
    geography: version.geography ?? snapshotted.geography,
    presentation: version.presentation ?? snapshotted.presentation,
    compositionId: version.compositionId ?? snapshotted.compositionId,
    chartOverrides: version.chartOverrides ?? snapshotted.chartOverrides,
    currentYear: version.currentYear ?? snapshotted.currentYear,
    updatedAt: new Date().toISOString(),
  };
}

export type ProjectStore = { projects: Project[]; activeId?: string };

export function loadProjectStore(storage: Storage): ProjectStore {
  const raw = safeRead(storage, PROJECT_STORAGE_KEY);
  if (raw) {
    const parsed = safeParse<ProjectStore>(raw);
    if (parsed && Array.isArray(parsed.projects)) {
      return { projects: parsed.projects.map(normalizeProject), activeId: parsed.activeId };
    }
  }
  const migrated = migrateLegacyProject(storage);
  return migrated ? { projects: [migrated], activeId: migrated.id } : { projects: [], activeId: undefined };
}

export function saveProjectStore(storage: Storage, store: ProjectStore) {
  try {
    storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    // Quota exceeded: retry without version history rather than losing the project.
    try {
      storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify({ ...store, projects: store.projects.map((project) => ({ ...project, versions: project.versions.slice(0, 2) })) }));
      return true;
    } catch {
      return false;
    }
  }
}

/** Brings a pre-projects single-document save forward into the project store. */
export function migrateLegacyProject(storage: Storage): Project | null {
  const raw = safeRead(storage, LEGACY_PROJECT_KEY);
  if (!raw) return null;
  const parsed = safeParse<{ rows?: DataRow[]; config?: Partial<InfographicConfig>; annotations?: Annotation[]; currentYear?: string }>(raw);
  if (!parsed) return null;
  if (!parsed.rows?.length && !parsed.config) return null;
  return createProject(parsed.config?.title || 'Recovered project', {
    rows: Array.isArray(parsed.rows) ? parsed.rows : [],
    config: { ...DEFAULT_INFOGRAPHIC_CONFIG, ...parsed.config },
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
    currentYear: parsed.currentYear,
  });
}

function normalizeProject(project: Partial<Project>): Project {
  const base = createProject(project.name ?? 'Untitled project');
  // Projects saved before geography existed stored viewMode/districtScope flat.
  const legacy = project as Partial<Project> & { viewMode?: unknown; districtScope?: unknown };
  const geography: MapGeography = {
    ...base.geography,
    ...project.geography,
    viewMode: project.geography?.viewMode ?? (isViewMode(legacy.viewMode) ? legacy.viewMode : base.geography.viewMode),
    districtScope: project.geography?.districtScope ?? (typeof legacy.districtScope === 'string' ? legacy.districtScope : undefined),
    selectedIds: Array.isArray(project.geography?.selectedIds) ? project.geography.selectedIds : [],
  };
  return {
    ...base,
    ...project,
    id: project.id ?? base.id,
    geography,
    presentation: {
      style: { ...base.presentation.style, ...project.presentation?.style },
      hiddenLayers: project.presentation?.hiddenLayers ?? {},
    },
    filters: Array.isArray(project.filters) ? project.filters : [],
    videoSpec: { ...base.videoSpec, ...project.videoSpec },
    config: { ...DEFAULT_INFOGRAPHIC_CONFIG, ...project.config },
    compositionId: project.compositionId ?? DEFAULT_COMPOSITION_ID,
    chartOverrides: project.chartOverrides ?? {},
    datasetMeta: { ...EMPTY_DATASET_META, ...project.datasetMeta },
    regionOverrides: project.regionOverrides ?? {},
    rows: Array.isArray(project.rows) ? project.rows : [],
    annotations: Array.isArray(project.annotations) ? project.annotations : [],
    versions: Array.isArray(project.versions) ? project.versions : [],
  };
}

export function loadBrandKits(storage: Storage): BrandKit[] {
  const parsed = safeParse<BrandKit[]>(safeRead(storage, BRAND_KIT_STORAGE_KEY) ?? '');
  const custom = Array.isArray(parsed) ? parsed : [];
  return [...DEFAULT_BRAND_KITS, ...custom.filter((kit) => !DEFAULT_BRAND_KITS.some((preset) => preset.id === kit.id))];
}

export function saveBrandKits(storage: Storage, kits: BrandKit[]) {
  const custom = kits.filter((kit) => !DEFAULT_BRAND_KITS.some((preset) => preset.id === kit.id));
  try {
    storage.setItem(BRAND_KIT_STORAGE_KEY, JSON.stringify(custom));
    return true;
  } catch {
    return false;
  }
}

export function applyBrandKit(config: InfographicConfig, kit: BrandKit): InfographicConfig {
  return { ...config, customColors: kit.colors };
}

/** A share payload carries the finished visual and its data, but no editing history. */
export type SharePayload = {
  v: 1;
  name: string;
  viewMode: ViewMode;
  geography?: MapGeography;
  presentation?: MapPresentation;
  compositionId: string;
  chartOverrides: Record<string, Partial<ChartSpec>>;
  config: InfographicConfig;
  rows: DataRow[];
  annotations: Annotation[];
  currentYear?: string;
  datasetMeta: DatasetMeta;
};

export function toSharePayload(project: Project): SharePayload {
  return {
    v: 1,
    name: project.name,
    viewMode: project.geography.viewMode,
    geography: project.geography,
    presentation: project.presentation,
    compositionId: project.compositionId,
    chartOverrides: project.chartOverrides,
    config: project.config,
    rows: project.rows,
    annotations: project.annotations,
    currentYear: project.currentYear,
    datasetMeta: project.datasetMeta,
  };
}

export function encodeSharePayload(payload: SharePayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSharePayload(encoded: string): SharePayload | null {
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as SharePayload;
    return parsed && parsed.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

/** Browsers and proxies cap URL length; refuse to hand out a link that will break. */
export const MAX_SHARE_URL_LENGTH = 8000;

export function buildShareUrl(origin: string, project: Project) {
  const encoded = encodeSharePayload(toSharePayload(project));
  const url = `${origin.replace(/\/$/, '')}/?view=shared#d=${encoded}`;
  return { url, tooLong: url.length > MAX_SHARE_URL_LENGTH, length: url.length };
}

export function readSharedProjectFromLocation(search: string, hash: string): SharePayload | null {
  if (!new URLSearchParams(search).has('view')) return null;
  const match = hash.match(/[#&]d=([^&]+)/);
  return match ? decodeSharePayload(match[1]) : null;
}

export type ProjectRole = 'owner' | 'editor' | 'viewer';

export const ROLE_CAPABILITIES: Record<ProjectRole, { edit: boolean; export: boolean; share: boolean; remove: boolean }> = {
  owner: { edit: true, export: true, share: true, remove: true },
  editor: { edit: true, export: true, share: false, remove: false },
  viewer: { edit: false, export: true, share: false, remove: false },
};

export function can(role: ProjectRole, capability: keyof (typeof ROLE_CAPABILITIES)['owner']) {
  return ROLE_CAPABILITIES[role][capability];
}

function newId(prefix: string) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function safeRead(storage: Storage, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}


/** Converts a stored project into the versioned document every renderer reads. */
export function toProjectDocument(project: Project, brandKits: BrandKit[] = []): ProjectDocument {
  const kit = brandKits.find((entry) => entry.id === project.brandKitId);
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: project.name,
    geography: project.geography,
    presentation: project.presentation,
    compositionId: project.compositionId,
    chartOverrides: project.chartOverrides,
    config: project.config,
    rows: project.rows,
    annotations: project.annotations,
    currentYear: project.currentYear,
    datasetMeta: project.datasetMeta,
    regionOverrides: project.regionOverrides,
    filters: project.filters,
    videoSpec: project.videoSpec,
    brandKit: kit
      ? {
          id: kit.id,
          name: kit.name,
          colors: kit.colors,
          fontFamily: kit.fontFamily,
          sourcePrefix: kit.sourcePrefix,
          logoDataUrl: kit.logoDataUrl,
        }
      : undefined,
  };
}

/** Rebuilds a project from a document, keeping identity fields when supplied. */
export function projectFromDocument(input: unknown, identity: Partial<Project> = {}): Project {
  const document = migrateProjectDocument(input, identity.name ?? 'Untitled project');
  const base = createProject(document.name);
  return {
    ...base,
    ...identity,
    id: identity.id ?? base.id,
    name: document.name,
    geography: document.geography,
    presentation: document.presentation,
    compositionId: document.compositionId,
    chartOverrides: document.chartOverrides,
    config: document.config,
    rows: document.rows,
    annotations: document.annotations,
    currentYear: document.currentYear,
    datasetMeta: document.datasetMeta,
    regionOverrides: document.regionOverrides,
    filters: document.filters,
    videoSpec: document.videoSpec,
    brandKitId: document.brandKit?.id ?? identity.brandKitId,
    versions: Array.isArray(identity.versions) ? identity.versions : base.versions,
  };
}
