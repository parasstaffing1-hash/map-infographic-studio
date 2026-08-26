import { useMemo, useState } from 'react';
import { BarChart3, LayoutTemplate, Sparkles, Trash2 } from 'lucide-react';
import { CHART_KINDS, chartFields, DEFAULT_CHART_SPEC, type ChartSpec } from '../domain/charts';
import { chartBlocks, COMPOSITIONS, compositionById, resolveChartSpec, type CompositionSurface } from '../domain/composition';
import type { DataRow } from '../domain/infographic';

type Props = {
  compositionId: string;
  chartOverrides: Record<string, Partial<ChartSpec>>;
  rows: DataRow[];
  years: string[];
  onComposition: (compositionId: string) => void;
  onChartOverride: (blockId: string, patch: Partial<ChartSpec>) => void;
  onResetOverrides: () => void;
  onToast: (message: string) => void;
};

const SURFACES: Array<{ id: CompositionSurface | 'All'; label: string }> = [
  { id: 'All', label: 'All' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'social', label: 'Social' },
  { id: 'story', label: 'Story' },
  { id: 'presentation', label: 'Slides' },
  { id: 'report', label: 'Report' },
];

export function ChartStudioPanel({ compositionId, chartOverrides, rows, years, onComposition, onChartOverride, onResetOverrides, onToast }: Props) {
  const [surface, setSurface] = useState<CompositionSurface | 'All'>('All');
  const composition = compositionById(compositionId);
  const blocks = chartBlocks(composition);
  const [selectedBlockId, setSelectedBlockId] = useState<string | undefined>(blocks[0]?.id);
  const fields = useMemo(() => chartFields(rows), [rows]);
  const visible = surface === 'All' ? COMPOSITIONS : COMPOSITIONS.filter((entry) => entry.surface === surface);
  const activeBlock = blocks.find((block) => block.id === selectedBlockId) ?? blocks[0];
  const spec = activeBlock ? resolveChartSpec(activeBlock, chartOverrides) : DEFAULT_CHART_SPEC;

  const patch = (change: Partial<ChartSpec>) => {
    if (!activeBlock) return;
    onChartOverride(activeBlock.id, change);
  };

  return (
    <div className="panel-content chart-studio-panel">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="panel-title-icon"><BarChart3 size={16} /></span>
          <div><h2>Charts &amp; layout</h2><span>Compose the map with charts</span></div>
        </div>
      </div>

      <p className="panel-note"><Sparkles size={14} /> Switching a layout keeps your imported data, title and source.</p>

      <div className="chip-row" role="tablist" aria-label="Layout surface">
        {SURFACES.map((entry) => (
          <button key={entry.id} role="tab" aria-selected={surface === entry.id} className={`chip ${surface === entry.id ? 'active' : ''}`} onClick={() => setSurface(entry.id)}>{entry.label}</button>
        ))}
      </div>

      <div className="panel-label">Layout</div>
      <div className="composition-grid">
        {visible.map((entry) => (
          <button
            key={entry.id}
            className={`composition-card ${entry.id === compositionId ? 'active' : ''}`}
            aria-pressed={entry.id === compositionId}
            onClick={() => { onComposition(entry.id); onToast(`${entry.label} layout applied · data kept`); }}
          >
            <span className="composition-thumb" aria-hidden="true">
              {entry.blocks.map((block) => (
                <i key={block.id} className={`thumb-block thumb-${block.type}`} style={{ left: `${block.x}%`, top: `${block.y}%`, width: `${block.width}%`, height: `${block.height}%` }} />
              ))}
            </span>
            <strong>{entry.label}</strong>
            <small>{entry.detail}</small>
          </button>
        ))}
      </div>

      {blocks.length === 0 ? (
        <p className="panel-note"><LayoutTemplate size={14} /> This layout is map-only. Pick a layout with charts to configure a chart.</p>
      ) : (
        <>
          <div className="panel-label">Chart slot</div>
          <div className="chip-row">
            {blocks.map((block) => (
              <button key={block.id} className={`chip ${block.id === activeBlock?.id ? 'active' : ''}`} onClick={() => setSelectedBlockId(block.id)}>{block.id}</button>
            ))}
          </div>

          <label className="select-row"><span>Chart type</span>
            <select value={spec.kind} onChange={(event) => patch({ kind: event.target.value as ChartSpec['kind'] })}>
              {CHART_KINDS.map((kind) => (
                <option key={kind.id} value={kind.id} disabled={kind.needsYears && years.length === 0}>
                  {kind.label}{kind.needsYears && years.length === 0 ? ' · needs a Year column' : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="panel-hint">{CHART_KINDS.find((kind) => kind.id === spec.kind)?.detail}</p>

          <label className="select-row"><span>Value column</span>
            <select value={spec.valueField ?? ''} onChange={(event) => patch({ valueField: event.target.value || undefined })}>
              <option value="">Shared map value</option>
              {fields.numeric.map((field) => <option key={field} value={field}>{field}</option>)}
            </select>
          </label>

          <label className="select-row"><span>Group by</span>
            <select value={spec.categoryField ?? ''} onChange={(event) => patch({ categoryField: event.target.value || undefined })}>
              <option value="">Region</option>
              {fields.text.map((field) => <option key={field} value={field}>{field}</option>)}
            </select>
          </label>

          {(spec.kind === 'scatter' || spec.kind === 'bubble') && (
            <>
              <label className="select-row"><span>Horizontal axis</span>
                <select value={spec.secondaryField ?? ''} onChange={(event) => patch({ secondaryField: event.target.value || undefined })}>
                  <option value="">Rank</option>
                  {fields.numeric.map((field) => <option key={field} value={field}>{field}</option>)}
                </select>
              </label>
              {spec.kind === 'bubble' && (
                <label className="select-row"><span>Bubble size</span>
                  <select value={spec.sizeField ?? ''} onChange={(event) => patch({ sizeField: event.target.value || undefined })}>
                    <option value="">Same as value</option>
                    {fields.numeric.map((field) => <option key={field} value={field}>{field}</option>)}
                  </select>
                </label>
              )}
            </>
          )}

          <label className="select-row"><span>Sort</span>
            <select value={spec.sort} onChange={(event) => patch({ sort: event.target.value as ChartSpec['sort'] })}>
              <option value="value-desc">Highest first</option>
              <option value="value-asc">Lowest first</option>
              <option value="name">Name A–Z</option>
              <option value="source">Source order</option>
            </select>
          </label>

          <label className="range-row"><span>Show top</span><output>{spec.limit || 'all'}</output>
            <input type="range" min="0" max="30" step="1" value={spec.limit} onChange={(event) => patch({ limit: Number(event.target.value) })} />
          </label>

          <label className="select-row"><span>Reference line</span>
            <input type="number" value={spec.target ?? ''} placeholder="none" onChange={(event) => patch({ target: event.target.value === '' ? undefined : Number(event.target.value) })} />
          </label>

          <div className="toggle-row">
            <label><input type="checkbox" checked={spec.showValues} onChange={(event) => patch({ showValues: event.target.checked })} /> Value labels</label>
            <label><input type="checkbox" checked={spec.showLegend} onChange={(event) => patch({ showLegend: event.target.checked })} /> Legend</label>
            <label><input type="checkbox" checked={spec.showGrid} onChange={(event) => patch({ showGrid: event.target.checked })} /> Gridlines</label>
          </div>

          <button className="outline-button wide" onClick={() => { onResetOverrides(); onToast('Chart settings reset to the layout defaults'); }}>
            <Trash2 size={14} /> Reset chart settings
          </button>
        </>
      )}
    </div>
  );
}
