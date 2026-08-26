import { normalizedRegionKey, parseDelimitedText, parseNumericValue, recordsToDataRows, type DataRow } from './infographic';

export type DatasetOrigin = 'file' | 'paste' | 'google-sheet' | 'rest-api' | 'template-demo' | 'starter';

export type DatasetMeta = {
  origin: DatasetOrigin;
  /** The URL the data came from, when it came from the network. */
  sourceUrl?: string;
  publisher: string;
  releaseDate: string;
  notes: string;
  retrievedAt?: string;
  /** True only for generated demo numbers. Surfaced in the UI and in exports. */
  synthetic: boolean;
  /** Minutes between automatic refreshes. 0 disables scheduled refresh. */
  refreshMinutes: number;
  rowCount: number;
};

export const EMPTY_DATASET_META: DatasetMeta = {
  origin: 'paste',
  publisher: '',
  releaseDate: '',
  notes: '',
  synthetic: false,
  refreshMinutes: 0,
  rowCount: 0,
};

export type ColumnMapping = {
  region: string;
  value: string;
  year?: string;
  parent?: string;
};

export type MissingValuePolicy = 'keep' | 'drop' | 'zero';

export type ParsedTable = {
  headers: string[];
  records: Array<Array<string | number | boolean | null>>;
};

const REGION_HINTS = ['region', 'state', 'district', 'county', 'province', 'prefecture', 'constituency', 'name', 'area', 'geography', 'ut', 'territory'];
const VALUE_HINTS = ['value', 'amount', 'score', 'rate', 'percent', 'percentage', 'population', 'count', 'total', 'gdp', 'seats', 'votes'];
const YEAR_HINTS = ['year', 'date', 'period', 'time', 'fy'];
const PARENT_HINTS = ['parent', 'state', 'province', 'country', 'region_group'];

/**
 * Rewrites a public Google Sheets link into its CSV export endpoint.
 * Returns null when the link is not a Sheets URL.
 */
export function googleSheetCsvUrl(input: string): string | null {
  const match = input.trim().match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return null;
  const gidMatch = input.match(/[#&?]gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
}

/** Only http(s) is allowed, so a pasted file: or javascript: URL cannot be fetched. */
export function assertFetchableUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('That is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http and https URLs can be loaded');
  return url.toString();
}

export type RemoteFetchResult = {
  rows: DataRow[];
  table: ParsedTable;
  contentType: string;
  meta: Pick<DatasetMeta, 'origin' | 'sourceUrl' | 'retrievedAt' | 'rowCount'>;
};

/**
 * Loads a dataset from a public Google Sheet, a CSV/TSV endpoint or a REST JSON URL.
 * The response is parsed by content type first and by shape second.
 */
export async function fetchRemoteDataset(input: string, fetcher: typeof fetch = fetch): Promise<RemoteFetchResult> {
  const sheetUrl = googleSheetCsvUrl(input);
  const origin: DatasetOrigin = sheetUrl ? 'google-sheet' : 'rest-api';
  const url = assertFetchableUrl(sheetUrl ?? input);
  const response = await fetcher(url, { headers: { accept: 'text/csv, application/json;q=0.9, text/plain;q=0.8' } });
  if (!response.ok) throw new Error(`The source responded with ${response.status} ${response.statusText || ''}`.trim());
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  const table = contentType.includes('json') || looksLikeJson(body) ? tableFromJsonText(body) : tableFromDelimitedText(body);
  if (!table.headers.length) throw new Error('The source returned no readable columns');
  const rows = recordsToDataRows(table.headers, table.records);
  return {
    rows,
    table,
    contentType,
    meta: { origin, sourceUrl: url, retrievedAt: new Date().toISOString(), rowCount: rows.length },
  };
}

function looksLikeJson(body: string) {
  const trimmed = body.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export function tableFromDelimitedText(text: string): ParsedTable {
  const rows = parseDelimitedText(text);
  if (!rows.length) return { headers: [], records: [] };
  const headers = Object.keys(rows[0].raw);
  return { headers, records: rows.map((row) => headers.map((header) => row.raw[header] ?? null)) };
}

/**
 * Flattens a JSON payload into a table. Accepts a bare array of objects, or an
 * object wrapping the array under a common key such as data, records or results.
 */
export function tableFromJsonText(text: string): ParsedTable {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('The response was not valid JSON');
  }
  return tableFromJson(payload);
}

export function tableFromJson(payload: unknown): ParsedTable {
  const list = findRecordArray(payload);
  if (!list.length) return { headers: [], records: [] };
  const headers: string[] = [];
  const flattened = list.map((entry) => flattenRecord(entry));
  for (const entry of flattened) for (const key of Object.keys(entry)) if (!headers.includes(key)) headers.push(key);
  return { headers, records: flattened.map((entry) => headers.map((header) => entry[header] ?? null)) };
}

function findRecordArray(payload: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 4) return [];
  if (Array.isArray(payload)) {
    return payload.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && !Array.isArray(entry));
  }
  if (typeof payload !== 'object' || payload === null) return [];
  const record = payload as Record<string, unknown>;
  for (const key of ['data', 'records', 'results', 'rows', 'items', 'features', 'value']) {
    if (key in record) {
      const found = findRecordArray(record[key], depth + 1);
      if (found.length) return found;
    }
  }
  for (const value of Object.values(record)) {
    const found = findRecordArray(value, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function flattenRecord(entry: Record<string, unknown>, prefix = '', depth = 0): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(entry)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) output[name] = null;
    else if (typeof value === 'object' && !Array.isArray(value) && depth < 3) Object.assign(output, flattenRecord(value as Record<string, unknown>, name, depth + 1));
    else if (Array.isArray(value)) output[name] = value.length ? String(value[0]) : null;
    else output[name] = value as string | number | boolean;
  }
  return output;
}

