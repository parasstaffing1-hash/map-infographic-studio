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
  /**
   * Per-aspect geometry. A layout authored for 16:9 rarely survives 9:16, so a
   * composition may ship a replacement block list for any aspect. Always read
   * geometry through `blocksForAspect` rather than touching `blocks` directly.
   */
  aspectOverrides?: Partial<Record<CanvasAspect, CompositionBlock[]>>;
  /** Config defaults the layout wants. Never includes user copy or data. */
  configPatch?: Partial<InfographicConfig>;
};

const chart = (kind: ChartKind, patch: Partial<ChartSpec> = {}): Partial<ChartSpec> => ({ ...DEFAULT_CHART_SPEC, kind, ...patch });

const round2 = (value: number) => Math.round(value * 100) / 100;

type StackItem = { id: string; type: BlockType; weight: number; chart?: Partial<ChartSpec>; text?: string };

/**
 * Builds a full-width vertical stack. Starts are rounded first and every height
 * is derived from the rounded neighbours, so blocks can never overlap through
 * a rounding error and the last block ends exactly on `bottom`.
 */
function stack(items: StackItem[], options: { top?: number; bottom?: number; gap?: number } = {}): CompositionBlock[] {
  const top = options.top ?? 0;
  const bottom = options.bottom ?? 100;
  const gap = options.gap ?? 1;
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  const available = bottom - top - gap * (items.length - 1);
  const starts: number[] = [];
  let cursor = top;
  for (const item of items) {
    starts.push(round2(cursor));
    cursor += (available * item.weight) / total + gap;
  }
  return items.map((item, index) => {
    const start = starts[index];
    const end = index === items.length - 1 ? bottom : starts[index + 1] - gap;
    return { id: item.id, type: item.type, x: 0, y: start, width: 100, height: round2(end - start), chart: item.chart, text: item.text };
  });
}

/** Two full-height columns for a landscape rendition of a portrait-first layout. */
function split(
  left: { id: string; type: BlockType; chart?: Partial<ChartSpec>; text?: string; width?: number },
  right: { id: string; type: BlockType; chart?: Partial<ChartSpec>; text?: string },
  options: { top?: number; bottom?: number } = {},
): CompositionBlock[] {
  const top = options.top ?? 15;
  const bottom = options.bottom ?? 92;
  const leftWidth = left.width ?? 56;
  return [
    { id: left.id, type: left.type, x: 0, y: top, width: leftWidth, height: round2(bottom - top), chart: left.chart, text: left.text },
    { id: right.id, type: right.type, x: leftWidth + 2, y: top, width: round2(98 - leftWidth), height: round2(bottom - top), chart: right.chart, text: right.text },
  ];
}

