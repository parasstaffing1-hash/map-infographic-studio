import readXlsxFile from 'read-excel-file/browser';
import type { GeoFeature } from './types';

export type DataRow = {
  id: string;
  region: string;
  value: string | number;
  year?: string;
  parent?: string;
  raw: Record<string, string | number | boolean | null>;
};

export type ScaleMode = 'continuous' | 'equal' | 'quantile' | 'categorical' | 'custom';
export type MissingMode = 'grey' | 'white' | 'hide';
export type NumberFormat = 'standard' | 'indian' | 'metric';
export type CanvasAspect = '16:9' | '1:1' | '4:5' | '9:16' | 'a4';

export type InfographicConfig = {
  title: string;
  subtitle: string;
  source: string;
  note: string;
  paletteId: string;
  customColors: string[];
  scaleMode: ScaleMode;
  classes: number;
  customBreaks: string;
  minimum?: number;
  maximum?: number;
  missingMode: MissingMode;
  missingColor: string;
  zeroMode: 'normal' | 'grey' | 'white' | 'hide';
  zeroColor: string;
  labelMode: 'name' | 'value' | 'both' | 'none';
  prefix: string;
  suffix: string;
  decimals: number;
  numberFormat: NumberFormat;
  showLegend: boolean;
  showTitle: boolean;
  showSource: boolean;
  background: string;
  aspect: CanvasAspect;
  resolution: 'hd' | '4k';
  aggregation: 'last' | 'sum' | 'average';
};

export type VisualDatum = {
  featureId: string;
  region: string;
  value?: number;
  category?: string;
  formattedValue?: string;
  color: string;
  opacity: number;
  hasData: boolean;
  rowIds: string[];
};

export type LegendItem = {
  color: string;
  label: string;
  minimum?: number;
  maximum?: number;
};

export type VisualizationResult = {
  byFeatureId: Record<string, VisualDatum>;
  legend: LegendItem[];
  matchedRows: number;
  unmatchedRows: DataRow[];
  ambiguousRows: DataRow[];
  totalRows: number;
  dataKind: 'numeric' | 'categorical' | 'empty';
  minimum?: number;
  maximum?: number;
};

export type Annotation = {
  id: string;
  type: 'text' | 'marker' | 'arrow';
  text: string;
  x: number;
  y: number;
  color: string;
  size: number;
};

export const PALETTES = [
  { id: 'ladakh', label: 'Ladakh', colors: ['#fff7d6', '#d8e5b5', '#84c69b', '#3c9d91', '#176b87', '#173f5f'] },
  { id: 'delhi', label: 'Delhi', colors: ['#fff1e6', '#f7c59f', '#ef8a62', '#d8574f', '#983c55', '#4b2840'] },
  { id: 'kolkata', label: 'Kolkata', colors: ['#f6f0ff', '#d8c7f2', '#ae91d8', '#8461b7', '#5d3d91', '#321f5f'] },
  { id: 'jodhpur', label: 'Jodhpur', colors: ['#eef8ff', '#bddff2', '#75b9d0', '#378aa9', '#17627f', '#0b405a'] },
  { id: 'jaipur', label: 'Jaipur', colors: ['#fff2f4', '#f9c5d1', '#ef8fa8', '#d85e83', '#a93a68', '#6c244b'] },
  { id: 'kochi', label: 'Kochi', colors: ['#effcf5', '#bfe9d0', '#78cca3', '#3aa878', '#1d7a5b', '#0f4f40'] },
  { id: 'bikaner', label: 'Bikaner', colors: ['#fff8df', '#f4df9b', '#dfb85f', '#bd8737', '#8c5b29', '#59391f'] },
  { id: 'bengaluru', label: 'Bengaluru', colors: ['#eef5ff', '#c8daf7', '#91b4ea', '#5f88d0', '#3e5faa', '#293d77'] },
  { id: 'kasol', label: 'Kasol', colors: ['#f3fff7', '#cbeed4', '#8fd4ad', '#54b38c', '#31856c', '#205c50'] },
  { id: 'udaipur', label: 'Udaipur', colors: ['#f5f6ff', '#d7d8f5', '#adb2e4', '#7d86c9', '#575fa6', '#363b70'] },
  { id: 'vizag', label: 'Vizag', colors: ['#fff4e5', '#ffd29d', '#f4a261', '#e76f51', '#a94b48', '#65343e'] },
] as const;

