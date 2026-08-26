import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { ChartSurface } from './ChartSurface';
import type { ChartSpec } from '../domain/charts';
import { blocksForAspect, resolveChartSpec, type Composition, type CompositionBlock } from '../domain/composition';
import type { CanvasAspect, DataRow, InfographicConfig } from '../domain/infographic';

type Props = {
  composition: Composition;
  config: InfographicConfig;
  rows: DataRow[];
  currentYear?: string;
  chartOverrides: Record<string, Partial<ChartSpec>>;
  /** The live MapCanvas. Rendered into whichever block is the map slot. */
  mapSlot: ReactNode;
  /**
   * Map chrome (legend, scale chip, callout, annotations). Rendered INSIDE the
   * map block so it can never cover a chart. Use `<MapOverlays />`.
   */
  mapOverlays?: ReactNode;
  /**
   * Canvas aspect. Drives the per-aspect geometry overrides. Defaults to the
   * composition's own aspect; pass `config.aspect` so the user's canvas choice
   * wins.
   */
  aspect?: CanvasAspect;
  /**
   * Editor-only affordances: selection outlines, block click targets, hover
   * states. Clean previews, exports and server video frames pass false.
   */
  editorChrome?: boolean;
  selectedBlockId?: string;
  onSelectBlock?: (blockId: string) => void;
};

/**
 * Lays the composition's blocks out in percentage space so a single definition
 * works at 16:9, 9:16, 1:1 and A4 without a second set of coordinates.
 *
 * Every block is a hard rectangle: `overflow: hidden` plus zeroed min-sizes in
 * CSS mean a long title, a wide table or a map legend cannot escape its slot.
 */
export function CompositionCanvas({
  composition,
  config,
  rows,
  currentYear,
  chartOverrides,
  mapSlot,
  mapOverlays,
  aspect,
  editorChrome = true,
  selectedBlockId,
  onSelectBlock,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => blocksForAspect(composition, aspect ?? config.aspect ?? composition.aspect), [aspect, composition, config.aspect]);
  const mapBlock = useMemo(() => blocks.find((block) => block.type === 'map'), [blocks]);

  // Publish the map block's rectangle onto the frame so legacy frame-level map
  // chrome (legend, callout, annotation layer, tabs) that App still renders as
  // a sibling can be pinned to the MAP rather than to the whole canvas.
  useLayoutEffect(() => {
    const frame = rootRef.current?.parentElement;
    if (!frame) return undefined;
    const set = (name: string, value: string) => frame.style.setProperty(name, value);
    if (mapBlock) {
      set('--map-block-x', `${mapBlock.x}%`);
      set('--map-block-y', `${mapBlock.y}%`);
      set('--map-block-w', `${mapBlock.width}%`);
      set('--map-block-h', `${mapBlock.height}%`);
      set('--map-chrome-display', 'block');
      set('--map-chrome-display-flex', 'flex');
    } else {
      set('--map-block-x', '0%');
      set('--map-block-y', '0%');
      set('--map-block-w', '0%');
      set('--map-block-h', '0%');
      set('--map-chrome-display', 'none');
      set('--map-chrome-display-flex', 'none');
    }
    return () => {
      for (const name of ['--map-block-x', '--map-block-y', '--map-block-w', '--map-block-h', '--map-chrome-display', '--map-chrome-display-flex']) {
        frame.style.removeProperty(name);
      }
    };
  }, [mapBlock]);

  return (
    <div
      ref={rootRef}
      className={`composition-canvas ${editorChrome ? '' : 'chrome-off'} ${mapBlock ? '' : 'no-map'}`.trim()}
      style={{ background: config.background }}
      data-composition={composition.id}
    >
      {blocks.map((block) => {
        const selectable = editorChrome && !!onSelectBlock;
        return (
          <div
            key={block.id}
            className={`composition-block block-${block.type} ${selectable ? 'selectable' : ''} ${editorChrome && selectedBlockId === block.id ? 'selected' : ''}`.replace(/\s+/g, ' ').trim()}
            style={{ left: `${block.x}%`, top: `${block.y}%`, width: `${block.width}%`, height: `${block.height}%` }}
            onClick={selectable ? () => onSelectBlock?.(block.id) : undefined}
          >
            {renderBlock(block, { composition, config, rows, currentYear, chartOverrides, mapSlot, mapOverlays })}
          </div>
        );
      })}
    </div>
  );
}

type RenderContext = Pick<Props, 'composition' | 'config' | 'rows' | 'currentYear' | 'chartOverrides' | 'mapSlot' | 'mapOverlays'>;

function renderBlock(block: CompositionBlock, context: RenderContext) {
  const { config, rows, currentYear, chartOverrides, mapSlot, mapOverlays } = context;
  if (block.type === 'map') {
    return (
      <div className="composition-map-slot">
        {mapSlot}
        {mapOverlays}
      </div>
    );
  }
  if (block.type === 'headline') {
    return (
      <div className="composition-headline">
        {config.showTitle && <h2 title={config.title || 'Untitled data story'}>{config.title || 'Untitled data story'}</h2>}
        {config.subtitle && <p title={config.subtitle}>{config.subtitle}</p>}
        {currentYear && <span className="composition-year">{currentYear}</span>}
      </div>
    );
  }
  if (block.type === 'source') {
    return (
      <div className="composition-source">
        {config.showSource && <span title={config.source}>{config.source}</span>}
        {config.note && <small title={config.note}>{config.note}</small>}
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
