import { formatDataValue, formatLegendNumber, paletteColors, parseNumericValue, type DataRow, type InfographicConfig, type LegendItem } from './infographic';

export type ChartKind =
  | 'bar-horizontal'
  | 'bar-vertical'
  | 'ranked-bar'
  | 'line'
  | 'area'
  | 'donut'
  | 'percentage'
  | 'kpi'
  | 'table'
  | 'timeline'
  | 'pictogram'
  | 'scatter'
  | 'bubble';

export type ChartSort = 'value-desc' | 'value-asc' | 'name' | 'source';

export type ChartAnnotation = {
  id: string;
  /** Region/label the annotation is attached to, or a year for time-series charts. */
  anchor: string;
  text: string;
  color?: string;
};

export type ChartSpec = {
  kind: ChartKind;
  title?: string;
  subtitle?: string;
  /** Column from `row.raw` used as the value. Falls back to the shared `row.value`. */
  valueField?: string;
  /** Column from `row.raw` used to split into series (line/area) or colour groups. */
  categoryField?: string;
  /** Column from `row.raw` supplying the second axis for scatter/bubble. */
  secondaryField?: string;
  /** Column from `row.raw` supplying the bubble radius. */
  sizeField?: string;
  limit: number;
  sort: ChartSort;
  showValues: boolean;
  showLegend: boolean;
  showGrid: boolean;
  /** Optional reference line drawn across the value axis. */
  target?: number;
  /** Units represented by a single pictogram icon. */
  pictogramUnit: number;
  annotations: ChartAnnotation[];
};

export const CHART_KINDS: Array<{ id: ChartKind; label: string; detail: string; needsYears?: boolean }> = [
  { id: 'bar-horizontal', label: 'Horizontal bars', detail: 'Compare regions with long names' },
  { id: 'bar-vertical', label: 'Vertical bars', detail: 'Compare a small set of categories' },
  { id: 'ranked-bar', label: 'Ranked bars', detail: 'Numbered league table with values' },
  { id: 'line', label: 'Line chart', detail: 'Trend over the year column', needsYears: true },
  { id: 'area', label: 'Area chart', detail: 'Magnitude of a trend over time', needsYears: true },
  { id: 'donut', label: 'Donut', detail: 'Share of a whole' },
  { id: 'percentage', label: 'Percentage bars', detail: 'Share of total per region' },
  { id: 'kpi', label: 'KPI cards', detail: 'Headline numbers with change' },
  { id: 'table', label: 'Comparison table', detail: 'Values, share and rank' },
  { id: 'timeline', label: 'Timeline', detail: 'Year-by-year milestones', needsYears: true },
  { id: 'pictogram', label: 'Pictogram', detail: 'Counted icons per region' },
  { id: 'scatter', label: 'Scatter', detail: 'Two numeric columns compared' },
  { id: 'bubble', label: 'Bubble', detail: 'Three numeric columns compared' },
];

export const DEFAULT_CHART_SPEC: ChartSpec = {
  kind: 'ranked-bar',
  limit: 10,
  sort: 'value-desc',
  showValues: true,
  showLegend: true,
  showGrid: true,
  pictogramUnit: 0,
  annotations: [],
};

export type ChartDatum = {
  key: string;
  label: string;
  sublabel?: string;
  value: number;
  formatted: string;
  color: string;
  category?: string;
  share: number;
  rank: number;
  secondary?: number;
  size?: number;
  /** Previous-period value when the dataset carries a year column. */
  previous?: number;
  change?: number;
};

export type ChartSeries = {
  key: string;
  label: string;
  color: string;
  points: Array<{ year: string; value: number; formatted: string }>;
};

export type ChartModel = {
  kind: ChartKind;
  data: ChartDatum[];
  series: ChartSeries[];
  years: string[];
  minimum: number;
  maximum: number;
  total: number;
  legend: LegendItem[];
  /** Rows that carried no usable number for this chart. */
  skippedRows: number;
  warnings: string[];
  empty: boolean;
};

export type ChartMark =
  | { kind: 'rect'; id: string; x: number; y: number; width: number; height: number; fill: string; opacity?: number; radius?: number; label?: string }
  | { kind: 'text'; id: string; x: number; y: number; text: string; size: number; weight: number; fill: string; anchor: 'start' | 'middle' | 'end'; opacity?: number }
  | { kind: 'path'; id: string; d: string; stroke?: string; fill?: string; width?: number; opacity?: number; dashed?: boolean }
  | { kind: 'circle'; id: string; cx: number; cy: number; r: number; fill: string; stroke?: string; opacity?: number }
  | { kind: 'line'; id: string; x1: number; y1: number; x2: number; y2: number; stroke: string; width?: number; dashed?: boolean; opacity?: number };

export type ChartHotspot = { id: string; x: number; y: number; width: number; height: number; label: string; value: string; detail?: string };

export type ChartLayout = {
  width: number;
  height: number;
  marks: ChartMark[];
  hotspots: ChartHotspot[];
  legend: LegendItem[];
  /** Short sentence describing the chart for screen readers. */
  description: string;
};

const AXIS_COLOR = '#8896ac';
const GRID_COLOR = '#dfe6ef';
const INK = '#1d2b40';