export const DEFAULT_INFOGRAPHIC_CONFIG: InfographicConfig = {
  title: 'India data story',
  subtitle: 'Add a spreadsheet to colour every region',
  source: 'Source: add your source',
  note: '',
  paletteId: 'ladakh',
  customColors: [],
  scaleMode: 'continuous',
  classes: 5,
  customBreaks: '',
  missingMode: 'grey',
  missingColor: '#d7dde5',
  zeroMode: 'normal',
  zeroColor: '#d7dde5',
  labelMode: 'name',
  prefix: '',
  suffix: '',
  decimals: 0,
  numberFormat: 'standard',
  showLegend: true,
  showTitle: true,
  showSource: true,
  background: '#f7f9fc',
  aspect: '16:9',
  resolution: 'hd',
  aggregation: 'last',
};

const REGION_COLUMNS = ['region', 'state', 'district', 'county', 'province', 'prefecture', 'constituency', 'name', 'area', 'geography'];
const VALUE_COLUMNS = ['value', 'amount', 'score', 'rate', 'percent', 'percentage', 'population', 'count', 'total', 'winner', 'party', 'category'];
const YEAR_COLUMNS = ['year', 'date', 'period', 'time'];
const PARENT_COLUMNS = ['parent', 'state name', 'state_name', 'province name', 'province_name', 'country'];

export function parseDelimitedText(text: string): DataRow[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows = parseDelimitedRows(trimmed, delimiter);
  if (rows.length < 2) return [];
  return recordsToDataRows(rows[0].map(String), rows.slice(1));
}

export async function parseSpreadsheetFile(file: File): Promise<DataRow[]> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'csv' || extension === 'tsv' || extension === 'txt') return parseDelimitedText(await file.text());
  const sheets = await readXlsxFile(file);
  const rows = sheets[0]?.data ?? [];
  if (rows.length < 2) return [];
  return recordsToDataRows(rows[0].map((cell) => String(cell ?? '')), rows.slice(1).map((row) => row.map(normalizeCell)));
}

export function recordsToDataRows(headers: string[], records: Array<Array<unknown>>): DataRow[] {
  const normalizedHeaders = headers.map((header, index) => String(header || `Column ${index + 1}`).trim());
  const normalizedLookup = normalizedHeaders.map((header) => header.toLowerCase().trim());
  const regionIndex = findColumn(normalizedLookup, REGION_COLUMNS, 0);
  const valueIndex = findColumn(normalizedLookup, VALUE_COLUMNS, Math.min(1, normalizedHeaders.length - 1));
  const yearIndex = findColumn(normalizedLookup, YEAR_COLUMNS, -1);
  const parentIndex = findColumn(normalizedLookup, PARENT_COLUMNS, -1, regionIndex);
  return records.map((record, index) => {
    const raw = Object.fromEntries(normalizedHeaders.map((header, columnIndex) => [header, normalizeCell(record[columnIndex])])) as DataRow['raw'];
    const region = String(record[regionIndex] ?? '').trim();
    const rawValue = normalizeCell(record[valueIndex]);
    const value = typeof rawValue === 'number' ? rawValue : String(rawValue ?? '').trim();
    const year = yearIndex >= 0 ? String(record[yearIndex] ?? '').trim() || undefined : undefined;
    const parent = parentIndex >= 0 ? String(record[parentIndex] ?? '').trim() || undefined : undefined;
    return { id: `row-${index + 1}`, region, value, year, parent, raw };
  }).filter((row) => row.region);
}

