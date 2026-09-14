import type { ChartSpec } from './charts';
import { DEFAULT_COMPOSITION_ID } from './composition';
import { EMPTY_DATASET_META, type DatasetMeta, type RegionOverrides } from './dataSources';
import { DEFAULT_INFOGRAPHIC_CONFIG, type Annotation, type DataRow, type InfographicConfig } from './infographic';
import { DEFAULT_VIDEO_SPEC, type VideoSpec } from './videoTimeline';
import { DEFAULT_WATERMARK, normalizeWatermark, type WatermarkSettings } from './watermark';
import type { FilterSpec, StyleSpec, ViewMode } from './types';

/**
 * The one document the editor, the still renderer and the video renderer all read.
 * Bump this when a change cannot be expressed by `migrateProjectDocument`.
 */
export const PROJECT_SCHEMA_VERSION = 2;

/** Everything needed to put the map back exactly where the author left it. */
export type MapGeography = {
  viewMode: ViewMode;
  districtScope?: string;
  focusPlace?: string;
  placeContext?: string;
  selectedIds: string[];
};

/** Map paint settings that must survive a reload and reach the renderers. */
export type MapPresentation = {
  style: StyleSpec;
  hiddenLayers: Record<string, boolean>;
};

/** Brand values are embedded so a renderer never has to look them up. */
export type BrandKitSnapshot = {
  id: string;
  name: string;
  colors: string[];
  fontFamily: string;
  sourcePrefix: string;
  /** A data: URI, or an object-storage key the renderer can resolve. */
  logoDataUrl?: string;
  logoObjectKey?: string;
};

export type DashboardBlockType = 'kpi' | 'chart' | 'map' | 'table' | 'narrative' | 'three';

export type DashboardBlock = {
  id: string;
  type: DashboardBlockType;
  title: string;
};

export type DashboardDocument = {
  name: string;
  blocks: DashboardBlock[];
  activeTemplate?: string;
};

export const DEFAULT_DASHBOARD_BLOCKS: DashboardBlock[] = [
  { id: 'kpi-1', type: 'kpi', title: 'Total records' },
  { id: 'chart-1', type: 'chart', title: 'Top regions' },
  { id: 'map-1', type: 'map', title: 'Geographic spread' },
  { id: 'three-1', type: 'three', title: 'Global signal' },
];

export function emptyDashboardDocument(name = 'Untitled dashboard'): DashboardDocument {
  return { name, blocks: DEFAULT_DASHBOARD_BLOCKS.map((block) => ({ ...block })) };
}

export type ProjectDocument = {
  schemaVersion: number;
  name: string;
  geography: MapGeography;
  presentation: MapPresentation;
  compositionId: string;
  chartOverrides: Record<string, Partial<ChartSpec>>;
  config: InfographicConfig;
  rows: DataRow[];
  annotations: Annotation[];
  currentYear?: string;
  datasetMeta: DatasetMeta;
  regionOverrides: RegionOverrides;
  filters: FilterSpec[];
  brandKit?: BrandKitSnapshot;
  videoSpec: VideoSpec;
  dashboard: DashboardDocument;
  watermark: WatermarkSettings;
};

export const DEFAULT_MAP_STYLE: StyleSpec = {
  fill: '#2f83b5',
  line: '#0f2740',
  opacity: 0.78,
  lineWidth: 1.4,
  labelField: '__name',
  theme: 'light',
};

export const DEFAULT_GEOGRAPHY: MapGeography = {
  viewMode: 'india',
  selectedIds: [],
};

export function emptyProjectDocument(name = 'Untitled project'): ProjectDocument {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name,
    geography: { ...DEFAULT_GEOGRAPHY },
    presentation: { style: { ...DEFAULT_MAP_STYLE }, hiddenLayers: {} },
    compositionId: DEFAULT_COMPOSITION_ID,
    chartOverrides: {},
    config: { ...DEFAULT_INFOGRAPHIC_CONFIG },
    rows: [],
    annotations: [],
    datasetMeta: { ...EMPTY_DATASET_META },
    regionOverrides: {},
    filters: [],
    videoSpec: { ...DEFAULT_VIDEO_SPEC },
    dashboard: emptyDashboardDocument(),
    watermark: { ...DEFAULT_WATERMARK },
  };
}

const VIEW_MODES: ViewMode[] = [
  'world', 'india', 'usa', 'china', 'india-districts', 'india-assembly', 'india-parliament',
  'usa-counties', 'usa-state-house', 'usa-congress', 'china-prefectures', 'china-counties',
  'china-npc', 'delhi-districts', 'delhi-assembly', 'jammu-kashmir', 'state', 'district',
  'assembly', 'cities', 'place',
];

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === 'string' && (VIEW_MODES as string[]).includes(value);
}

/**
 * Accepts any historical shape and returns a current document.
 *
 * Handles the pre-schema single-document localStorage payload (v1) and the
 * flat Project record, so upgrading never loses saved work.
 */
