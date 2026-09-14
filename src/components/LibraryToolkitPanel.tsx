import { useRef, useState } from 'react';
import { Activity, BarChart3, Box, Check, Database, Globe2, GitBranch, Layers3, Loader2, Network, Sparkles, Table2 } from 'lucide-react';
import { renderVegaChart } from '../integrations/vegaChart';
import { smokeTestArrow, smokeTestCollaboration, smokeTestDeckGl, smokeTestDuckDb, smokeTestFlow, smokeTestGridLayout, smokeTestObservability, smokeTestPmtiles, smokeTestTanStackQuery, smokeTestTanStackTable, smokeTestVega, type LibrarySmokeResult } from '../integrations/libraryAdapters';
import type { VisualizationSpec } from 'vega-embed';

type LibraryCard = { id: string; name: string; description: string; icon: typeof BarChart3; test: () => Promise<LibrarySmokeResult> };

const libraries: LibraryCard[] = [
  { id: 'deck', name: 'deck.gl', description: 'GPU scatter, heatmap, hexagon, arc, and grid layers for large datasets.', icon: Layers3, test: smokeTestDeckGl },
  { id: 'pmtiles', name: 'PMTiles', description: 'Range-request vector tiles from Cloudflare R2 without a tile server.', icon: Globe2, test: smokeTestPmtiles },
  { id: 'duckdb', name: 'DuckDB-WASM', description: 'Run analytical SQL in the browser beside Apache Arrow tables.', icon: Database, test: smokeTestDuckDb },
  { id: 'arrow', name: 'Apache Arrow', description: 'Compact columnar data interchange for charts and analytics.', icon: Activity, test: smokeTestArrow },
  { id: 'vega', name: 'Vega-Lite', description: 'Portable, declarative chart specifications for reports and dashboards.', icon: BarChart3, test: smokeTestVega },
  { id: 'flow', name: 'React Flow', description: 'Build node-based data stories and transformation pipelines.', icon: GitBranch, test: smokeTestFlow },
  { id: 'table', name: 'TanStack Table', description: 'Headless sortable, filterable tables for data-rich dashboards.', icon: Table2, test: smokeTestTanStackTable },
  { id: 'query', name: 'TanStack Query', description: 'Cache remote datasets and keep server state fresh.', icon: Database, test: smokeTestTanStackQuery },
  { id: 'grid', name: 'React Grid Layout', description: 'Responsive, draggable dashboard layouts with persistent positions.', icon: Layers3, test: smokeTestGridLayout },
  { id: 'collab', name: 'Yjs collaboration', description: 'Offline-first CRDT state, ready for an optional WebSocket provider.', icon: Network, test: smokeTestCollaboration },
  { id: 'otel', name: 'OpenTelemetry', description: 'Trace imports, rendering, and export jobs when telemetry is enabled.', icon: Activity, test: smokeTestObservability },
];

const sampleSpec: VisualizationSpec = {
  $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
  title: 'VizBridge sample',
  data: { values: [{ region: 'Delhi', value: 86 }, { region: 'Mumbai', value: 74 }, { region: 'Bengaluru', value: 68 }, { region: 'Kolkata', value: 55 }] },
  mark: { type: 'bar', cornerRadiusTopLeft: 5, cornerRadiusTopRight: 5, color: '#8b5cf6' },
  encoding: {
    x: { field: 'region', type: 'nominal', sort: '-y', axis: { labelAngle: 0 } },
    y: { field: 'value', type: 'quantitative', title: 'Signal' },
    tooltip: [{ field: 'region', type: 'nominal' }, { field: 'value', type: 'quantitative' }],
  },
};

export function LibraryToolkitPanel() {
  const [status, setStatus] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const run = async (library: LibraryCard) => {
    setBusy(library.id);
    try {
      const result = await library.test();
      setStatus((current) => ({ ...current, [library.id]: result.detail }));
    } catch (error) {
      setStatus((current) => ({ ...current, [library.id]: error instanceof Error ? error.message : 'Could not load library' }));
    } finally {
      setBusy(null);
    }
  };

  const renderChart = async () => {
    if (!chartRef.current) return;
    setBusy('chart');
    try {
      chartRef.current.replaceChildren();
      await renderVegaChart(chartRef.current, sampleSpec);
      setStatus((current) => ({ ...current, chart: 'Rendered from a portable Vega-Lite spec' }));
    } catch (error) {
      setStatus((current) => ({ ...current, chart: error instanceof Error ? error.message : 'Could not render chart' }));
    } finally {
      setBusy(null);
    }
  };

  return <div className="panel-content library-toolkit-panel">
    <div className="panel-heading"><div className="panel-heading-icon"><Sparkles size={16} /></div><div><span className="eyebrow">EXTENSIBLE TOOLKIT</span><h2>Advanced libraries</h2><p>GPU maps, browser analytics, portable charts, collaboration, and observability.</p></div></div>
    <div className="toolkit-callout"><Box size={16} /><span>Everything is opt-in. Existing MapLibre, Three.js, and native chart blocks remain the fast default.</span></div>
    <div className="library-grid">{libraries.map((library) => { const Icon = library.icon; const message = status[library.id]; return <article className="library-card" key={library.id}><div className="library-card-title"><span className="library-icon"><Icon size={16} /></span><div><strong>{library.name}</strong><span>{library.description}</span></div></div><button className="outline-button" onClick={() => void run(library)} disabled={busy !== null}>{busy === library.id ? <Loader2 size={14} className="spin" /> : message ? <Check size={14} /> : <Sparkles size={14} />}{message ? 'Ready' : 'Test integration'}</button>{message && <small className="library-status">{message}</small>}</article>; })}</div>
    <div className="vega-demo"><div className="section-title"><span><BarChart3 size={14} /> Portable chart contract</span><button className="outline-button" onClick={() => void renderChart()} disabled={busy !== null}>{busy === 'chart' ? <Loader2 size={14} className="spin" /> : 'Render Vega-Lite'}</button></div><div className="vega-chart" ref={chartRef} />{status.chart && <small className="library-status">{status.chart}</small>}</div>
  </div>;
}