/** Builds the shared data model behind every chart type. Pure and side-effect free. */
export function buildChartModel(spec: ChartSpec, rows: DataRow[], config: InfographicConfig, activeYear?: string): ChartModel {
  const palette = paletteColors(config);
  const warnings: string[] = [];
  const years = sortedYears(rows);
  const timeSeriesKind = spec.kind === 'line' || spec.kind === 'area' || spec.kind === 'timeline';
  const scoped = timeSeriesKind || !activeYear ? rows : rows.filter((row) => !row.year || row.year === activeYear);

  const numeric = scoped
    .map((row) => ({ row, value: readNumber(row, spec.valueField) }))
    .filter((entry): entry is { row: DataRow; value: number } => entry.value !== null);
  const skippedRows = scoped.length - numeric.length;
  if (skippedRows > 0 && numeric.length > 0) warnings.push(`${skippedRows} row${skippedRows === 1 ? '' : 's'} skipped — no readable number`);

  if (timeSeriesKind) {
    const series = buildSeries(numeric, spec, config, palette, years);
    if (!series.length) warnings.push('Add a Year column to plot a trend');
    const allValues = series.flatMap((entry) => entry.points.map((point) => point.value));
    return {
      kind: spec.kind,
      data: [],
      series,
      years,
      minimum: allValues.length ? Math.min(...allValues) : 0,
      maximum: allValues.length ? Math.max(...allValues) : 0,
      total: allValues.reduce((sum, value) => sum + value, 0),
      legend: series.map((entry) => ({ color: entry.color, label: entry.label })),
      skippedRows,
      warnings,
      empty: !series.length,
    };
  }

  // Period-on-period change needs the unfiltered history, not just the active year.
  const history = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!row.year) continue;
    const value = readNumber(row, spec.valueField);
    if (value === null) continue;
    const key = row.region || 'Unknown';
    const byYear = history.get(key) ?? new Map<string, number>();
    byYear.set(row.year, value);
    history.set(key, byYear);
  }

  const grouped = new Map<string, { label: string; category?: string; values: number[]; secondary: number[]; size: number[] }>();
  for (const { row, value } of numeric) {
    const key = row.region || 'Unknown';
    const bucket = grouped.get(key) ?? { label: chartLabelForRow(row), category: readText(row, spec.categoryField), values: [], secondary: [], size: [] };
    bucket.values.push(value);
    const secondary = readNumber(row, spec.secondaryField);
    if (secondary !== null) bucket.secondary.push(secondary);
    const size = readNumber(row, spec.sizeField);
    if (size !== null) bucket.size.push(size);
    grouped.set(key, bucket);
  }

  const aggregated = [...grouped.entries()].map(([key, bucket]) => {
    const value = aggregate(bucket.values, config.aggregation);
    const byYear = history.get(key) ?? new Map<string, number>();
    const yearKeys = [...byYear.keys()].sort((first, second) => first.localeCompare(second, undefined, { numeric: true }));
    const currentYear = activeYear && byYear.has(activeYear) ? activeYear : yearKeys.at(-1);
    const previousYear = currentYear ? yearKeys[yearKeys.indexOf(currentYear) - 1] : undefined;
    const previous = previousYear ? byYear.get(previousYear) : undefined;
    return {
      key,
      label: bucket.label,
      category: bucket.category,
      value,
      previous,
      secondary: bucket.secondary.length ? aggregate(bucket.secondary, config.aggregation) : undefined,
      size: bucket.size.length ? aggregate(bucket.size, config.aggregation) : undefined,
    };
  });

  const sorted = sortData(aggregated, spec.sort);
  const limited = spec.limit > 0 ? sorted.slice(0, spec.limit) : sorted;
  const total = sorted.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const values = limited.map((item) => item.value);
  const categories = [...new Set(limited.map((item) => item.category).filter((value): value is string => Boolean(value)))];

  const data: ChartDatum[] = limited.map((item, index) => {
    const color = categories.length
      ? palette[(categories.indexOf(item.category ?? '') + 1) % palette.length]
      : rampColor(palette, limited.length === 1 ? 0.65 : 1 - index / Math.max(1, limited.length - 1));
    return {
      key: item.key,
      label: item.label,
      value: item.value,
      formatted: formatDataValue(item.value, config),
      color,
      category: item.category,
      share: total > 0 ? item.value / total : 0,
      rank: index + 1,
      secondary: item.secondary,
      size: item.size,
      previous: item.previous,
      change: item.previous !== undefined && item.previous !== 0 ? (item.value - item.previous) / Math.abs(item.previous) : undefined,
    };
  });

  const legend: LegendItem[] = categories.length
    ? categories.map((category, index) => ({ color: palette[(index + 1) % palette.length], label: category }))
    : data.slice(0, 8).map((datum) => ({ color: datum.color, label: datum.label }));

  if (!data.length) warnings.push('No numeric rows to chart yet');

  return {
    kind: spec.kind,
    data,
    series: [],
    years,
    minimum: values.length ? Math.min(...values, 0) : 0,
    maximum: values.length ? Math.max(...values) : 0,
    total,
    legend,
    skippedRows,
    warnings,
    empty: !data.length,
  };
}

/** Turns a chart model into absolute geometry so React and the server renderer stay in sync. */
export function layoutChart(model: ChartModel, spec: ChartSpec, config: InfographicConfig, width: number, height: number): ChartLayout {
  const base = { width, height, marks: [] as ChartMark[], hotspots: [] as ChartHotspot[], legend: spec.showLegend ? model.legend : [], description: describeChart(model, spec) };
  if (model.empty) {
    base.marks.push({ kind: 'text', id: 'empty', x: width / 2, y: height / 2, text: model.warnings[0] ?? 'No data yet', size: 15, weight: 500, fill: AXIS_COLOR, anchor: 'middle' });
    return base;
  }
  switch (model.kind) {
    case 'bar-horizontal':
    case 'ranked-bar':
    case 'percentage':
      return { ...base, ...horizontalBars(model, spec, config, width, height) };
    case 'bar-vertical':
      return { ...base, ...verticalBars(model, spec, config, width, height) };
    case 'line':
    case 'area':
      return { ...base, ...lineChart(model, spec, width, height) };
    case 'donut':
      return { ...base, ...donutChart(model, spec, config, width, height) };
    case 'kpi':
      return { ...base, ...kpiCards(model, width, height) };
    case 'table':
      return { ...base, ...comparisonTable(model, width, height) };
    case 'timeline':
      return { ...base, ...timelineChart(model, width, height) };
    case 'pictogram':
      return { ...base, ...pictogramChart(model, spec, config, width, height) };
    case 'scatter':
    case 'bubble':
      return { ...base, ...scatterChart(model, spec, config, width, height) };
    default:
      return base;
  }
}

