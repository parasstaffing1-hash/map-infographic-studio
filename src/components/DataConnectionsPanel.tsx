import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Cloud, Copy, Database, Download, FileSpreadsheet, Link2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { CURATED_DATASETS, type CuratedDataset } from '../domain/curatedDatasets';
import {
  applyColumnMapping,
  countMissingValues,
  dedupeRows,
  fetchRemoteDataset,
  findDuplicateRows,
  googleSheetCsvUrl,
  suggestColumnMapping,
  suggestRegionMatches,
  tableFromDelimitedText,
  type ColumnMapping,
  type DatasetMeta,
  type MissingValuePolicy,
  type ParsedTable,
  type RegionOverrides,
} from '../domain/dataSources';
import { downloadBlob, rowsToCsv } from '../domain/exportComposition';
import { parseSpreadsheetFile, starterRowsForFeatures, type DataRow, type VisualizationResult } from '../domain/infographic';
import type { GeoFeature, ProvenanceSource } from '../domain/types';

type Props = {
  rows: DataRow[];
  features: GeoFeature[];
  years: string[];
  currentYear?: string;
  result: VisualizationResult;
  sources: ProvenanceSource[];
  datasetMeta: DatasetMeta;
  regionOverrides: RegionOverrides;
  onRowsChange: (rows: DataRow[], meta?: Partial<DatasetMeta>) => void;
  onYearChange: (year?: string) => void;
  onMetaChange: (patch: Partial<DatasetMeta>) => void;
  onRegionOverride: (from: string, to: string) => void;
  onToast: (message: string) => void;
};

const SAMPLE = 'Region,Value,Year\nDelhi,16879941,2021\nMaharashtra,124904071,2021\nTamil Nadu,77841267,2021';

