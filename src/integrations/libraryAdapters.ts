/**
 * Optional adapters for the advanced VizBridge toolchain.
 *
 * The heavy visualization engines stay behind dynamic imports so the core
 * editor keeps its fast startup and existing MapLibre/Three.js paths remain
 * the default. The toolkit panel can opt into each capability on demand.
 */

export type LibrarySmokeResult = {
  name: string;
  detail: string;
};

export async function smokeTestDeckGl(): Promise<LibrarySmokeResult> {
  const { ScatterplotLayer } = await import('@deck.gl/layers');
  const layer = new ScatterplotLayer({ id: 'vizbridge-smoke', data: [{ position: [0, 0] }] });
  return { name: 'deck.gl', detail: `GPU layer ready (${layer.id})` };
}

export async function smokeTestArrow(): Promise<LibrarySmokeResult> {
  const { tableFromJSON } = await import('apache-arrow');
  const table = tableFromJSON([{ region: 'Delhi', value: 16879941 }, { region: 'Mumbai', value: 124904071 }]);
  return { name: 'Apache Arrow', detail: `columnar table ready (${table.numRows} rows)` };
}

export async function smokeTestDuckDb(): Promise<LibrarySmokeResult> {
  // Importing the WASM package is deliberately deferred. Instantiating a
  // database is done only after the user asks for it, avoiding a worker and a
  // multi-megabyte WASM download during normal editor startup.
  const duckdb = await import('@duckdb/duckdb-wasm');
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);
  return { name: 'DuckDB-WASM', detail: `browser SQL bundle ready (${bundle.mainModule ? 'WASM' : 'fallback'})` };
}

export async function smokeTestVega(): Promise<LibrarySmokeResult> {
  const [{ default: vega }, { default: vegaLite }] = await Promise.all([
    import('vega'),
    import('vega-lite'),
  ]);
  const spec = vegaLite.compile({
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    data: { values: [{ label: 'VizBridge', value: 1 }] },
    mark: 'bar',
    encoding: { x: { field: 'label', type: 'nominal' }, y: { field: 'value', type: 'quantitative' } },
  });
  // Parsing a compiled spec is a cheap, browser-safe validation of the chart
  // contract; actual DOM rendering happens in the toolkit panel.
  new vega.View(vega.parse(spec.spec));
  return { name: 'Vega-Lite', detail: 'declarative chart spec compiled' };
}

export async function smokeTestPmtiles(): Promise<LibrarySmokeResult> {
  const { PMTiles } = await import('pmtiles');
  const source = new PMTiles('https://example.com/vizbridge.pmtiles');
  return { name: 'PMTiles', detail: 'HTTP range source ready' };
}

export async function smokeTestCollaboration(): Promise<LibrarySmokeResult> {
  const { Doc } = await import('yjs');
  const doc = new Doc();
  const state = doc.getMap('vizbridge');
  state.set('status', 'ready');
  return { name: 'Yjs', detail: `offline CRDT document ready (${String(state.get('status'))})` };
}

export async function smokeTestFlow(): Promise<LibrarySmokeResult> {
  const { Position } = await import('@xyflow/react');
  return { name: 'React Flow', detail: `story graph primitives ready (${Position.Left})` };
}

export async function smokeTestObservability(): Promise<LibrarySmokeResult> {
  const { trace } = await import('@opentelemetry/api');
  const span = trace.getTracer('vizbridge').startSpan('library-smoke-test');
  span.end();
  return { name: 'OpenTelemetry', detail: 'instrumentation API ready' };
}