/** Suggests which column is the region, the value, the year and the parent. */
export function suggestColumnMapping(table: ParsedTable): ColumnMapping {
  const lower = table.headers.map((header) => header.toLowerCase());
  const numericScore = table.headers.map((_, index) => {
    const samples = table.records.slice(0, 40).map((record) => record[index]).filter((value) => value !== null && value !== '');
    if (!samples.length) return 0;
    return samples.filter((value) => parseNumericValue(value as string | number) !== null).length / samples.length;
  });

  const pick = (hints: string[], exclude: Array<string | undefined> = [], preferNumeric = false) => {
    const candidates = table.headers
      .map((header, index) => ({ header, index, score: hintScore(lower[index], hints) + (preferNumeric ? numericScore[index] : 1 - numericScore[index]) }))
      .filter((entry) => !exclude.includes(entry.header))
      .sort((first, second) => second.score - first.score);
    return candidates[0] && candidates[0].score > 0.4 ? candidates[0].header : undefined;
  };

  const region = pick(REGION_HINTS) ?? table.headers[0] ?? '';
  const value = pick(VALUE_HINTS, [region], true)
    ?? table.headers.find((header, index) => header !== region && numericScore[index] >= 0.7)
    ?? table.headers[1]
    ?? region;
  const year = pick(YEAR_HINTS, [region, value]);
  const parent = pick(PARENT_HINTS, [region, value, year]);
  return { region, value, year, parent };
}

function hintScore(header: string, hints: string[]) {
  if (hints.includes(header)) return 2;
  return hints.some((hint) => header.includes(hint)) ? 1 : 0;
}