function horizontalBars(model: ChartModel, spec: ChartSpec, config: InfographicConfig, width: number, height: number) {
  const marks: ChartMark[] = [];
  const hotspots: ChartHotspot[] = [];
  const ranked = model.kind === 'ranked-bar';
  const percentage = model.kind === 'percentage';
  const labelWidth = Math.min(Math.max(96, width * 0.26), width * 0.4);
  const left = labelWidth + (ranked ? 26 : 8);
  const right = spec.showValues ? Math.max(64, width * 0.12) : 12;
  const top = 12;
  const plotWidth = Math.max(24, width - left - right);
  const rowHeight = Math.max(18, (height - top - 16) / Math.max(1, model.data.length));
  const barHeight = Math.min(rowHeight * 0.62, 34);
  const scaleMax = percentage ? 1 : Math.max(model.maximum, spec.target ?? 0) || 1;
  const fontSize = clamp(rowHeight * 0.42, 10, 15);

  model.data.forEach((datum, index) => {
    const y = top + index * rowHeight + (rowHeight - barHeight) / 2;
    const magnitude = percentage ? datum.share : datum.value;
    const barWidth = Math.max(2, (Math.max(0, magnitude) / scaleMax) * plotWidth);
    if (ranked) {
      marks.push({ kind: 'text', id: `rank-${datum.key}`, x: 4, y: y + barHeight / 2 + fontSize * 0.35, text: String(datum.rank), size: fontSize, weight: 700, fill: AXIS_COLOR, anchor: 'start' });
    }
    marks.push({ kind: 'text', id: `label-${datum.key}`, x: labelWidth + (ranked ? 20 : 0), y: y + barHeight / 2 + fontSize * 0.35, text: truncate(datum.label, Math.floor(labelWidth / (fontSize * 0.55))), size: fontSize, weight: 600, fill: INK, anchor: 'end' });
    marks.push({ kind: 'rect', id: `track-${datum.key}`, x: left, y, width: plotWidth, height: barHeight, fill: GRID_COLOR, opacity: 0.45, radius: 3 });
    marks.push({ kind: 'rect', id: `bar-${datum.key}`, x: left, y, width: barWidth, height: barHeight, fill: datum.color, radius: 3, label: datum.label });
    if (spec.showValues) {
      const text = percentage ? `${(datum.share * 100).toFixed(config.decimals)}%` : datum.formatted;
      marks.push({ kind: 'text', id: `value-${datum.key}`, x: width - 8, y: y + barHeight / 2 + fontSize * 0.35, text, size: fontSize, weight: 700, fill: INK, anchor: 'end' });
    }
    hotspots.push({ id: datum.key, x: left, y, width: plotWidth, height: barHeight, label: datum.label, value: percentage ? `${(datum.share * 100).toFixed(1)}%` : datum.formatted, detail: datum.category });
    const annotation = spec.annotations.find((item) => item.anchor === datum.key || item.anchor === datum.label);
    if (annotation) marks.push({ kind: 'text', id: `note-${datum.key}`, x: left + barWidth + 8, y: y + barHeight / 2 + fontSize * 0.3, text: annotation.text, size: fontSize * 0.86, weight: 500, fill: annotation.color ?? AXIS_COLOR, anchor: 'start' });
  });

  if (spec.target !== undefined && !percentage) {
    const x = left + (spec.target / scaleMax) * plotWidth;
    marks.push({ kind: 'line', id: 'target', x1: x, y1: top - 4, x2: x, y2: height - 12, stroke: '#e2603f', width: 1.5, dashed: true });
    marks.push({ kind: 'text', id: 'target-label', x: x + 5, y: top + 8, text: `Target ${formatDataValue(spec.target, config)}`, size: 10, weight: 600, fill: '#e2603f', anchor: 'start' });
  }
  return { marks, hotspots };
}

