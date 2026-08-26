import { DEFAULT_CHART_SPEC, type ChartKind, type ChartSpec } from './charts';
import type { CanvasAspect, InfographicConfig } from './infographic';

export type BlockType = 'map' | 'chart' | 'headline' | 'source' | 'note' | 'kpi';

/** A block is placed in percentage units so one composition serves every aspect ratio. */
export type CompositionBlock = {
  id: string;
  type: BlockType;
  x: number;
  y: number;
  width: number;
  height: number;
  chart?: Partial<ChartSpec>;
  text?: string;
};

export type CompositionSurface = 'canvas' | 'social' | 'story' | 'presentation' | 'report';

export type Composition = {
  id: string;
  label: string;
  detail: string;
  surface: CompositionSurface;
  aspect: CanvasAspect;
  blocks: CompositionBlock[];
  /** Config defaults the layout wants. Never includes user copy or data. */
  configPatch?: Partial<InfographicConfig>;
};

const chart = (kind: ChartKind, patch: Partial<ChartSpec> = {}): Partial<ChartSpec> => ({ ...DEFAULT_CHART_SPEC, kind, ...patch });

/**
 * Layout presets. Each one only describes geometry and chart intent, so applying
 * a different composition never touches the imported dataset.
 */
export const COMPOSITIONS: Composition[] = [
  {
    id: 'map-only',
    label: 'Full-bleed map',
    detail: 'The classic choropleth with title, legend and source',
    surface: 'canvas',
    aspect: '16:9',
    blocks: [{ id: 'map', type: 'map', x: 0, y: 0, width: 100, height: 100 }],
  },
  {
    id: 'map-ranked',
    label: 'Map + ranked bars',
    detail: 'Statistical story layout: map left, league table right',
    surface: 'canvas',
    aspect: '16:9',
    blocks: [
      { id: 'headline', type: 'headline', x: 0, y: 0, width: 100, height: 15 },
      { id: 'map', type: 'map', x: 0, y: 15, width: 58, height: 77 },
      { id: 'ranked', type: 'chart', x: 59, y: 15, width: 41, height: 77, chart: chart('ranked-bar', { limit: 10 }) },
      { id: 'source', type: 'source', x: 0, y: 93, width: 100, height: 7 },
    ],
  },
  {
    id: 'map-kpi-trend',
    label: 'Map + KPIs + trend',
    detail: 'Dashboard composition for economy and population stories',
    surface: 'canvas',
    aspect: '16:9',
    blocks: [
      { id: 'headline', type: 'headline', x: 0, y: 0, width: 100, height: 14 },
      { id: 'kpi', type: 'chart', x: 0, y: 15, width: 100, height: 22, chart: chart('kpi', { limit: 3, showLegend: false }) },
      { id: 'map', type: 'map', x: 0, y: 39, width: 56, height: 53 },
      { id: 'trend', type: 'chart', x: 58, y: 39, width: 42, height: 53, chart: chart('line', { limit: 5 }) },
      { id: 'source', type: 'source', x: 0, y: 93, width: 100, height: 7 },
    ],
  },
  {
    id: 'editorial-portrait',
    label: 'Editorial portrait',
    detail: 'Tall map story for feeds, with a ranked strip beneath',
    surface: 'social',
    aspect: '4:5',
    blocks: [
      { id: 'headline', type: 'headline', x: 0, y: 0, width: 100, height: 14 },
      { id: 'map', type: 'map', x: 0, y: 14, width: 100, height: 52 },
      { id: 'ranked', type: 'chart', x: 0, y: 67, width: 100, height: 26, chart: chart('bar-horizontal', { limit: 6 }) },
      { id: 'source', type: 'source', x: 0, y: 94, width: 100, height: 6 },
    ],
  },
  {
    id: 'story-vertical',
    label: 'Vertical story',
    detail: '1080×1920 layout for stories and reels',
    surface: 'story',
    aspect: '9:16',
    blocks: [
      { id: 'headline', type: 'headline', x: 0, y: 2, width: 100, height: 15 },
      { id: 'map', type: 'map', x: 0, y: 18, width: 100, height: 44 },
      { id: 'ranked', type: 'chart', x: 0, y: 63, width: 100, height: 29, chart: chart('ranked-bar', { limit: 6 }) },
      { id: 'source', type: 'source', x: 0, y: 93, width: 100, height: 7 },
    ],
  },
  {
    id: 'chart-dashboard',
    label: 'Chart dashboard',
    detail: 'Four charts, no map — for pure statistical stories',
    surface: 'presentation',
    aspect: '16:9',
    blocks: [
      { id: 'headline', type: 'headline', x: 0, y: 0, width: 100, height: 14 },
      { id: 'kpi', type: 'chart', x: 0, y: 15, width: 100, height: 20, chart: chart('kpi', { limit: 3, showLegend: false }) },
      { id: 'ranked', type: 'chart', x: 0, y: 37, width: 49, height: 55, chart: chart('ranked-bar', { limit: 8 }) },
      { id: 'share', type: 'chart', x: 51, y: 37, width: 49, height: 55, chart: chart('donut', { limit: 6 }) },
      { id: 'source', type: 'source', x: 0, y: 93, width: 100, height: 7 },
    ],
  },
  {
    id: 'comparison-table',
    label: 'Comparison report',
    detail: 'Map with a full comparison table for reports and briefs',
    surface: 'report',
    aspect: 'a4',
    blocks: [
      { id: 'headline', type: 'headline', x: 0, y: 0, width: 100, height: 11 },
      { id: 'map', type: 'map', x: 0, y: 12, width: 100, height: 38 },
      { id: 'table', type: 'chart', x: 0, y: 52, width: 100, height: 40, chart: chart('table', { limit: 15, showLegend: false }) },
      { id: 'source', type: 'source', x: 0, y: 93, width: 100, height: 7 },
    ],
  },
  {
    id: 'election-result',
    label: 'Election result',
    detail: 'Winner map with seat counts and vote share',
    surface: 'canvas',
    aspect: '16:9',
    blocks: [
      { id: 'headline', type: 'headline', x: 0, y: 0, width: 100, height: 14 },
      { id: 'map', type: 'map', x: 0, y: 15, width: 62, height: 77 },
      { id: 'seats', type: 'chart', x: 64, y: 15, width: 36, height: 44, chart: chart('bar-horizontal', { limit: 6 }) },
      { id: 'share', type: 'chart', x: 64, y: 61, width: 36, height: 31, chart: chart('donut', { limit: 5 }) },
      { id: 'source', type: 'source', x: 0, y: 93, width: 100, height: 7 },
    ],
    configPatch: { scaleMode: 'categorical', labelMode: 'name' },
  },
  {
    id: 'pictogram-story',
    label: 'Pictogram story',
    detail: 'Counted icons with a supporting map',
    surface: 'social',
    aspect: '1:1',
    blocks: [
      { id: 'headline', type: 'headline', x: 0, y: 0, width: 100, height: 16 },
      { id: 'map', type: 'map', x: 0, y: 17, width: 100, height: 42 },
      { id: 'icons', type: 'chart', x: 0, y: 60, width: 100, height: 32, chart: chart('pictogram', { limit: 6, showLegend: false }) },
      { id: 'source', type: 'source', x: 0, y: 93, width: 100, height: 7 },
    ],
  },
  {
    id: 'scatter-context',
    label: 'Scatter + map',
    detail: 'Two numeric columns compared, with geography for context',
    surface: 'canvas',
    aspect: '16:9',
    blocks: [
      { id: 'headline', type: 'headline', x: 0, y: 0, width: 100, height: 14 },
      { id: 'scatter', type: 'chart', x: 0, y: 15, width: 55, height: 77, chart: chart('scatter', { limit: 40 }) },
      { id: 'map', type: 'map', x: 57, y: 15, width: 43, height: 77 },
      { id: 'source', type: 'source', x: 0, y: 93, width: 100, height: 7 },
    ],
  },
];