/** Rebuilds rows from a table using an explicit column mapping. */
export function applyColumnMapping(table: ParsedTable, mapping: ColumnMapping, policy: MissingValuePolicy = 'keep'): DataRow[] {
  const index = (name?: string) => (name ? table.headers.indexOf(name) : -1);
  const regionIndex = index(mapping.region);
  const valueIndex = index(mapping.value);
  const yearIndex = index(mapping.year);
  const parentIndex = index(mapping.parent);

  const rows = table.records.map((record, position) => {
    const raw = Object.fromEntries(table.headers.map((header, column) => [header, record[column] ?? null])) as DataRow['raw'];
    const cell = valueIndex >= 0 ? record[valueIndex] : null;
    const missing = cell === null || cell === undefined || String(cell).trim() === '';
    const value = missing ? (policy === 'zero' ? 0 : '') : (typeof cell === 'number' ? cell : String(cell).trim());
    return {
      id: `row-${position + 1}`,
      region: regionIndex >= 0 ? String(record[regionIndex] ?? '').trim() : '',
      value,
      year: yearIndex >= 0 ? String(record[yearIndex] ?? '').trim() || undefined : undefined,
      parent: parentIndex >= 0 ? String(record[parentIndex] ?? '').trim() || undefined : undefined,
      raw,
      missing,
    };
  });

  return rows
    .filter((row) => row.region)
    .filter((row) => (policy === 'drop' ? !row.missing : true))
    .map(({ missing: _missing, ...row }) => row);
}

export type DuplicateGroup = { key: string; label: string; rows: DataRow[] };

/**
 * Finds rows that describe the same region and period. Genuine time series are
 * not duplicates, so the year is part of the key.
 */
export function findDuplicateRows(rows: DataRow[]): DuplicateGroup[] {
  const groups = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = `${normalizedRegionKey(row.region)}::${row.year ?? ''}::${normalizedRegionKey(row.parent ?? '')}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, label: `${group[0].region}${group[0].year ? ` · ${group[0].year}` : ''}`, rows: group }));
}

/** Keeps the last row of each duplicate group, preserving overall row order. */
export function dedupeRows(rows: DataRow[]): DataRow[] {
  const lastIndex = new Map<string, string>();
  for (const row of rows) lastIndex.set(`${normalizedRegionKey(row.region)}::${row.year ?? ''}::${normalizedRegionKey(row.parent ?? '')}`, row.id);
  const keep = new Set(lastIndex.values());
  return rows.filter((row) => keep.has(row.id));
}

export function countMissingValues(rows: DataRow[]) {
  return rows.filter((row) => row.value === '' || row.value === null || row.value === undefined).length;
}

export type RegionOverrides = Record<string, string>;

/**
 * Applies manual name corrections before matching, so an unmatched spreadsheet
 * name can be pointed at the correct boundary without editing the source file.
 */
export function applyRegionOverrides(rows: DataRow[], overrides: RegionOverrides): DataRow[] {
  if (!Object.keys(overrides).length) return rows;
  const lookup = new Map(Object.entries(overrides).map(([from, to]) => [normalizedRegionKey(from), to]));
  return rows.map((row) => {
    const replacement = lookup.get(normalizedRegionKey(row.region));
    return replacement && replacement !== row.region ? { ...row, region: replacement } : row;
  });
}

/** Ranks candidate boundary names for an unmatched spreadsheet name. */
export function suggestRegionMatches(name: string, candidates: string[], limit = 5) {
  const target = normalizedRegionKey(name);
  return candidates
    .map((candidate) => ({ candidate, score: similarity(target, normalizedRegionKey(candidate)) }))
    .filter((entry) => entry.score > 0.35)
    .sort((first, second) => second.score - first.score)
    .slice(0, limit);
}

function similarity(first: string, second: string) {
  if (first === second) return 1;
  if (!first || !second) return 0;
  if (second.includes(first) || first.includes(second)) return 0.9;
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

/** The attribution line written into every export. */
export function attributionLine(meta: DatasetMeta, fallback: string) {
  const parts: string[] = [];
  if (meta.publisher) parts.push(meta.publisher);
  if (meta.releaseDate) parts.push(meta.releaseDate);
  if (meta.sourceUrl) parts.push(meta.sourceUrl);
  const base = parts.length ? `Source: ${parts.join(' · ')}` : fallback;
  return meta.synthetic ? `${base} · SYNTHETIC DEMO DATA — not a real measurement` : base;
}
