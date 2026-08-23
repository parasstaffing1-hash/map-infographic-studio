import { useState } from 'react';
import { Braces, Download, FileImage, FileText, Image, LoaderCircle, Save } from 'lucide-react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { downloadTextFile, exportInfographic, type ExportFormat } from '../domain/exportInfographic';
import { rowsToDelimited, type Annotation, type DataRow, type InfographicConfig, type LegendItem } from '../domain/infographic';

type Props = {
  map: MapLibreMap | null;
  config: InfographicConfig;
  legend: LegendItem[];
  annotations: Annotation[];
  rows: DataRow[];
  currentYear?: string;
  fileStem: string;
  onToast: (message: string) => void;
};

export function ExportPanel({ map, config, legend, annotations, rows, currentYear, fileStem, onToast }: Props) {
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const runExport = async (format: ExportFormat) => {
    if (!map) {
      onToast('The map is still loading');
      return;
    }
    setExporting(format);
    try {
      await exportInfographic(format, { map, config, legend, annotations, activeYear: currentYear, fileBase: fileStem });
      onToast(`${format.toUpperCase()} infographic downloaded`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : `Could not export ${format.toUpperCase()}`);
    } finally {
      setExporting(null);
    }
  };

  return <div className="panel-content export-panel"><div className="panel-heading"><div className="panel-title"><span className="panel-title-icon export-title-icon"><Download size={16} /></span><div><h2>Export studio</h2><span>High-resolution, publication ready</span></div></div></div><div className="export-preview-card"><FileImage size={21} /><div><strong>{config.aspect} infographic</strong><span>{config.resolution === '4k' ? '4K master' : 'HD master'} · title, legend, source, annotations</span></div></div><div className="panel-label">Visual exports</div><div className="export-format-grid"><button onClick={() => void runExport('png')} disabled={Boolean(exporting)}>{exporting === 'png' ? <LoaderCircle className="spin" size={18} /> : <Image size={18} />}<strong>PNG</strong><small>Social & web</small></button><button onClick={() => void runExport('svg')} disabled={Boolean(exporting)}>{exporting === 'svg' ? <LoaderCircle className="spin" size={18} /> : <Braces size={18} />}<strong>SVG</strong><small>Editable vector shell</small></button><button onClick={() => void runExport('pdf')} disabled={Boolean(exporting)}>{exporting === 'pdf' ? <LoaderCircle className="spin" size={18} /> : <FileText size={18} />}<strong>PDF</strong><small>Print & reports</small></button></div><div className="panel-label">Data and project</div><button className="outline-button wide" onClick={() => downloadTextFile(rowsToDelimited(rows), `${fileStem}-data.csv`, 'text/csv;charset=utf-8')} disabled={!rows.length}><Download size={14} /> Download matched data CSV</button><button className="outline-button wide" onClick={() => downloadTextFile(JSON.stringify({ version: 1, savedAt: new Date().toISOString(), config, rows, annotations, currentYear }, null, 2), `${fileStem}-project.json`, 'application/json;charset=utf-8')}><Save size={14} /> Save editable project JSON</button><p className="panel-note">Exports include your title, year, legend, source line, and draggable annotations. The interactive map remains editable after export.</p></div>;
}