function verticalBars(model: ChartModel, spec: ChartSpec, config: InfographicConfig, width: number, height: number) {
  const marks: ChartMark[] = [];
  const hotspots: ChartHotspot[] = [];
  const left = Math.max(44, width * 0.09);
  const bottom = Math.max(38, height * 0.16);
  const top = 16;
  const plotWidth = Math.max(24, width - left - 14);
  const plotHeight = Math.max(24, height - top - bottom);
  const scaleMax = Math.max(model.maximum, spec.target ?? 0) || 1;
  const slot = plotWidth / Math.max(1, model.data.length);
  const barWidth = Math.min(slot * 0.64, 72);
  const fontSize = clamp(slot * 0.24, 9, 13);

  if (spec.showGrid) {
    for (const tick of axisTicks(0, scaleMax, 4)) {
      const y = top + plotHeight - (tick / scaleMax) * plotHeight;
      marks.push({ kind: 'line', id: `grid-${tick}`, x1: left, y1: y, x2: left + plotWidth, y2: y, stroke: GRID_COLOR, width: 1 });
      marks.push({ kind: 'text', id: `tick-${tick}`, x: left - 8, y: y + 4, text: formatLegendNumber(tick), size: 10, weight: 500, fill: AXIS_COLOR, anchor: 'end' });
    }
  }

  model.data.forEach((datum, index) => {
    const barHeight = Math.max(2, (Math.max(0, datum.value) / scaleMax) * plotHeight);
    const x = left + index * slot + (slot - barWidth) / 2;
    const y = top + plotHeight - barHeight;
    marks.push({ kind: 'rect', id: `bar-${datum.key}`, x, y, width: barWidth, height: barHeight, fill: datum.color, radius: 3, label: datum.label });
    marks.push({ kind: 'text', id: `label-${datum.key}`, x: x + barWidth / 2, y: top + plotHeight + fontSize + 8, text: truncate(datum.label, Math.max(6, Math.floor(slot / (fontSize * 0.6)))), size: fontSize, weight: 600, fill: INK, anchor: 'middle' });
    if (spec.showValues) marks.push({ kind: 'text', id: `value-${datum.key}`, x: x + barWidth / 2, y: y - 6, text: datum.formatted, size: fontSize, weight: 700, fill: INK, anchor: 'middle' });
    hotspots.push({ id: datum.key, x, y, width: barWidth, height: barHeight, label: datum.label, value: datum.formatted, detail: datum.category });
  });

  marks.push({ kind: 'line', id: 'axis', x1: left, y1: top + plotHeight, x2: left + plotWidth, y2: top + plotHeight, stroke: AXIS_COLOR, width: 1 });
  if (spec.target !== undefined) {
    const y = top + plotHeight - (spec.target / scaleMax) * plotHeight;
    marks.push({ kind: 'line', id: 'target', x1: left, y1: y, x2: left + plotWidth, y2: y, stroke: '#e2603f', width: 1.5, dashed: true });
    marks.push({ kind: 'text', id: 'target-label', x: left + plotWidth, y: y - 5, text: `Target ${formatDataValue(spec.target, config)}`, size: 10, weight: 600, fill: '#e2603f', anchor: 'end' });
  }
  return { marks, hotspots };
}

