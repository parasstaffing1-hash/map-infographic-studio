import { useRef, useState } from 'react';
import { AlertTriangle, Check, Database, Download, FileSpreadsheet, Trash2, Upload } from 'lucide-react';
import { downloadTextFile } from '../domain/exportInfographic';
import { parseDelimitedText, parseSpreadsheetFile, rowsToDelimited, starterRowsForFeatures, type DataRow, type VisualizationResult } from '../domain/infographic';
import type { GeoFeature, ProvenanceSource } from '../domain/types';

type Props = {
  rows: DataRow[];
  features: GeoFeature[];
  years: string[];
  currentYear?: string;
  result: VisualizationResult;
  sources: ProvenanceSource[];
  onRowsChange: (rows: DataRow[]) => void;
  onYearChange: (year?: string) => void;
  onToast: (message: string) => void;
};

const SAMPLE = `Region,Value,Year\nDelhi,16879941,2021\nMaharashtra,124904071,2021\nTamil Nadu,77841267,2021`;

export function DataBindingPanel({ rows, features, years, currentYear, result, sources, onRowsChange, onYearChange, onToast }: Props) {
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const applyRows = (nextRows: DataRow[], label: string) => {
    if (!nextRows.length) {
      onToast('No usable Region and Value rows were found');
      return;
    }
    onRowsChange(nextRows);
    onYearChange(undefined);
    onToast(`${nextRows.length} data rows added from ${label}`);
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      applyRows(await parseSpreadsheetFile(file), file.name);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not read the spreadsheet');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const updateRow = (id: string, patch: Partial<DataRow>) => onRowsChange(rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  const problemRows = [...result.unmatchedRows, ...result.ambiguousRows];

  return (
    <div className="panel-content data-binding-panel">
      <div className="panel-heading"><div className="panel-title"><span className="panel-title-icon"><Database size={16} /></span><div><h2>Bind your data</h2><span>CSV, Excel, or pasted table</span></div></div></div>
      <div className="data-import-card">
        <label htmlFor="data-paste"><strong>Paste a table</strong><small>Required: Region and Value. Optional: Year and Parent.</small></label>
        <textarea id="data-paste" value={paste} onChange={(event) => setPaste(event.target.value)} placeholder={SAMPLE} />
        <div className="data-action-row">
          <button className="primary-button" onClick={() => applyRows(parseDelimitedText(paste), 'pasted data')} disabled={!paste.trim()}><FileSpreadsheet size={14} /> Apply data</button>
          <button className="outline-button" onClick={() => inputRef.current?.click()} disabled={busy}><Upload size={14} /> {busy ? 'Reading…' : 'Upload'}</button>
          <input ref={inputRef} className="sr-only" type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={(event) => void importFile(event.target.files?.[0])} />
        </div>
        <button className="text-link-button" onClick={() => downloadTextFile(rowsToDelimited(starterRowsForFeatures(features)), 'map-data-template.csv', 'text/csv;charset=utf-8')} disabled={!features.length}><Download size={13} /> Download template for this map</button>
      </div>

      {rows.length > 0 && <>
        <div className="match-summary">
          <div className="match-good"><Check size={15} /><span><strong>{result.matchedRows}</strong> matched</span></div>
          <div className={problemRows.length ? 'match-bad' : 'match-good'}>{problemRows.length ? <AlertTriangle size={15} /> : <Check size={15} />}<span><strong>{problemRows.length}</strong> need review</span></div>
        </div>
        {years.length > 0 && <label className="select-row data-year-row"><span>Active year</span><select value={currentYear ?? ''} onChange={(event) => onYearChange(event.target.value || undefined)}><option value="">All / latest</option>{years.map((year) => <option key={year}>{year}</option>)}</select></label>}
        <div className="section-title data-table-title"><span>Data preview · {rows.length} rows</span><button className="text-button danger" onClick={() => onRowsChange([])}><Trash2 size={12} /> Clear</button></div>
        <div className="data-table-wrap">
          <table className="data-table"><thead><tr><th>Region</th><th>Value</th><th>Year</th><th /></tr></thead><tbody>{rows.slice(0, 40).map((row) => <tr key={row.id}><td><input value={row.region} onChange={(event) => updateRow(row.id, { region: event.target.value })} /></td><td><input value={String(row.value)} onChange={(event) => updateRow(row.id, { value: event.target.value })} /></td><td><input value={row.year ?? ''} onChange={(event) => updateRow(row.id, { year: event.target.value || undefined })} /></td><td><button onClick={() => onRowsChange(rows.filter((item) => item.id !== row.id))} aria-label={`Remove ${row.region}`}><Trash2 size={12} /></button></td></tr>)}</tbody></table>
        </div>
        {rows.length > 40 && <p className="panel-note">Showing the first 40 rows. All {rows.length} rows remain active.</p>}
        {problemRows.length > 0 && <div className="unmatched-card"><strong>Check region names</strong><span>{problemRows.slice(0, 8).map((row) => row.region).join(', ')}{problemRows.length > 8 ? ` +${problemRows.length - 8} more` : ''}</span></div>}
      </>}

      <details className="source-details"><summary>Boundary sources and licences</summary>{sources.map((source) => <div className="source-item" key={source.id}><div className="source-topline"><strong>{source.organization}</strong><span className="source-dot" /></div><small>{source.reference}</small><span className="source-meta">{source.license} · {source.quality}</span></div>)}</details>
    </div>
  );
}
