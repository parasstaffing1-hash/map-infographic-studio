import type { ChartSpec } from './charts';
import { DEFAULT_COMPOSITION_ID } from './composition';
import { EMPTY_DATASET_META, type DatasetMeta, type RegionOverrides } from './dataSources';
import { DEFAULT_INFOGRAPHIC_CONFIG, type Annotation, type DataRow, type InfographicConfig } from './infographic';
import { DEFAULT_VIDEO_SPEC, type VideoSpec } from './videoTimeline';
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