export const DEFAULT_COMPOSITION_ID = 'map-only';

export function compositionById(id: string | undefined): Composition {
  return COMPOSITIONS.find((composition) => composition.id === id) ?? COMPOSITIONS[0];
}

export function compositionHasMap(composition: Composition) {
  return composition.blocks.some((block) => block.type === 'map');
}

export function chartBlocks(composition: Composition) {
  return composition.blocks.filter((block) => block.type === 'chart');
}

/**
 * Resolves a block's chart spec against the user's per-block overrides.
 * Overrides survive composition switches so edits are not lost on a retheme.
 */
export function resolveChartSpec(block: CompositionBlock, overrides: Record<string, Partial<ChartSpec>> = {}): ChartSpec {
  return { ...DEFAULT_CHART_SPEC, ...block.chart, ...overrides[block.id] };
}

/** Pixel geometry for a block on a given canvas, used by the exporter and the video renderer. */
export function blockRect(block: CompositionBlock, width: number, height: number) {
  return {
    x: Math.round((block.x / 100) * width),
    y: Math.round((block.y / 100) * height),
    width: Math.round((block.width / 100) * width),
    height: Math.round((block.height / 100) * height),
  };
}

export function compositionsForSurface(surface: CompositionSurface | 'All') {
  return surface === 'All' ? COMPOSITIONS : COMPOSITIONS.filter((composition) => composition.surface === surface);
}