export function dataYears(rows: DataRow[]) {
  const years = [...new Set(rows.map((row) => row.year).filter((year): year is string => Boolean(year)))];
  return years.sort((first, second) => first.localeCompare(second, undefined, { numeric: true }));
}

export function createVisualization(rows: DataRow[], features: GeoFeature[], year: string | undefined, config: InfographicConfig): VisualizationResult {
  const scopedRows = year ? rows.filter((row) => !row.year || row.year === year) : rows;
  if (!scopedRows.length || !features.length) return emptyVisualization(features, scopedRows, config);
  const featureCandidates = features.map((feature) => featureCandidate(feature));
  const matches: Array<{ row: DataRow; feature: ReturnType<typeof featureCandidate>; numeric?: number; category?: string }> = [];
  const unmatchedRows: DataRow[] = [];
  const ambiguousRows: DataRow[] = [];

  for (const row of scopedRows) {
    const rowKey = normalizedRegionKey(row.region);
    const parentKey = normalizedRegionKey(row.parent ?? '');
    const exact = featureCandidates.filter((feature) => feature.keys.has(rowKey) || parentKey && feature.keys.has(`${parentKey}${rowKey}`));
    let rowMatches = exact.length === 1 ? exact : [];
    if (exact.length > 1) {
      const sameNamedFragments = new Set(exact.map((feature) => normalizedRegionKey(feature.name))).size === 1
        && new Set(exact.map((feature) => normalizedRegionKey(feature.parent))).size === 1;
      const scopedExact = parentKey ? exact.filter((feature) => normalizedRegionKey(feature.parent) === parentKey) : [];
      if (sameNamedFragments) rowMatches = exact;
      else if (scopedExact.length === 1 || new Set(scopedExact.map((feature) => normalizedRegionKey(feature.name))).size === 1) rowMatches = scopedExact;
      else {
        ambiguousRows.push(row);
        continue;
      }
    }
    if (!rowMatches.length) {
      const ranked = featureCandidates
        .map((feature) => ({ feature, score: bestSimilarity(rowKey, feature.keys) }))
        .sort((first, second) => second.score - first.score);
      if (ranked[0]?.score >= 0.86 && (ranked[0].score - (ranked[1]?.score ?? 0)) >= 0.04) rowMatches = [ranked[0].feature];
    }
    if (!rowMatches.length) {
      unmatchedRows.push(row);
      continue;
    }
    const numeric = parseNumericValue(row.value);
    for (const feature of rowMatches) matches.push({ row, feature, numeric: numeric ?? undefined, category: numeric === null ? String(row.value) : undefined });
  }

  const dataKind: VisualizationResult['dataKind'] = matches.length === 0 ? 'empty' : matches.every((match) => match.numeric !== undefined) && config.scaleMode !== 'categorical' ? 'numeric' : 'categorical';
  const grouped = new Map<string, typeof matches>();
  for (const match of matches) {
    const current = grouped.get(match.feature.id) ?? [];
    current.push(match);
    grouped.set(match.feature.id, current);
  }
  const aggregated = [...grouped.entries()].map(([featureId, values]) => aggregateValues(featureId, values, config, dataKind));
  const numericValues = aggregated.map((item) => item.value).filter((value): value is number => value !== undefined);
  const minimum = numericValues.length ? config.minimum ?? Math.min(...numericValues) : undefined;
  const maximum = numericValues.length ? config.maximum ?? Math.max(...numericValues) : undefined;
  const palette = paletteColors(config);
  const scale = buildScale(aggregated, dataKind, palette, config, minimum, maximum);
  const byFeatureId: Record<string, VisualDatum> = {};

  for (const feature of featureCandidates) {
    const item = aggregated.find((candidate) => candidate.featureId === feature.id);
    if (!item) {
      byFeatureId[feature.id] = missingDatum(feature, config);
      continue;
    }
    const isZero = item.value === 0;
    const zeroAppearance = isZero ? zeroStyle(config) : null;
    byFeatureId[feature.id] = {
      featureId: feature.id,
      region: feature.name,
      value: item.value,
      category: item.category,
      formattedValue: item.value !== undefined ? formatDataValue(item.value, config) : item.category,
      color: zeroAppearance?.color ?? scale.color(item),
      opacity: zeroAppearance?.opacity ?? 0.92,
      hasData: true,
      rowIds: item.rowIds,
    };
  }

  return {
    byFeatureId,
    legend: scale.legend,
    matchedRows: new Set(matches.map((match) => match.row.id)).size,
    unmatchedRows,
    ambiguousRows,
    totalRows: scopedRows.length,
    dataKind,
    minimum,
    maximum,
  };
}