const headlineBlock = (height = 14): CompositionBlock => ({ id: 'headline', type: 'headline', x: 0, y: 0, width: 100, height });
const sourceBlock = (): CompositionBlock => ({ id: 'source', type: 'source', x: 0, y: 93, width: 100, height: 7 });

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
    aspectOverrides: {
      '1:1': stack([
        { id: 'headline', type: 'headline', weight: 15 },
        { id: 'map', type: 'map', weight: 40 },
        { id: 'ranked', type: 'chart', weight: 37, chart: chart('ranked-bar', { limit: 8 }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
      '4:5': stack([
        { id: 'headline', type: 'headline', weight: 14 },
        { id: 'map', type: 'map', weight: 38 },
        { id: 'ranked', type: 'chart', weight: 40, chart: chart('ranked-bar', { limit: 8 }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
      '9:16': stack([
        { id: 'headline', type: 'headline', weight: 14 },
        { id: 'map', type: 'map', weight: 36 },
        { id: 'ranked', type: 'chart', weight: 42, chart: chart('ranked-bar', { limit: 7 }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
    },
  },
  {
    id: 'world-gdp-race',
    label: 'World GDP race',
    detail: 'World map with all 15 economies ranked beside it',
    surface: 'canvas',
    aspect: '16:9',
    blocks: [
      { id: 'headline', type: 'headline', x: 0, y: 0, width: 100, height: 15 },
      { id: 'map', type: 'map', x: 0, y: 15, width: 56, height: 77 },
      { id: 'ranked', type: 'chart', x: 58, y: 15, width: 42, height: 77, chart: chart('ranked-bar', { limit: 15, showLegend: false }) },
      { id: 'source', type: 'source', x: 0, y: 93, width: 100, height: 7 },
    ],
    aspectOverrides: {
      '1:1': stack([
        { id: 'headline', type: 'headline', weight: 14 },
        { id: 'map', type: 'map', weight: 36 },
        { id: 'ranked', type: 'chart', weight: 42, chart: chart('ranked-bar', { limit: 10, showLegend: false }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
      '4:5': stack([
        { id: 'headline', type: 'headline', weight: 13 },
        { id: 'map', type: 'map', weight: 33 },
        { id: 'ranked', type: 'chart', weight: 46, chart: chart('ranked-bar', { limit: 12, showLegend: false }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
      '9:16': stack([
        { id: 'headline', type: 'headline', weight: 13 },
        { id: 'map', type: 'map', weight: 31 },
        { id: 'ranked', type: 'chart', weight: 48, chart: chart('ranked-bar', { limit: 12, showLegend: false }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
    },
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
    aspectOverrides: {
      '1:1': stack([
        { id: 'headline', type: 'headline', weight: 13 },
        { id: 'kpi', type: 'chart', weight: 17, chart: chart('kpi', { limit: 3, showLegend: false }) },
        { id: 'map', type: 'map', weight: 32 },
        { id: 'trend', type: 'chart', weight: 30, chart: chart('line', { limit: 5 }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
      '4:5': stack([
        { id: 'headline', type: 'headline', weight: 12 },
        { id: 'kpi', type: 'chart', weight: 16, chart: chart('kpi', { limit: 3, showLegend: false }) },
        { id: 'map', type: 'map', weight: 32 },
        { id: 'trend', type: 'chart', weight: 32, chart: chart('line', { limit: 5 }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
      '9:16': stack([
        { id: 'headline', type: 'headline', weight: 12 },
        { id: 'kpi', type: 'chart', weight: 17, chart: chart('kpi', { limit: 3, showLegend: false }) },
        { id: 'map', type: 'map', weight: 30 },
        { id: 'trend', type: 'chart', weight: 33, chart: chart('line', { limit: 4 }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
    },
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
    aspectOverrides: {
      '16:9': [
        headlineBlock(14),
        ...split({ id: 'map', type: 'map', width: 56 }, { id: 'ranked', type: 'chart', chart: chart('bar-horizontal', { limit: 8 }) }),
        sourceBlock(),
      ],
      '9:16': stack([
        { id: 'headline', type: 'headline', weight: 14 },
        { id: 'map', type: 'map', weight: 40 },
        { id: 'ranked', type: 'chart', weight: 38, chart: chart('bar-horizontal', { limit: 7 }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
    },
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
    aspectOverrides: {
      '16:9': [
        headlineBlock(14),
        ...split({ id: 'map', type: 'map', width: 55 }, { id: 'ranked', type: 'chart', chart: chart('ranked-bar', { limit: 9 }) }),
        sourceBlock(),
      ],
      '1:1': stack([
        { id: 'headline', type: 'headline', weight: 15 },
        { id: 'map', type: 'map', weight: 41 },
        { id: 'ranked', type: 'chart', weight: 36, chart: chart('ranked-bar', { limit: 6 }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
      '4:5': stack([
        { id: 'headline', type: 'headline', weight: 14 },
        { id: 'map', type: 'map', weight: 40 },
        { id: 'ranked', type: 'chart', weight: 38, chart: chart('ranked-bar', { limit: 6 }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
    },
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
    aspectOverrides: {
      '1:1': stack([
        { id: 'headline', type: 'headline', weight: 13 },
        { id: 'kpi', type: 'chart', weight: 17, chart: chart('kpi', { limit: 3, showLegend: false }) },
        { id: 'ranked', type: 'chart', weight: 32, chart: chart('ranked-bar', { limit: 7 }) },
        { id: 'share', type: 'chart', weight: 30, chart: chart('donut', { limit: 6 }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
      '4:5': stack([
        { id: 'headline', type: 'headline', weight: 12 },
        { id: 'kpi', type: 'chart', weight: 16, chart: chart('kpi', { limit: 3, showLegend: false }) },
        { id: 'ranked', type: 'chart', weight: 34, chart: chart('ranked-bar', { limit: 8 }) },
        { id: 'share', type: 'chart', weight: 30, chart: chart('donut', { limit: 6 }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
      '9:16': stack([
        { id: 'headline', type: 'headline', weight: 12 },
        { id: 'kpi', type: 'chart', weight: 18, chart: chart('kpi', { limit: 3, showLegend: false }) },
        { id: 'ranked', type: 'chart', weight: 34, chart: chart('ranked-bar', { limit: 8 }) },
        { id: 'share', type: 'chart', weight: 28, chart: chart('donut', { limit: 5 }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
    },
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
    aspectOverrides: {
      '16:9': [
        headlineBlock(12),
        ...split({ id: 'map', type: 'map', width: 48 }, { id: 'table', type: 'chart', chart: chart('table', { limit: 12, showLegend: false }) }, { top: 13, bottom: 92 }),
        sourceBlock(),
      ],
      '1:1': stack([
        { id: 'headline', type: 'headline', weight: 13 },
        { id: 'map', type: 'map', weight: 36 },
        { id: 'table', type: 'chart', weight: 43, chart: chart('table', { limit: 10, showLegend: false }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
      '4:5': stack([
        { id: 'headline', type: 'headline', weight: 12 },
        { id: 'map', type: 'map', weight: 34 },
        { id: 'table', type: 'chart', weight: 46, chart: chart('table', { limit: 12, showLegend: false }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
      '9:16': stack([
        { id: 'headline', type: 'headline', weight: 12 },
        { id: 'map', type: 'map', weight: 30 },
        { id: 'table', type: 'chart', weight: 50, chart: chart('table', { limit: 14, showLegend: false }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
    },
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
    aspectOverrides: {
      '1:1': stack([
        { id: 'headline', type: 'headline', weight: 13 },
        { id: 'map', type: 'map', weight: 36 },
        { id: 'seats', type: 'chart', weight: 23, chart: chart('bar-horizontal', { limit: 6 }) },
        { id: 'share', type: 'chart', weight: 20, chart: chart('donut', { limit: 5 }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
      '4:5': stack([
        { id: 'headline', type: 'headline', weight: 12 },
        { id: 'map', type: 'map', weight: 33 },
        { id: 'seats', type: 'chart', weight: 25, chart: chart('bar-horizontal', { limit: 6 }) },
        { id: 'share', type: 'chart', weight: 22, chart: chart('donut', { limit: 5 }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
      '9:16': stack([
        { id: 'headline', type: 'headline', weight: 12 },
        { id: 'map', type: 'map', weight: 30 },
        { id: 'seats', type: 'chart', weight: 27, chart: chart('bar-horizontal', { limit: 6 }) },
        { id: 'share', type: 'chart', weight: 23, chart: chart('donut', { limit: 5 }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
    },
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
    aspectOverrides: {
      '16:9': [
        headlineBlock(14),
        ...split({ id: 'map', type: 'map', width: 52 }, { id: 'icons', type: 'chart', chart: chart('pictogram', { limit: 6, showLegend: false }) }),
        sourceBlock(),
      ],
      '4:5': stack([
        { id: 'headline', type: 'headline', weight: 15 },
        { id: 'map', type: 'map', weight: 39 },
        { id: 'icons', type: 'chart', weight: 38, chart: chart('pictogram', { limit: 6, showLegend: false }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
      '9:16': stack([
        { id: 'headline', type: 'headline', weight: 14 },
        { id: 'map', type: 'map', weight: 36 },
        { id: 'icons', type: 'chart', weight: 42, chart: chart('pictogram', { limit: 7, showLegend: false }) },
        { id: 'source', type: 'source', weight: 8 },
      ]),
    },
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
    aspectOverrides: {
      '1:1': stack([
        { id: 'headline', type: 'headline', weight: 13 },
        { id: 'scatter', type: 'chart', weight: 40, chart: chart('scatter', { limit: 40 }) },
        { id: 'map', type: 'map', weight: 39, },
        { id: 'source', type: 'source', weight: 8 },
      ]),
      '4:5': stack([
        { id: 'headline', type: 'headline', weight: 12 },
        { id: 'scatter', type: 'chart', weight: 42, chart: chart('scatter', { limit: 40 }) },
        { id: 'map', type: 'map', weight: 38 },
        { id: 'source', type: 'source', weight: 8 },
      ]),
      '9:16': stack([
        { id: 'headline', type: 'headline', weight: 12 },
        { id: 'scatter', type: 'chart', weight: 43, chart: chart('scatter', { limit: 30 }) },
        { id: 'map', type: 'map', weight: 37 },
        { id: 'source', type: 'source', weight: 8 },
      ]),
    },
  },
];

export const DEFAULT_COMPOSITION_ID = 'map-only';

export function compositionById(id: string | undefined): Composition {
  return COMPOSITIONS.find((composition) => composition.id === id) ?? COMPOSITIONS[0];
}

/**
 * The geometry a composition should use on a given canvas aspect.
 *
 * IMPORTANT: every consumer that lays a composition out — the browser canvas,
 * `exportComposition`, the server video renderer — must read blocks through
 * this helper. Reading `composition.blocks` directly silently ignores the
 * portrait/square overrides and reproduces the 16:9-only layout bugs.
 */
export function blocksForAspect(composition: Composition, aspect: CanvasAspect = composition.aspect): CompositionBlock[] {
  return composition.aspectOverrides?.[aspect] ?? composition.blocks;
}

/** The map block for an aspect, if the composition has one. */
export function mapBlockForAspect(composition: Composition, aspect?: CanvasAspect): CompositionBlock | undefined {
  return blocksForAspect(composition, aspect).find((block) => block.type === 'map');
}

export function compositionHasMap(composition: Composition, aspect?: CanvasAspect) {
  return blocksForAspect(composition, aspect).some((block) => block.type === 'map');
}

export function chartBlocks(composition: Composition, aspect?: CanvasAspect) {
  return blocksForAspect(composition, aspect).filter((block) => block.type === 'chart');
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
