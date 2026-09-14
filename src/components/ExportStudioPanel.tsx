import { useState } from 'react';
import { Braces, Check, Download, FileSpreadsheet, FileText, Image, LoaderCircle, Presentation, Save, ShieldCheck, Table, Trash2, Upload } from 'lucide-react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { ChartSpec } from '../domain/charts';
import { EXPORT_PRESETS, downloadBlob, exportComposition, sanitizeFilename, type CompositionExportFormat } from '../domain/exportComposition';
import type { DatasetMeta } from '../domain/dataSources';
import type { Annotation, DataRow, InfographicConfig, LegendItem } from '../domain/infographic';
import { hasWatermarkContent, normalizeWatermark, readWatermarkFile, type WatermarkSettings } from '../domain/watermark';

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
  watermark: WatermarkSettings;
  canUseCustomWatermark: boolean;
  onWatermark: (watermark: WatermarkSettings) => void;
  onToast: (message: string) => void;
};

const IMAGE_FORMATS: Array<{ id: CompositionExportFormat; label: string; detail: string; icon: JSX.Element }> = [
  { id: 'png', label: 'PNG', detail: 'Web and social', icon: <Image size={18} /> },
  { id: 'jpg', label: 'JPG', detail: 'Smaller file', icon: <Image size={18} /> },
  { id: 'svg', label: 'SVG', detail: 'Editable vector', icon: <Braces size={18} /> },
  { id: 'pdf', label: 'PDF', detail: 'Print and reports', icon: <FileText size={18} /> },
  { id: 'pptx', label: 'PPTX', detail: 'Slide deck', icon: <Presentation size={18} /> },
];

export function ExportStudioPanel({ map, compositionId, config, chartOverrides, legend, annotations, rows, currentYear, datasetMeta, logoDataUrl, fileStem, canExport, watermark, canUseCustomWatermark, onWatermark, onToast }: Props) {
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
        watermark,
      });
      onToast(`${format.toUpperCase()} exported at ${preset.width}×${preset.height}`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : `Could not export ${format.toUpperCase()}`);
    } finally {
      setBusy(null);
    }
  };

  const updateWatermark = (change: Partial<WatermarkSettings>) => onWatermark(normalizeWatermark({ ...watermark, ...change }));
  const uploadWatermark = async (file?: File) => {
    if (!file || !canUseCustomWatermark) return;
    try {
      const dataUrl = await readWatermarkFile(file);
      onWatermark(normalizeWatermark({ ...watermark, enabled: true, dataUrl, fileName: file.name }));
      onToast('Watermark added to this project');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not add the watermark');
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

      <div className="panel-label">Custom watermark <span className="pro-badge">PRO</span></div>
      {!canUseCustomWatermark ? (
        <div className="watermark-locked">
          <ShieldCheck size={17} />
          <div><strong>Use your own watermark on exports</strong><span>Custom watermarking is included with paid VizBridge plans.</span></div>
        </div>
      ) : (
        <div className="watermark-card">
          <label className="video-toggle watermark-toggle">
            <span><strong>Include watermark</strong><small>Applied to PNG, JPG, SVG, PDF and PPTX exports.</small></span>
            <input type="checkbox" checked={watermark.enabled && hasWatermarkContent(watermark)} onChange={(event) => updateWatermark({ enabled: event.target.checked })} disabled={!hasWatermarkContent(watermark)} />
          </label>
          <label className="watermark-upload">
            <Upload size={15} />
            <span>{watermark.fileName || 'Upload logo or watermark image'}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => { void uploadWatermark(event.target.files?.[0]); event.currentTarget.value = ''; }} />
          </label>
          <label className="production-field"><span>Watermark text (optional)</span><input value={watermark.text ?? ''} onChange={(event) => updateWatermark({ text: event.target.value, enabled: Boolean(event.target.value.trim()) || watermark.enabled })} placeholder="Your brand or publication" /></label>
          <div className="watermark-grid">
            <label className="select-row"><span>Position</span><select value={watermark.position} onChange={(event) => updateWatermark({ position: event.target.value as WatermarkSettings['position'] })}><option value="top-left">Top left</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option><option value="center">Center</option></select></label>
            <label className="range-row"><span>Opacity</span><output>{Math.round(watermark.opacity * 100)}%</output><input type="range" min="5" max="100" value={Math.round(watermark.opacity * 100)} onChange={(event) => updateWatermark({ opacity: Number(event.target.value) / 100 })} /></label>
            <label className="range-row"><span>Size</span><output>{watermark.size}%</output><input type="range" min="4" max="32" value={watermark.size} onChange={(event) => updateWatermark({ size: Number(event.target.value) })} /></label>
          </div>
          {(watermark.dataUrl || watermark.text) && <div className="watermark-status"><Check size={13} /> <span>{watermark.dataUrl ? 'Image ready' : 'Text watermark ready'}</span><button className="text-button" onClick={() => onWatermark({ ...normalizeWatermark(watermark), dataUrl: undefined, fileName: undefined, text: undefined, enabled: false })}><Trash2 size={13} /> Clear</button></div>}
        </div>
      )}

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