export function formatDataValue(value: number, config: Pick<InfographicConfig, 'prefix' | 'suffix' | 'decimals' | 'numberFormat'>) {
  const absolute = Math.abs(value);
  let formatted: string;
  if (config.numberFormat === 'indian' && absolute >= 10_000_000) formatted = `${(value / 10_000_000).toFixed(config.decimals)} Cr`;
  else if (config.numberFormat === 'indian' && absolute >= 100_000) formatted = `${(value / 100_000).toFixed(config.decimals)} L`;
  else if (config.numberFormat === 'metric' && absolute >= 1_000_000_000) formatted = `${(value / 1_000_000_000).toFixed(config.decimals)}B`;
  else if (config.numberFormat === 'metric' && absolute >= 1_000_000) formatted = `${(value / 1_000_000).toFixed(config.decimals)}M`;
  else if (config.numberFormat === 'metric' && absolute >= 1_000) formatted = `${(value / 1_000).toFixed(config.decimals)}K`;
  else formatted = value.toLocaleString('en-IN', { minimumFractionDigits: config.decimals, maximumFractionDigits: config.decimals });
  return `${config.prefix}${formatted}${config.suffix}`;
}

export function rowsToDelimited(rows: DataRow[], delimiter = ',') {
  const headers = ['Region', 'Value', 'Year', 'Parent'];
  return [headers, ...rows.map((row) => [row.region, row.value, row.year ?? '', row.parent ?? ''])]
    .map((cells) => cells.map((cell) => quoteDelimited(String(cell ?? ''), delimiter)).join(delimiter))
    .join('\n');
}

export function starterRowsForFeatures(features: GeoFeature[]): DataRow[] {
  return features.map((feature, index) => ({
    id: `row-${index + 1}`,
    region: String(feature.properties.__name ?? `Region ${index + 1}`),
    value: '',
    parent: String(feature.properties.SCOPE_NAME ?? '') || undefined,
    raw: {},
  }));
}

function featureCandidate(feature: GeoFeature) {
  const id = String(feature.id);
  const name = String(feature.properties.__name ?? 'Unknown region');
  const parent = String(feature.properties.SCOPE_NAME ?? feature.properties.STATE_SCOPE ?? feature.properties.NAME_1 ?? '');
  const segments = name.split('·').map((segment) => segment.trim()).filter(Boolean);
  const shortName = segments.at(-1) ?? name;
  const keys = new Set([normalizedRegionKey(name), normalizedRegionKey(shortName), normalizedRegionKey(`${parent}${shortName}`)]);
  return { id, name, parent, keys };
}

function aggregateValues(featureId: string, values: Array<{ row: DataRow; numeric?: number; category?: string }>, config: InfographicConfig, kind: VisualizationResult['dataKind']) {
  if (kind === 'categorical') {
    const last = values.at(-1);
    return { featureId, category: last?.category ?? String(last?.row.value ?? ''), rowIds: values.map((value) => value.row.id) };
  }
  const numbers = values.map((value) => value.numeric).filter((value): value is number => value !== undefined);
  const value = config.aggregation === 'sum' ? numbers.reduce((sum, number) => sum + number, 0) : config.aggregation === 'average' ? numbers.reduce((sum, number) => sum + number, 0) / Math.max(numbers.length, 1) : numbers.at(-1);
  return { featureId, value, rowIds: values.map((item) => item.row.id) };
}