export function DataConnectionsPanel({ rows, features, years, currentYear, result, sources, datasetMeta, regionOverrides, onRowsChange, onYearChange, onMetaChange, onRegionOverride, onToast }: Props) {
  const [tab, setTab] = useState<'presets' | 'paste' | 'file' | 'link'>('presets');
  const [paste, setPaste] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [missingPolicy, setMissingPolicy] = useState<MissingValuePolicy>('keep');
  const inputRef = useRef<HTMLInputElement>(null);

  const featureNames = useMemo(() => features.map((feature) => String(feature.properties.__name ?? '')).filter(Boolean), [features]);
  const duplicates = useMemo(() => findDuplicateRows(rows), [rows]);
  const missingCount = useMemo(() => countMissingValues(rows), [rows]);
  const unresolved = [...result.unmatchedRows, ...result.ambiguousRows];

  // Scheduled refresh keeps a connected URL dataset current while the tab is open.
  useEffect(() => {
    if (!datasetMeta.refreshMinutes || !datasetMeta.sourceUrl) return undefined;
    const timer = window.setInterval(() => { void refresh(true); }, datasetMeta.refreshMinutes * 60_000);
    return () => window.clearInterval(timer);
  }, [datasetMeta.refreshMinutes, datasetMeta.sourceUrl]);

  const adoptTable = (parsed: ParsedTable, origin: DatasetMeta['origin'], extra: Partial<DatasetMeta> = {}) => {
    if (!parsed.headers.length) {
      setError('No readable columns were found in that source.');
      return;
    }
    const suggestion = suggestColumnMapping(parsed);
    const next = applyColumnMapping(parsed, suggestion, missingPolicy);
    if (!next.length) {
      setError('No rows had a usable region name.');
      return;
    }
    setTable(parsed);
    setMapping(suggestion);
    setError('');
    onRowsChange(next, { origin, rowCount: next.length, synthetic: false, ...extra });
    onYearChange(undefined);
    onToast(`${next.length} rows loaded · ${suggestion.region} → ${suggestion.value}`);
  };

  const remap = (patch: Partial<ColumnMapping>, policy = missingPolicy) => {
    if (!table || !mapping) return;
    const next = { ...mapping, ...patch };
    setMapping(next);
    const remapped = applyColumnMapping(table, next, policy);
    onRowsChange(remapped, { rowCount: remapped.length });
    onToast(`Columns remapped · ${remapped.length} rows`);
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      if (/\.(csv|tsv|txt)$/i.test(file.name)) {
        adoptTable(tableFromDelimitedText(await file.text()), 'file', { notes: file.name });
      } else {
        const parsed = await parseSpreadsheetFile(file);
        if (!parsed.length) throw new Error('That spreadsheet had no usable rows');
        const headers = Object.keys(parsed[0].raw);
        adoptTable({ headers, records: parsed.map((row) => headers.map((header) => row.raw[header] ?? null)) }, 'file', { notes: file.name });
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not read that file');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const refresh = async (silent = false) => {
    const target = datasetMeta.sourceUrl ?? url;
    if (!target) return;
    setBusy(true);
    if (!silent) setError('');
    try {
      const fetched = await fetchRemoteDataset(target);
      adoptTable(fetched.table, fetched.meta.origin, { sourceUrl: fetched.meta.sourceUrl, retrievedAt: fetched.meta.retrievedAt });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Could not load that URL';
      // A cross-origin block is the most common failure, so name it explicitly.
      setError(/fetch|network|Failed/i.test(message) ? `${message}. The source may not allow browser access (CORS) — download the file and upload it instead.` : message);
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (id: string, patch: Partial<DataRow>) => onRowsChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  return (
    <div className="panel-content data-binding-panel">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="panel-title-icon"><Database size={16} /></span>
          <div><h2>Connect data</h2><span>File, paste, Sheet or API</span></div>
        </div>
      </div>

      <div className="chip-row" role="tablist" aria-label="Data source type">
        <button role="tab" aria-selected={tab === 'presets'} className={`chip ${tab === 'presets' ? 'active' : ''}`} onClick={() => setTab('presets')}>Curated</button>
        <button role="tab" aria-selected={tab === 'paste'} className={`chip ${tab === 'paste' ? 'active' : ''}`} onClick={() => setTab('paste')}>Paste</button>
        <button role="tab" aria-selected={tab === 'file'} className={`chip ${tab === 'file' ? 'active' : ''}`} onClick={() => setTab('file')}>File</button>
        <button role="tab" aria-selected={tab === 'link'} className={`chip ${tab === 'link' ? 'active' : ''}`} onClick={() => setTab('link')}>Link</button>
      </div>

      {tab === 'presets' && (
        <div className="data-import-card">
          <strong>Curated real-world datasets</strong>
          <small>Verified demographic, economic, and climate stories ready for instant mapping.</small>
          <div className="dataset-preset-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
            {CURATED_DATASETS.map((dataset) => (
              <button
                key={dataset.id}
                type="button"
                className="preset-story-card"
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, #e2e8f0)',
                  background: 'var(--card-bg, #ffffff)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                }}
                onClick={() => {
                  onRowsChange(dataset.rows, {
                    origin: 'preset',
                    ...dataset.meta,
                    rowCount: dataset.rows.length,
                    publisher: dataset.source,
                    notes: dataset.description,
                    synthetic: false,
                  });
                  onYearChange(undefined);
                  onToast(`Loaded ${dataset.title} (${dataset.rows.length} rows)`);
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '13px', color: 'var(--text-main, #1e293b)' }}>{dataset.title}</strong>
                  <span style={{ fontSize: '11px', background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>{dataset.category}</span>
                </div>
                <small style={{ color: 'var(--text-muted, #64748b)', fontSize: '12px' }}>{dataset.description}</small>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>Source: {dataset.source}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'paste' && (
        <div className="data-import-card">
          <label htmlFor="data-paste"><strong>Paste a table</strong><small>Required: Region and Value. Optional: Year and Parent.</small></label>
          <textarea id="data-paste" value={paste} onChange={(event) => setPaste(event.target.value)} placeholder={SAMPLE} />
          <div className="data-action-row">
            <button className="primary-button" onClick={() => adoptTable(tableFromDelimitedText(paste), 'paste')} disabled={!paste.trim()}><FileSpreadsheet size={14} /> Apply data</button>
            <button className="outline-button" onClick={() => setPaste(SAMPLE)}><Copy size={14} /> Sample</button>
          </div>
        </div>
      )}

      {tab === 'file' && (
        <div className="data-import-card">
          <strong>Upload a spreadsheet</strong>
          <small>CSV, TSV, TXT or XLSX. Everything stays in your browser.</small>
          <div className="data-action-row">
            <button className="primary-button" onClick={() => inputRef.current?.click()} disabled={busy}><Upload size={14} /> {busy ? 'Reading…' : 'Choose file'}</button>
            <input ref={inputRef} className="sr-only" type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={(event) => void importFile(event.target.files?.[0])} />
          </div>
          <button className="text-link-button" onClick={() => downloadBlob(new Blob([rowsToCsv(starterRowsForFeatures(features))], { type: 'text/csv;charset=utf-8' }), 'map-data-template.csv')} disabled={!features.length}>
            <Download size={13} /> Download a template for this map
          </button>
        </div>
      )}

      {tab === 'link' && (
        <div className="data-import-card">
          <label htmlFor="data-url"><strong>Public Google Sheet or JSON API</strong><small>The link must be readable without signing in.</small></label>
          <input id="data-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
          {googleSheetCsvUrl(url) && <p className="panel-hint"><Cloud size={12} /> Recognised as a Google Sheet · exported as CSV</p>}
          <div className="data-action-row">
            <button className="primary-button" onClick={() => void refresh()} disabled={busy || !url.trim()}><Link2 size={14} /> {busy ? 'Loading…' : 'Connect'}</button>
            {datasetMeta.sourceUrl && <button className="outline-button" onClick={() => void refresh()} disabled={busy}><RefreshCw size={14} /> Refresh</button>}
          </div>
          {datasetMeta.sourceUrl && (
            <label className="select-row"><span>Auto refresh</span>
              <select value={datasetMeta.refreshMinutes} onChange={(event) => onMetaChange({ refreshMinutes: Number(event.target.value) })}>
                <option value={0}>Off</option>
                <option value={15}>Every 15 minutes</option>
                <option value={60}>Hourly</option>
                <option value={1440}>Daily</option>
              </select>
            </label>
          )}
          {datasetMeta.retrievedAt && <p className="panel-hint">Last fetched {new Date(datasetMeta.retrievedAt).toLocaleString()}</p>}
        </div>
      )}

      {error && <div className="production-error" role="alert">{error}</div>}

      {table && mapping && (
        <>
          <div className="panel-label">Column mapping</div>
          <label className="select-row"><span>Region</span>
            <select value={mapping.region} onChange={(event) => remap({ region: event.target.value })}>{table.headers.map((header) => <option key={header}>{header}</option>)}</select>
          </label>
          <label className="select-row"><span>Value</span>
            <select value={mapping.value} onChange={(event) => remap({ value: event.target.value })}>{table.headers.map((header) => <option key={header}>{header}</option>)}</select>
          </label>
          <label className="select-row"><span>Year</span>
            <select value={mapping.year ?? ''} onChange={(event) => remap({ year: event.target.value || undefined })}>
              <option value="">None</option>{table.headers.map((header) => <option key={header}>{header}</option>)}
            </select>
          </label>
          <label className="select-row"><span>Parent</span>
            <select value={mapping.parent ?? ''} onChange={(event) => remap({ parent: event.target.value || undefined })}>
              <option value="">None</option>{table.headers.map((header) => <option key={header}>{header}</option>)}
            </select>
          </label>
          <label className="select-row"><span>Missing values</span>
            <select value={missingPolicy} onChange={(event) => { const policy = event.target.value as MissingValuePolicy; setMissingPolicy(policy); remap({}, policy); }}>
              <option value="keep">Keep blank (shown as no data)</option>
              <option value="drop">Drop those rows</option>
              <option value="zero">Treat as zero</option>
            </select>
          </label>
        </>
      )}

      {rows.length > 0 && (
        <>
          <div className="match-summary">
            <div className="match-good"><Check size={15} /><span><strong>{result.matchedRows}</strong> matched</span></div>
            <div className={unresolved.length ? 'match-bad' : 'match-good'}>{unresolved.length ? <AlertTriangle size={15} /> : <Check size={15} />}<span><strong>{unresolved.length}</strong> need review</span></div>
          </div>

          {(duplicates.length > 0 || missingCount > 0) && (
            <div className="data-quality-card">
              {duplicates.length > 0 && (
                <div className="data-quality-row">
                  <span><AlertTriangle size={13} /> {duplicates.length} duplicate region/year {duplicates.length === 1 ? 'group' : 'groups'}</span>
                  <button className="text-button" onClick={() => { const deduped = dedupeRows(rows); onRowsChange(deduped, { rowCount: deduped.length }); onToast(`Kept the last row of ${duplicates.length} duplicate groups`); }}>Keep last</button>
                </div>
              )}
              {missingCount > 0 && <div className="data-quality-row"><span><AlertTriangle size={13} /> {missingCount} rows have no value</span></div>}
            </div>
          )}

          {unresolved.length > 0 && featureNames.length > 0 && (
            <>
              <div className="panel-label">Unmatched regions</div>
              <div className="region-fix-list">
                {unresolved.slice(0, 12).map((row) => {
                  const suggestions = suggestRegionMatches(row.region, featureNames);
                  return (
                    <div className="region-fix-row" key={row.id}>
                      <strong>{row.region}</strong>
                      <select
                        aria-label={`Match ${row.region} to a boundary`}
                        value={regionOverrides[row.region] ?? ''}
                        onChange={(event) => { if (event.target.value) { onRegionOverride(row.region, event.target.value); onToast(`${row.region} → ${event.target.value}`); } }}
                      >
                        <option value="">Choose the correct region…</option>
                        {suggestions.map((match) => <option key={match.candidate} value={match.candidate}>{match.candidate} · {Math.round(match.score * 100)}%</option>)}
                        {featureNames.filter((name) => !suggestions.some((match) => match.candidate === name)).slice(0, 200).map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
              {unresolved.length > 12 && <p className="panel-note">Showing the first 12. Fix these and the rest will re-check automatically.</p>}
            </>
          )}

          {years.length > 0 && (
            <label className="select-row data-year-row"><span>Active year</span>
              <select value={currentYear ?? ''} onChange={(event) => onYearChange(event.target.value || undefined)}>
                <option value="">All / latest</option>{years.map((year) => <option key={year}>{year}</option>)}
              </select>
            </label>
          )}

          <div className="section-title data-table-title">
            <span>Data preview · {rows.length} rows</span>
            <button className="text-button danger" onClick={() => onRowsChange([], { rowCount: 0 })}><Trash2 size={12} /> Clear</button>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th scope="col">Region</th><th scope="col">Value</th><th scope="col">Year</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>
                {rows.slice(0, 40).map((row) => (
                  <tr key={row.id}>
                    <td><input aria-label={`Region for row ${row.id}`} value={row.region} onChange={(event) => updateRow(row.id, { region: event.target.value })} /></td>
                    <td><input aria-label={`Value for ${row.region}`} value={String(row.value)} onChange={(event) => updateRow(row.id, { value: event.target.value })} /></td>
                    <td><input aria-label={`Year for ${row.region}`} value={row.year ?? ''} onChange={(event) => updateRow(row.id, { year: event.target.value || undefined })} /></td>
                    <td><button onClick={() => onRowsChange(rows.filter((item) => item.id !== row.id))} aria-label={`Remove ${row.region}`}><Trash2 size={12} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 40 && <p className="panel-note">Showing the first 40 rows. All {rows.length} rows remain active.</p>}
        </>
      )}

      <div className="panel-label">Source and provenance</div>
      <label className="production-field"><span>Publisher</span><input value={datasetMeta.publisher} onChange={(event) => onMetaChange({ publisher: event.target.value })} placeholder="e.g. MoSPI, Census of India" /></label>
      <label className="production-field"><span>Release date</span><input value={datasetMeta.releaseDate} onChange={(event) => onMetaChange({ releaseDate: event.target.value })} placeholder="2024-03-01" /></label>
      <label className="production-field"><span>Notes</span><input value={datasetMeta.notes} onChange={(event) => onMetaChange({ notes: event.target.value })} placeholder="Methodology, caveats, revisions" /></label>
      <label className="video-toggle">
        <span><strong>Synthetic demo data</strong><small>Labels every export as not a real measurement</small></span>
        <input type="checkbox" checked={datasetMeta.synthetic} onChange={(event) => onMetaChange({ synthetic: event.target.checked })} />
      </label>
      {datasetMeta.synthetic && <div className="synthetic-warning" role="status"><AlertTriangle size={14} /> This project is marked as synthetic demo data.</div>}

      <details className="source-details">
        <summary>Boundary sources and licences</summary>
        {sources.map((source) => (
          <div className="source-item" key={source.id}>
            <div className="source-topline"><strong>{source.organization}</strong><span className="source-dot" /></div>
            <small>{source.reference}</small>
            <span className="source-meta">{source.license} · {source.quality}</span>
          </div>
        ))}
      </details>
    </div>
  );
}
