import { useState } from 'react';
import { Braces, Download, FileSpreadsheet, FileText, Image, LoaderCircle, Presentation, Save, Table } from 'lucide-react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { ChartSpec } from '../domain/charts';
import { EXPORT_PRESETS, downloadBlob, exportComposition, sanitizeFilename, type CompositionExportFormat } from '../domain/exportComposition';
import type { DatasetMeta } from '../domain/dataSources';
import type { Annotation, DataRow, InfographicConfig, LegendItem } from '../domain/infographic';

type Props = {
  map: MapLibreMap | null;
  compositionId: string;
  config: InfographicConfig;
  chartOverrides: Record<string, Partial<ChartSpec>>;
  legend: LegendItem[];
  annotations: Annotation[];
  rows: DataRow[];
  currentYear?: string;
  datasetMeta: DatasetMeta;
  logoDataUrl?: string;
  fileStem: string;
  canExport: boolean;
  onToast: (message: string) => void;
};

const IMAGE_FORMATS: Array<{ id: CompositionExportFormat; label: string; detail: string; icon: JSX.Element }> = [
  { id: 'png', label: 'PNG', detail: 'Web and social', icon: <Image size={18} /> },
  { id: 'jpg', label: 'JPG', detail: 'Smaller file', icon: <Image size={18} /> },
  { id: 'svg', label: 'SVG', detail: 'Editable vector', icon: <Braces size={18} /> },
  { id: 'pdf', label: 'PDF', detail: 'Print and reports', icon: <FileText size={18} /> },
  { id: 'pptx', label: 'PPTX', detail: 'Slide deck', icon: <Presentation size={18} /> },
];

export function ExportStudioPanel({ map, compositionId, config, chartOverrides, legend, annotations, rows, currentYear, datasetMeta, logoDataUrl, fileStem, canExport, onToast }: Props) {
  const [presetId, setPresetId] = useState(EXPORT_PRESETS[0].id);
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState<CompositionExportFormat | null>(null);
  const preset = EXPORT_PRESETS.find((entry) => entry.id === presetId) ?? EXPORT_PRESETS[0];

  const run = async (format: CompositionExportFormat) => {
    if (!canExport) { onToast('Your role does not allow exporting this project.'); return; }
    setBusy(format);
    try {
      await exportComposition(format, {
        compositionId, config, rows, chartOverrides, legend, annotations, currentYear, datasetMeta, map, preset,
        transparent: transparent && format !== 'jpg' && !preset.printSafe,
        fileBase: fileStem,
        logoDataUrl,
      });
      onToast(`${format.toUpperCase()} exported at ${preset.width}×${preset.height}`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : `Could not export ${format.toUpperCase()}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel-content export-panel">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="panel-title-icon export-title-icon"><Download size={16} /></span>
          <div><h2>Export studio</h2><span>Publication ready</span></div>
        </div>
      </div>

      <label className="select-row"><span>Size preset</span>
        <select value={presetId} onChange={(event) => setPresetId(event.target.value)}>
          {EXPORT_PRESETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label} · {entry.detail}</option>)}
        </select>
      </label>
      <p className="panel-hint">{preset.width}×{preset.height}{preset.printSafe ? ' · print-safe, opaque background' : ''}</p>

      <label className="video-toggle">
        <span><strong>Transparent background</strong><small>PNG, SVG and PDF only. Ignored for JPG and print presets.</small></span>
        <input type="checkbox" checked={transparent} onChange={(event) => setTransparent(event.target.checked)} disabled={preset.printSafe} />
      </label>

      <div className="panel-label">Visual exports</div>
      <div className="export-format-grid">
        {IMAGE_FORMATS.map((format) => (
          <button key={format.id} onClick={() => void run(format.id)} disabled={Boolean(busy) || !canExport}>
            {busy === format.id ? <LoaderCircle className="spin" size={18} /> : format.icon}
            <strong>{format.label}</strong>
            <small>{format.detail}</small>
          </button>
        ))}
      </div>

      <div className="panel-label">Data and project</div>
      <button className="outline-button wide" onClick={() => void run('csv')} disabled={!rows.length}><Table size={14} /> Download data as CSV</button>
      <button className="outline-button wide" onClick={() => void run('xlsx')} disabled={!rows.length}><FileSpreadsheet size={14} /> Download data as XLSX</button>
      <button
        className="outline-button wide"
        onClick={() => {
          const payload = JSON.stringify({ version: 2, savedAt: new Date().toISOString(), compositionId, config, chartOverrides, rows, annotations, currentYear, datasetMeta }, null, 2);
          downloadBlob(new Blob([payload], { type: 'application/json;charset=utf-8' }), `${sanitizeFilename(fileStem)}-project.json`);
          onToast('Project JSON saved');
        }}
      >
        <Save size={14} /> Save editable project JSON
      </button>

      <p className="panel-note">Every visual export embeds the title, legend, source line and attribution. Charts are drawn from the same dataset as the map, so exports match the editor.</p>
      {datasetMeta.synthetic && <p className="panel-note">This project is marked as synthetic demo data, and exports say so in the source line.</p>}
    </div>
  );
}