function buildScale(items: Array<{ featureId: string; value?: number; category?: string }>, kind: VisualizationResult['dataKind'], palette: string[], config: InfographicConfig, minimum?: number, maximum?: number) {
  if (kind === 'categorical') {
    const categories = [...new Set(items.map((item) => item.category ?? 'Unknown'))];
    const categoryColors = new Map(categories.map((category, index) => [category, palette[index % palette.length]]));
    return {
      color: (item: { category?: string }) => categoryColors.get(item.category ?? 'Unknown') ?? palette[0],
      legend: categories.slice(0, 12).map((category) => ({ color: categoryColors.get(category) ?? palette[0], label: category })),
    };
  }
  if (minimum === undefined || maximum === undefined) return { color: () => palette[0], legend: [] as LegendItem[] };
  const classes = Math.max(2, Math.min(8, config.classes));
  const values = items.map((item) => item.value).filter((value): value is number => value !== undefined).sort((a, b) => a - b);
  const breaks = config.scaleMode === 'custom'
    ? customBreakpoints(config.customBreaks, minimum, maximum)
    : config.scaleMode === 'quantile'
      ? Array.from({ length: classes + 1 }, (_, index) => quantile(values, index / classes))
      : Array.from({ length: classes + 1 }, (_, index) => minimum + ((maximum - minimum) * index) / classes);
  if (config.scaleMode === 'continuous') {
    const legend = Array.from({ length: classes }, (_, index) => {
      const low = minimum + ((maximum - minimum) * index) / classes;
      const high = minimum + ((maximum - minimum) * (index + 1)) / classes;
      return { color: interpolatePalette(palette, (index + 0.5) / classes), label: `${formatLegendNumber(low)}–${formatLegendNumber(high)}`, minimum: low, maximum: high };
    });
    return { color: (item: { value?: number }) => interpolatePalette(palette, normalizedValue(item.value ?? minimum, minimum, maximum)), legend };
  }
  const colors = Array.from({ length: Math.max(1, breaks.length - 1) }, (_, index) => interpolatePalette(palette, (index + 0.5) / Math.max(1, breaks.length - 1)));
  return {
    color: (item: { value?: number }) => colors[classIndex(item.value ?? minimum, breaks)] ?? colors.at(-1) ?? palette[0],
    legend: colors.map((color, index) => ({ color, label: `${formatLegendNumber(breaks[index])}–${formatLegendNumber(breaks[index + 1])}`, minimum: breaks[index], maximum: breaks[index + 1] })),
  };
}

function emptyVisualization(features: GeoFeature[], rows: DataRow[], config: InfographicConfig): VisualizationResult {
  const byFeatureId = Object.fromEntries(features.map((feature) => {
    const candidate = featureCandidate(feature);
    return [candidate.id, missingDatum(candidate, config)];
  }));
  return { byFeatureId, legend: [], matchedRows: 0, unmatchedRows: rows, ambiguousRows: [], totalRows: rows.length, dataKind: 'empty' };
}

function missingDatum(feature: { id: string; name: string }, config: InfographicConfig): VisualDatum {
  const color = config.missingMode === 'white' ? '#ffffff' : config.missingColor;
  return { featureId: feature.id, region: feature.name, color, opacity: config.missingMode === 'hide' ? 0 : 0.72, hasData: false, rowIds: [] };
}

function zeroStyle(config: InfographicConfig) {
  if (config.zeroMode === 'normal') return null;
  if (config.zeroMode === 'hide') return { color: config.zeroColor, opacity: 0 };
  return { color: config.zeroMode === 'white' ? '#ffffff' : config.zeroColor, opacity: 0.82 };
}

function paletteColors(config: InfographicConfig) {
  if (config.customColors.length >= 2) return config.customColors;
  return [...(PALETTES.find((palette) => palette.id === config.paletteId)?.colors ?? PALETTES[0].colors)];
}