function lineChart(model: ChartModel, spec: ChartSpec, width: number, height: number) {
  const marks: ChartMark[] = [];
  const hotspots: ChartHotspot[] = [];
  const left = Math.max(46, width * 0.1);
  const bottom = Math.max(34, height * 0.14);
  const top = 16;
  const plotWidth = Math.max(24, width - left - 16);
  const plotHeight = Math.max(24, height - top - bottom);
  const years = model.years.length ? model.years : [...new Set(model.series.flatMap((series) => series.points.map((point) => point.year)))].sort();
  const low = Math.min(0, model.minimum);
  const high = model.maximum || 1;
  const span = high - low || 1;
  const xFor = (year: string) => left + (years.length <= 1 ? plotWidth / 2 : (years.indexOf(year) / (years.length - 1)) * plotWidth);
  const yFor = (value: number) => top + plotHeight - ((value - low) / span) * plotHeight;

  if (spec.showGrid) {
    for (const tick of axisTicks(low, high, 4)) {
      const y = yFor(tick);
      marks.push({ kind: 'line', id: `grid-${tick}`, x1: left, y1: y, x2: left + plotWidth, y2: y, stroke: GRID_COLOR, width: 1 });
      marks.push({ kind: 'text', id: `tick-${tick}`, x: left - 8, y: y + 4, text: formatLegendNumber(tick), size: 10, weight: 500, fill: AXIS_COLOR, anchor: 'end' });
    }
  }

  const labelStep = Math.max(1, Math.ceil(years.length / Math.max(2, Math.floor(plotWidth / 58))));
  years.forEach((year, index) => {
    if (index % labelStep !== 0 && index !== years.length - 1) return;
    marks.push({ kind: 'text', id: `year-${year}`, x: xFor(year), y: top + plotHeight + 20, text: year, size: 10, weight: 600, fill: AXIS_COLOR, anchor: 'middle' });
  });

  for (const series of model.series) {
    const points = series.points.filter((point) => years.includes(point.year));
    if (!points.length) continue;
    const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${xFor(point.year).toFixed(2)} ${yFor(point.value).toFixed(2)}`).join(' ');
    if (model.kind === 'area') {
      const closed = `${path} L${xFor(points.at(-1)!.year).toFixed(2)} ${(top + plotHeight).toFixed(2)} L${xFor(points[0].year).toFixed(2)} ${(top + plotHeight).toFixed(2)} Z`;
      marks.push({ kind: 'path', id: `area-${series.key}`, d: closed, fill: series.color, opacity: 0.24 });
    }
    marks.push({ kind: 'path', id: `line-${series.key}`, d: path, stroke: series.color, width: 2.4, fill: 'none' });
    for (const point of points) {
      marks.push({ kind: 'circle', id: `point-${series.key}-${point.year}`, cx: xFor(point.year), cy: yFor(point.value), r: 3.2, fill: series.color });
      hotspots.push({ id: `${series.key}-${point.year}`, x: xFor(point.year) - 10, y: yFor(point.value) - 10, width: 20, height: 20, label: `${series.label} · ${point.year}`, value: point.formatted });
    }
    const last = points.at(-1)!;
    if (spec.showValues) marks.push({ kind: 'text', id: `end-${series.key}`, x: Math.min(xFor(last.year) + 6, width - 4), y: yFor(last.value) + 4, text: truncate(series.label, 14), size: 11, weight: 700, fill: series.color, anchor: 'end' });
  }

  for (const annotation of spec.annotations) {
    if (!years.includes(annotation.anchor)) continue;
    const x = xFor(annotation.anchor);
    marks.push({ kind: 'line', id: `note-line-${annotation.id}`, x1: x, y1: top, x2: x, y2: top + plotHeight, stroke: annotation.color ?? '#e2603f', width: 1.2, dashed: true, opacity: 0.8 });
    marks.push({ kind: 'text', id: `note-${annotation.id}`, x: x + 5, y: top + 12, text: annotation.text, size: 10, weight: 600, fill: annotation.color ?? '#e2603f', anchor: 'start' });
  }

  marks.push({ kind: 'line', id: 'axis', x1: left, y1: top + plotHeight, x2: left + plotWidth, y2: top + plotHeight, stroke: AXIS_COLOR, width: 1 });
  return { marks, hotspots };
}

function donutChart(model: ChartModel, spec: ChartSpec, config: InfographicConfig, width: number, height: number) {
  const marks: ChartMark[] = [];
  const hotspots: ChartHotspot[] = [];
  const centerX = width * (spec.showLegend ? 0.34 : 0.5);
  const centerY = height / 2;
  const outer = Math.min(width * (spec.showLegend ? 0.3 : 0.42), height * 0.42);
  const inner = outer * 0.58;
  const total = model.data.reduce((sum, datum) => sum + Math.max(0, datum.value), 0) || 1;
  let angle = -Math.PI / 2;

  for (const datum of model.data) {
    const sweep = (Math.max(0, datum.value) / total) * Math.PI * 2;
    if (sweep <= 0) continue;
    marks.push({ kind: 'path', id: `arc-${datum.key}`, d: donutSlice(centerX, centerY, inner, outer, angle, angle + sweep), fill: datum.color });
    const mid = angle + sweep / 2;
    if (spec.showValues && sweep > 0.32) {
      const radius = (inner + outer) / 2;
      marks.push({ kind: 'text', id: `slice-${datum.key}`, x: centerX + Math.cos(mid) * radius, y: centerY + Math.sin(mid) * radius + 4, text: `${Math.round((datum.value / total) * 100)}%`, size: 12, weight: 700, fill: '#ffffff', anchor: 'middle' });
    }
    hotspots.push({ id: datum.key, x: centerX + Math.cos(mid) * ((inner + outer) / 2) - 16, y: centerY + Math.sin(mid) * ((inner + outer) / 2) - 16, width: 32, height: 32, label: datum.label, value: `${datum.formatted} · ${Math.round((datum.value / total) * 100)}%` });
    angle += sweep;
  }

  marks.push({ kind: 'text', id: 'centre-value', x: centerX, y: centerY, text: formatDataValue(model.total, config), size: Math.max(16, outer * 0.3), weight: 700, fill: INK, anchor: 'middle' });
  marks.push({ kind: 'text', id: 'centre-label', x: centerX, y: centerY + outer * 0.28, text: 'Total', size: Math.max(10, outer * 0.14), weight: 500, fill: AXIS_COLOR, anchor: 'middle' });

  if (spec.showLegend) {
    const legendX = width * 0.66;
    const rowHeight = Math.min(26, (height - 24) / Math.max(1, model.data.length));
    model.data.forEach((datum, index) => {
      const y = 20 + index * rowHeight;
      marks.push({ kind: 'rect', id: `key-${datum.key}`, x: legendX, y: y - 9, width: 11, height: 11, fill: datum.color, radius: 2 });
      marks.push({ kind: 'text', id: `key-label-${datum.key}`, x: legendX + 18, y, text: truncate(datum.label, 20), size: 11, weight: 600, fill: INK, anchor: 'start' });
      marks.push({ kind: 'text', id: `key-value-${datum.key}`, x: width - 8, y, text: datum.formatted, size: 11, weight: 500, fill: AXIS_COLOR, anchor: 'end' });
    });
  }
  return { marks, hotspots };
}

function kpiCards(model: ChartModel, width: number, height: number) {
  const marks: ChartMark[] = [];
  const hotspots: ChartHotspot[] = [];
  const cards = model.data.slice(0, 6);
  const columns = Math.min(cards.length, width < 520 ? 2 : 3) || 1;
  const rows = Math.ceil(cards.length / columns);
  const gap = 12;
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const cardHeight = Math.min((height - gap * (rows - 1)) / rows, 150);

  cards.forEach((datum, index) => {
    const x = (index % columns) * (cardWidth + gap);
    const y = Math.floor(index / columns) * (cardHeight + gap);
    marks.push({ kind: 'rect', id: `card-${datum.key}`, x, y, width: cardWidth, height: cardHeight, fill: '#ffffff', radius: 10 });
    marks.push({ kind: 'rect', id: `accent-${datum.key}`, x, y, width: 4, height: cardHeight, fill: datum.color, radius: 2 });
    // Scale type to the smaller of the card's two dimensions so a short, wide
    // KPI strip stays readable instead of overflowing its card.
    const labelSize = clamp(Math.min(cardWidth * 0.075, cardHeight * 0.17), 9, 12);
    const valueSize = clamp(Math.min(cardWidth * 0.16, cardHeight * 0.34), 14, 34);
    const footSize = clamp(Math.min(cardWidth * 0.07, cardHeight * 0.15), 8, 11);
    const padding = Math.max(9, Math.min(16, cardWidth * 0.06));
    marks.push({ kind: 'text', id: `card-label-${datum.key}`, x: x + padding, y: y + labelSize + padding * 0.7, text: truncate(datum.label, Math.floor(cardWidth / (labelSize * 0.62))), size: labelSize, weight: 600, fill: AXIS_COLOR, anchor: 'start' });
    marks.push({ kind: 'text', id: `card-value-${datum.key}`, x: x + padding, y: y + cardHeight * 0.66, text: datum.formatted, size: valueSize, weight: 700, fill: INK, anchor: 'start' });
    if (datum.change !== undefined) {
      const up = datum.change >= 0;
      marks.push({ kind: 'text', id: `card-change-${datum.key}`, x: x + padding, y: y + cardHeight - padding * 0.6, text: `${up ? '▲' : '▼'} ${(Math.abs(datum.change) * 100).toFixed(1)}% vs previous`, size: footSize, weight: 600, fill: up ? '#1d7a5b' : '#c2453c', anchor: 'start' });
    } else {
      marks.push({ kind: 'text', id: `card-share-${datum.key}`, x: x + padding, y: y + cardHeight - padding * 0.6, text: `${(datum.share * 100).toFixed(1)}% of total`, size: footSize, weight: 500, fill: AXIS_COLOR, anchor: 'start' });
    }
    hotspots.push({ id: datum.key, x, y, width: cardWidth, height: cardHeight, label: datum.label, value: datum.formatted });
  });
  return { marks, hotspots };
}

function comparisonTable(model: ChartModel, width: number, height: number) {
  const marks: ChartMark[] = [];
  const hotspots: ChartHotspot[] = [];
  const headerHeight = 30;
  const rowHeight = Math.max(22, Math.min(34, (height - headerHeight) / Math.max(1, model.data.length)));
  const columns = [
    { label: 'Rank', x: 8, anchor: 'start' as const },
    { label: 'Region', x: 56, anchor: 'start' as const },
    { label: 'Value', x: width * 0.72, anchor: 'end' as const },
    { label: 'Share', x: width - 8, anchor: 'end' as const },
  ];

  marks.push({ kind: 'rect', id: 'header', x: 0, y: 0, width, height: headerHeight, fill: '#eef2f7' });
  for (const column of columns) marks.push({ kind: 'text', id: `head-${column.label}`, x: column.x, y: headerHeight - 10, text: column.label, size: 11, weight: 700, fill: AXIS_COLOR, anchor: column.anchor });

  model.data.forEach((datum, index) => {
    const y = headerHeight + index * rowHeight;
    if (index % 2 === 1) marks.push({ kind: 'rect', id: `stripe-${datum.key}`, x: 0, y, width, height: rowHeight, fill: '#f6f8fb' });
    const textY = y + rowHeight / 2 + 4;
    marks.push({ kind: 'rect', id: `swatch-${datum.key}`, x: 40, y: y + rowHeight / 2 - 4, width: 8, height: 8, fill: datum.color, radius: 2 });
    marks.push({ kind: 'text', id: `rank-${datum.key}`, x: 8, y: textY, text: String(datum.rank), size: 11, weight: 700, fill: AXIS_COLOR, anchor: 'start' });
    marks.push({ kind: 'text', id: `region-${datum.key}`, x: 56, y: textY, text: truncate(datum.label, Math.floor(width / 14)), size: 12, weight: 600, fill: INK, anchor: 'start' });
    marks.push({ kind: 'text', id: `value-${datum.key}`, x: width * 0.72, y: textY, text: datum.formatted, size: 12, weight: 700, fill: INK, anchor: 'end' });
    marks.push({ kind: 'text', id: `share-${datum.key}`, x: width - 8, y: textY, text: `${(datum.share * 100).toFixed(1)}%`, size: 11, weight: 500, fill: AXIS_COLOR, anchor: 'end' });
    hotspots.push({ id: datum.key, x: 0, y, width, height: rowHeight, label: datum.label, value: datum.formatted, detail: `Rank ${datum.rank}` });
  });
  return { marks, hotspots };
}

function timelineChart(model: ChartModel, width: number, height: number) {
  const marks: ChartMark[] = [];
  const hotspots: ChartHotspot[] = [];
  const series = model.series[0];
  const points = series?.points ?? [];
  if (!points.length) return { marks, hotspots };
  const left = 28;
  const plotWidth = Math.max(20, width - left - 28);
  const axisY = height * 0.56;
  const xFor = (index: number) => left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);

  marks.push({ kind: 'line', id: 'spine', x1: left, y1: axisY, x2: left + plotWidth, y2: axisY, stroke: GRID_COLOR, width: 3 });
  points.forEach((point, index) => {
    const x = xFor(index);
    const above = index % 2 === 0;
    const color = series?.color ?? INK;
    marks.push({ kind: 'circle', id: `dot-${point.year}`, cx: x, cy: axisY, r: 6, fill: color, stroke: '#ffffff' });
    marks.push({ kind: 'line', id: `stem-${point.year}`, x1: x, y1: axisY, x2: x, y2: above ? axisY - 34 : axisY + 34, stroke: color, width: 1.4, opacity: 0.55 });
    marks.push({ kind: 'text', id: `year-${point.year}`, x, y: above ? axisY - 42 : axisY + 52, text: point.year, size: 12, weight: 700, fill: INK, anchor: 'middle' });
    marks.push({ kind: 'text', id: `value-${point.year}`, x, y: above ? axisY - 26 : axisY + 68, text: point.formatted, size: 11, weight: 500, fill: AXIS_COLOR, anchor: 'middle' });
    hotspots.push({ id: point.year, x: x - 14, y: axisY - 14, width: 28, height: 28, label: point.year, value: point.formatted });
  });
  return { marks, hotspots };
}

function pictogramChart(model: ChartModel, spec: ChartSpec, config: InfographicConfig, width: number, height: number) {
  const marks: ChartMark[] = [];
  const hotspots: ChartHotspot[] = [];
  const rows = model.data.slice(0, 8);
  const unit = spec.pictogramUnit > 0 ? spec.pictogramUnit : niceUnit(model.maximum);
  const labelWidth = Math.min(Math.max(88, width * 0.24), width * 0.36);
  const rowHeight = Math.max(24, (height - 26) / Math.max(1, rows.length));
  const iconSize = Math.min(rowHeight * 0.5, 17);
  const maxIcons = Math.max(1, Math.floor((width - labelWidth - 74) / (iconSize + 5)));

  marks.push({ kind: 'text', id: 'unit', x: width - 4, y: 12, text: `1 icon = ${formatDataValue(unit, config)}`, size: 10, weight: 600, fill: AXIS_COLOR, anchor: 'end' });
  rows.forEach((datum, index) => {
    const y = 26 + index * rowHeight;
    const wanted = Math.max(0, Math.round(datum.value / unit));
    const drawn = Math.min(wanted, maxIcons);
    marks.push({ kind: 'text', id: `label-${datum.key}`, x: labelWidth - 10, y: y + iconSize, text: truncate(datum.label, Math.floor(labelWidth / 7)), size: clamp(rowHeight * 0.34, 10, 13), weight: 600, fill: INK, anchor: 'end' });
    for (let icon = 0; icon < drawn; icon += 1) {
      marks.push({ kind: 'circle', id: `icon-${datum.key}-${icon}`, cx: labelWidth + 6 + icon * (iconSize + 5) + iconSize / 2, cy: y + iconSize * 0.7, r: iconSize / 2, fill: datum.color });
    }
    if (wanted > drawn) marks.push({ kind: 'text', id: `more-${datum.key}`, x: labelWidth + 10 + drawn * (iconSize + 5), y: y + iconSize, text: `+${wanted - drawn}`, size: 10, weight: 600, fill: AXIS_COLOR, anchor: 'start' });
    if (spec.showValues) marks.push({ kind: 'text', id: `value-${datum.key}`, x: width - 4, y: y + iconSize, text: datum.formatted, size: 10, weight: 700, fill: INK, anchor: 'end' });
    hotspots.push({ id: datum.key, x: labelWidth, y, width: width - labelWidth, height: rowHeight, label: datum.label, value: datum.formatted, detail: `${wanted} icons` });
  });
  return { marks, hotspots };
}

function scatterChart(model: ChartModel, spec: ChartSpec, config: InfographicConfig, width: number, height: number) {
  const marks: ChartMark[] = [];
  const hotspots: ChartHotspot[] = [];
  const left = Math.max(46, width * 0.1);
  const bottom = Math.max(36, height * 0.15);
  const top = 16;
  const plotWidth = Math.max(24, width - left - 18);
  const plotHeight = Math.max(24, height - top - bottom);
  const usable = model.data.filter((datum) => datum.secondary !== undefined);
  const points = usable.length ? usable : model.data;
  const xValues = points.map((datum) => datum.secondary ?? datum.rank);
  const yValues = points.map((datum) => datum.value);
  const xLow = Math.min(...xValues, 0);
  const xHigh = Math.max(...xValues) || 1;
  const yLow = Math.min(...yValues, 0);
  const yHigh = Math.max(...yValues) || 1;
  const sizes = points.map((datum) => datum.size ?? datum.value);
  const sizeHigh = Math.max(...sizes) || 1;

  if (spec.showGrid) {
    for (const tick of axisTicks(yLow, yHigh, 4)) {
      const y = top + plotHeight - ((tick - yLow) / (yHigh - yLow || 1)) * plotHeight;
      marks.push({ kind: 'line', id: `grid-y-${tick}`, x1: left, y1: y, x2: left + plotWidth, y2: y, stroke: GRID_COLOR, width: 1 });
      marks.push({ kind: 'text', id: `tick-y-${tick}`, x: left - 8, y: y + 4, text: formatLegendNumber(tick), size: 10, weight: 500, fill: AXIS_COLOR, anchor: 'end' });
    }
    for (const tick of axisTicks(xLow, xHigh, 4)) {
      const x = left + ((tick - xLow) / (xHigh - xLow || 1)) * plotWidth;
      marks.push({ kind: 'text', id: `tick-x-${tick}`, x, y: top + plotHeight + 18, text: formatLegendNumber(tick), size: 10, weight: 500, fill: AXIS_COLOR, anchor: 'middle' });
    }
  }

  // Bubbles are sized from the data, so cap the radius to what still fits the plot.
  const maxRadius = model.kind === 'bubble' ? clamp(Math.min(plotWidth, plotHeight) * 0.16, 6, 30) : 5.5;
  points.forEach((datum) => {
    const rawX = datum.secondary ?? datum.rank;
    const radius = model.kind === 'bubble' ? clamp(Math.sqrt((datum.size ?? datum.value) / sizeHigh) * maxRadius, 4, maxRadius) : 5.5;
    const x = clamp(left + ((rawX - xLow) / (xHigh - xLow || 1)) * plotWidth, left + radius, width - radius - 1);
    const y = clamp(top + plotHeight - ((datum.value - yLow) / (yHigh - yLow || 1)) * plotHeight, top + radius, height - bottom + radius);
    marks.push({ kind: 'circle', id: `dot-${datum.key}`, cx: x, cy: y, r: radius, fill: datum.color, opacity: 0.82, stroke: '#ffffff' });
    if (spec.showValues && points.length <= 14) marks.push({ kind: 'text', id: `label-${datum.key}`, x, y: y - radius - 5, text: truncate(datum.label, 14), size: 10, weight: 600, fill: INK, anchor: 'middle' });
    hotspots.push({ id: datum.key, x: x - radius, y: y - radius, width: radius * 2, height: radius * 2, label: datum.label, value: `${formatDataValue(datum.value, config)}${datum.secondary !== undefined ? ` · ${formatDataValue(datum.secondary, config)}` : ''}` });
  });

  marks.push({ kind: 'line', id: 'axis-x', x1: left, y1: top + plotHeight, x2: left + plotWidth, y2: top + plotHeight, stroke: AXIS_COLOR, width: 1 });
  marks.push({ kind: 'line', id: 'axis-y', x1: left, y1: top, x2: left, y2: top + plotHeight, stroke: AXIS_COLOR, width: 1 });
  if (spec.secondaryField) marks.push({ kind: 'text', id: 'axis-x-label', x: left + plotWidth / 2, y: height - 6, text: spec.secondaryField, size: 10, weight: 600, fill: AXIS_COLOR, anchor: 'middle' });
  return { marks, hotspots };
}

function buildSeries(numeric: Array<{ row: DataRow; value: number }>, spec: ChartSpec, config: InfographicConfig, palette: string[], years: string[]): ChartSeries[] {
  if (!years.length) return [];
  const seriesKey = (row: DataRow) => (spec.categoryField ? readText(row, spec.categoryField) ?? 'All' : row.region || 'All');
  const grouped = new Map<string, Map<string, number[]>>();
  for (const { row, value } of numeric) {
    if (!row.year) continue;
    const key = seriesKey(row);
    const byYear = grouped.get(key) ?? new Map<string, number[]>();
    byYear.set(row.year, [...(byYear.get(row.year) ?? []), value]);
    grouped.set(key, byYear);
  }
  const ordered = [...grouped.entries()]
    .map(([key, byYear]) => ({ key, total: [...byYear.values()].flat().reduce((sum, value) => sum + value, 0), byYear }))
    .sort((first, second) => second.total - first.total)
    .slice(0, Math.max(1, spec.limit || 6));

  return ordered.map((entry, index) => ({
    key: entry.key,
    label: entry.key,
    color: ordered.length === 1 ? palette[Math.floor(palette.length * 0.7)] : rampColor(palette, ordered.length === 1 ? 0.7 : 1 - index / Math.max(1, ordered.length - 1)),
    points: years
      .filter((year) => entry.byYear.has(year))
      .map((year) => {
        const value = aggregate(entry.byYear.get(year) ?? [], config.aggregation);
        return { year, value, formatted: formatDataValue(value, config) };
      }),
  }));
}

function describeChart(model: ChartModel, spec: ChartSpec) {
  const kindLabel = CHART_KINDS.find((entry) => entry.id === spec.kind)?.label ?? spec.kind;
  if (model.empty) return `${kindLabel}: no data available yet.`;
  if (model.series.length) {
    const span = model.years.length ? `${model.years[0]} to ${model.years.at(-1)}` : 'the available period';
    return `${kindLabel} showing ${model.series.length} series across ${span}.`;
  }
  const top = model.data[0];
  return `${kindLabel} of ${model.data.length} regions. ${top ? `${top.label} leads at ${top.formatted}.` : ''}`.trim();
}

function sortedYears(rows: DataRow[]) {
  return [...new Set(rows.map((row) => row.year).filter((year): year is string => Boolean(year)))]
    .sort((first, second) => first.localeCompare(second, undefined, { numeric: true }));
}

function sortData<T extends { label: string; value: number }>(items: T[], sort: ChartSort) {
  const copy = [...items];
  if (sort === 'value-desc') return copy.sort((first, second) => second.value - first.value);
  if (sort === 'value-asc') return copy.sort((first, second) => first.value - second.value);
  if (sort === 'name') return copy.sort((first, second) => first.label.localeCompare(second.label));
  return copy;
}

function aggregate(values: number[], mode: InfographicConfig['aggregation']) {
  if (!values.length) return 0;
  if (mode === 'sum') return values.reduce((sum, value) => sum + value, 0);
  if (mode === 'average') return values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.at(-1) ?? 0;
}

function readNumber(row: DataRow, field?: string) {
  if (field) {
    const raw = row.raw[field];
    if (raw === undefined || raw === null || raw === '') return null;
    return parseNumericValue(typeof raw === 'boolean' ? Number(raw) : raw);
  }
  return parseNumericValue(row.value);
}

function readText(row: DataRow, field?: string) {
  if (!field) return undefined;
  const raw = row.raw[field];
  return raw === undefined || raw === null || raw === '' ? undefined : String(raw);
}

function chartLabelForRow(row: DataRow) {
  const label = row.raw.chartLabel ?? row.raw.countryLabel;
  return label === undefined || label === null || label === '' ? row.region || 'Unknown' : String(label);
}

/** Lists the numeric and text columns a chart can be pointed at. */
export function chartFields(rows: DataRow[]) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row.raw)))];
  const numeric: string[] = [];
  const text: string[] = [];
  for (const header of headers) {
    const samples = rows.slice(0, 40).map((row) => row.raw[header]).filter((value) => value !== null && value !== undefined && value !== '');
    if (!samples.length) continue;
    const numbers = samples.filter((value) => parseNumericValue(value as string | number) !== null).length;
    if (numbers / samples.length >= 0.7) numeric.push(header);
    else text.push(header);
  }
  return { numeric, text, all: headers };
}

function rampColor(palette: string[], progress: number) {
  const clamped = clamp(progress, 0, 1);
  const index = Math.round(clamped * (palette.length - 1) * 0.8 + palette.length * 0.18);
  return palette[Math.min(palette.length - 1, Math.max(0, index))];
}

function axisTicks(low: number, high: number, count: number) {
  if (!Number.isFinite(low) || !Number.isFinite(high) || high === low) return [low || 0];
  const step = (high - low) / count;
  return Array.from({ length: count + 1 }, (_, index) => low + step * index);
}

function niceUnit(maximum: number) {
  if (maximum <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(maximum / 10 || 1));
  for (const multiplier of [1, 2, 5, 10]) {
    const candidate = magnitude * multiplier;
    if (maximum / candidate <= 12) return candidate;
  }
  return magnitude * 10;
}

function donutSlice(cx: number, cy: number, inner: number, outer: number, start: number, end: number) {
  const sweep = end - start >= Math.PI ? 1 : 0;
  const point = (radius: number, angle: number) => `${(cx + Math.cos(angle) * radius).toFixed(2)} ${(cy + Math.sin(angle) * radius).toFixed(2)}`;
  return `M${point(outer, start)} A${outer} ${outer} 0 ${sweep} 1 ${point(outer, end)} L${point(inner, end)} A${inner} ${inner} 0 ${sweep} 0 ${point(inner, start)} Z`;
}

function truncate(value: string, maxLength: number) {
  const limit = Math.max(4, maxLength);
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}