export function migrateProjectDocument(input: unknown, fallbackName = 'Untitled project'): ProjectDocument {
  const base = emptyProjectDocument(fallbackName);
  if (!input || typeof input !== 'object') return base;
  const record = input as Record<string, unknown>;

  // Already current: merge over defaults so a missing field cannot crash a render.
  if (Number(record.schemaVersion) >= 2) {
    return {
      ...base,
      ...(record as Partial<ProjectDocument>),
      schemaVersion: PROJECT_SCHEMA_VERSION,
      name: typeof record.name === 'string' && record.name ? record.name : base.name,
      geography: mergeGeography(base.geography, record.geography),
      presentation: mergePresentation(base.presentation, record.presentation),
      config: { ...base.config, ...(record.config as Partial<InfographicConfig> | undefined) },
      datasetMeta: { ...base.datasetMeta, ...(record.datasetMeta as Partial<DatasetMeta> | undefined) },
      videoSpec: { ...base.videoSpec, ...(record.videoSpec as Partial<VideoSpec> | undefined) },
      rows: asArray<DataRow>(record.rows),
      annotations: asArray<Annotation>(record.annotations),
      filters: asArray<FilterSpec>(record.filters),
      chartOverrides: asRecord(record.chartOverrides) as Record<string, Partial<ChartSpec>>,
      regionOverrides: asRecord(record.regionOverrides) as RegionOverrides,
      compositionId: typeof record.compositionId === 'string' ? record.compositionId : base.compositionId,
      dashboard: mergeDashboard(base.dashboard, record.dashboard),
      watermark: normalizeWatermark(record.watermark),
    };
  }

  // v1: a flat Project, or the original rows/config/annotations/currentYear blob.
  const config = { ...base.config, ...(record.config as Partial<InfographicConfig> | undefined) };
  return {
    ...base,
    name: typeof record.name === 'string' && record.name ? record.name : config.title || base.name,
    geography: {
      ...base.geography,
      viewMode: isViewMode(record.viewMode) ? record.viewMode : base.geography.viewMode,
      districtScope: typeof record.districtScope === 'string' ? record.districtScope : undefined,
    },
    compositionId: typeof record.compositionId === 'string' ? record.compositionId : base.compositionId,
    chartOverrides: asRecord(record.chartOverrides) as Record<string, Partial<ChartSpec>>,
    config,
    rows: asArray<DataRow>(record.rows),
    annotations: asArray<Annotation>(record.annotations),
    currentYear: typeof record.currentYear === 'string' ? record.currentYear : undefined,
    datasetMeta: { ...base.datasetMeta, ...(record.datasetMeta as Partial<DatasetMeta> | undefined) },
    regionOverrides: asRecord(record.regionOverrides) as RegionOverrides,
    watermark: normalizeWatermark(record.watermark),
  };
}

function mergeGeography(base: MapGeography, value: unknown): MapGeography {
  if (!value || typeof value !== 'object') return base;
  const record = value as Record<string, unknown>;
  return {
    viewMode: isViewMode(record.viewMode) ? record.viewMode : base.viewMode,
    districtScope: typeof record.districtScope === 'string' && record.districtScope ? record.districtScope : undefined,
    focusPlace: typeof record.focusPlace === 'string' && record.focusPlace ? record.focusPlace : undefined,
    placeContext: typeof record.placeContext === 'string' && record.placeContext ? record.placeContext : undefined,
    selectedIds: asArray<string>(record.selectedIds).filter((entry) => typeof entry === 'string'),
  };
}

function mergePresentation(base: MapPresentation, value: unknown): MapPresentation {
  if (!value || typeof value !== 'object') return base;
  const record = value as Record<string, unknown>;
  return {
    style: { ...base.style, ...(record.style as Partial<StyleSpec> | undefined) },
    hiddenLayers: asRecord(record.hiddenLayers) as Record<string, boolean>,
  };
}

function mergeDashboard(base: DashboardDocument, value: unknown): DashboardDocument {
  if (!value || typeof value !== 'object') return base;
  const record = value as Record<string, unknown>;
  const blocks = Array.isArray(record.blocks)
    ? record.blocks.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
      .filter((entry) => isDashboardBlockType(entry.type) && typeof entry.id === 'string' && typeof entry.title === 'string')
      .map((entry) => ({ id: entry.id as string, type: entry.type as DashboardBlockType, title: entry.title as string }))
    : base.blocks;
  return {
    name: typeof record.name === 'string' && record.name ? record.name : base.name,
    blocks: blocks.length ? blocks : base.blocks.map((block) => ({ ...block })),
    activeTemplate: typeof record.activeTemplate === 'string' ? record.activeTemplate : undefined,
  };
}

function isDashboardBlockType(value: unknown): value is DashboardBlockType {
  return value === 'kpi' || value === 'chart' || value === 'map' || value === 'table' || value === 'narrative' || value === 'three';
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Normalises a document before it is handed to a renderer. */
export function toRenderDocument(document: ProjectDocument): ProjectDocument {
  return { ...document, schemaVersion: PROJECT_SCHEMA_VERSION };
}
