import type { ReactNode } from 'react';
import { ChartSurface } from './ChartSurface';
import type { ChartSpec } from '../domain/charts';
import { resolveChartSpec, type Composition, type CompositionBlock } from '../domain/composition';
import type { DataRow, InfographicConfig } from '../domain/infographic';

type Props = {
  composition: Composition;
  config: InfographicConfig;
  rows: DataRow[];
  currentYear?: string;
  chartOverrides: Record<string, Partial<ChartSpec>>;
  /** The live MapCanvas. Rendered into whichever block is the map slot. */
  mapSlot: ReactNode;
  selectedBlockId?: string;
  onSelectBlock?: (blockId: string) => void;
};

/**
 * Lays the composition's blocks out in percentage space so a single definition
 * works at 16:9, 9:16, 1:1 and A4 without a second set of coordinates.
 */
export function CompositionCanvas({ composition, config, rows, currentYear, chartOverrides, mapSlot, selectedBlockId, onSelectBlock }: Props) {
  return (
    <div className="composition-canvas" style={{ background: config.background }}>
      {composition.blocks.map((block) => (
        <div
          key={block.id}
          className={`composition-block block-${block.type} ${selectedBlockId === block.id ? 'selected' : ''}`}
          style={{ left: `${block.x}%`, top: `${block.y}%`, width: `${block.width}%`, height: `${block.height}%` }}
          onClick={onSelectBlock ? () => onSelectBlock(block.id) : undefined}
        >
          {renderBlock(block, { composition, config, rows, currentYear, chartOverrides, mapSlot })}
        </div>
      ))}
    </div>
  );
}

function renderBlock(block: CompositionBlock, context: Omit<Props, 'selectedBlockId' | 'onSelectBlock'>) {
  const { config, rows, currentYear, chartOverrides, mapSlot } = context;
  if (block.type === 'map') return <div className="composition-map-slot">{mapSlot}</div>;
  if (block.type === 'headline') {
    return (
      <div className="composition-headline">
        {config.showTitle && <h2>{config.title || 'Untitled data story'}</h2>}
        {config.subtitle && <p>{config.subtitle}</p>}
        {currentYear && <span className="composition-year">{currentYear}</span>}
      </div>
    );
  }
  if (block.type === 'source') {
    return (
      <div className="composition-source">
        {config.showSource && <span>{config.source}</span>}
        {config.note && <small>{config.note}</small>}
      </div>
    );
  }
  if (block.type === 'note') return <p className="composition-note">{block.text ?? config.note}</p>;
  if (block.type === 'chart' || block.type === 'kpi') {
    const spec = resolveChartSpec(block, chartOverrides);
    return <ChartSurface spec={spec} rows={rows} config={config} currentYear={currentYear} width={640} height={420} className="composition-chart" />;
  }
  return null;
}