function normalizedRegionKey(value: string) {
  const aliases: Record<string, string> = {
    bangalore: 'bengaluru',
    bombay: 'mumbai',
    calcutta: 'kolkata',
    orissa: 'odisha',
    uttaranchal: 'uttarakhand',
    pondicherry: 'puducherry',
    delhi: 'nctofdelhi',
    'newdelhi': 'nctofdelhi',
    'jammuandkashmir': 'jammuandkashmir',
    'jammukashmir': 'jammuandkashmir',
  };
  const normalized = value.toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\b(?:district|county|province|prefecture|state|union territory|constituency|congressional|assembly)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
  return aliases[normalized] ?? normalized;
}

function parseNumericValue(value: string | number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text);
  const cleaned = text.replace(/[₹$€£,%\s,()]/g, '');
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return null;
  return negative ? -numeric : numeric;
}

function bestSimilarity(value: string, candidates: Set<string>) {
  let best = 0;
  for (const candidate of candidates) best = Math.max(best, stringSimilarity(value, candidate));
  return best;
}

function stringSimilarity(first: string, second: string) {
  if (first === second) return 1;
  if (!first || !second) return 0;
  const distance = levenshtein(first, second);
  return 1 - distance / Math.max(first.length, second.length);
}

function levenshtein(first: string, second: string) {
  const previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let row = 1; row <= first.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= second.length; column += 1) {
      const saved = previous[column];
      previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + (first[row - 1] === second[column - 1] ? 0 : 1));
      diagonal = saved;
    }
  }
  return previous[second.length];
}

function parseDelimitedRows(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function findColumn(headers: string[], candidates: string[], fallback: number, excluded = -1) {
  const exact = headers.findIndex((header, index) => index !== excluded && candidates.includes(header));
  if (exact >= 0) return exact;
  const partial = headers.findIndex((header, index) => index !== excluded && candidates.some((candidate) => header.includes(candidate)));
  return partial >= 0 ? partial : fallback;
}

function normalizeCell(value: unknown): string | number | boolean | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return value == null ? null : String(value);
}

function customBreakpoints(value: string, minimum: number, maximum: number) {
  const points = value.split(/[,;\s]+/).map(Number).filter(Number.isFinite).filter((point) => point > minimum && point < maximum).sort((a, b) => a - b);
  return [minimum, ...new Set(points), maximum];
}

function quantile(values: number[], probability: number) {
  if (!values.length) return 0;
  const position = (values.length - 1) * probability;
  const base = Math.floor(position);
  const remainder = position - base;
  return values[base + 1] === undefined ? values[base] : values[base] + remainder * (values[base + 1] - values[base]);
}

function classIndex(value: number, breaks: number[]) {
  for (let index = 1; index < breaks.length; index += 1) if (value <= breaks[index]) return index - 1;
  return Math.max(0, breaks.length - 2);
}

function normalizedValue(value: number, minimum: number, maximum: number) {
  return maximum === minimum ? 0.5 : Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
}

function interpolatePalette(colors: string[], progress: number) {
  if (colors.length === 1) return colors[0];
  const scaled = Math.max(0, Math.min(1, progress)) * (colors.length - 1);
  const index = Math.min(Math.floor(scaled), colors.length - 2);
  return interpolateHex(colors[index], colors[index + 1], scaled - index);
}

function interpolateHex(first: string, second: string, progress: number) {
  const start = hexToRgb(first);
  const end = hexToRgb(second);
  const channels = start.map((channel, index) => Math.round(channel + (end[index] - channel) * progress));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(value: string) {
  const normalized = value.replace('#', '');
  const hex = normalized.length === 3 ? normalized.split('').map((part) => `${part}${part}`).join('') : normalized.padEnd(6, '0').slice(0, 6);
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}

function formatLegendNumber(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 10_000_000) return `${(value / 10_000_000).toFixed(1)}Cr`;
  if (absolute >= 100_000) return `${(value / 100_000).toFixed(1)}L`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function quoteDelimited(value: string, delimiter: string) {
  return value.includes(delimiter) || /["\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
