import type { ReactNode } from 'react';
import { ArrowUpRight, Database } from 'lucide-react';
import { AnnotationLayer } from './AnnotationLayer';
import type { Annotation } from '../domain/infographic';

export type MapLegendItem = {
  color?: string;
  label: string;
  /** Renders the "selected region" swatch instead of a colour chip. */
  selected?: boolean;
};

export type MapCalloutSpec = {
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
};

export type MapOverlaysProps = {
  /** Legend card. Omit `legend` (or pass an empty array) to hide it. */
  showLegend?: boolean;
  legendTitle?: string;
  legend?: MapLegendItem[];
  /** Small footnote under the legend rows, e.g. "12/15 rows matched". */
  legendFootnote?: ReactNode;
  /** Scale / feature-count chip. Editor chrome — hidden when editorChrome is false. */
  scaleLabel?: ReactNode;
  /** Attribution line pinned to the bottom of the map block. */
  source?: ReactNode;
  /** Editor nudge card. Editor chrome — hidden when editorChrome is false. */
  callout?: MapCalloutSpec | null;
  annotations?: Annotation[];
  annotationsEditable?: boolean;
  onAnnotationsChange?: (annotations: Annotation[]) => void;
  /**
   * Editor-only affordances (scale chip, data callout, annotation drag handles,
   * hover states). Clean previews, exports and server video frames pass false.
   */
  editorChrome?: boolean;
  className?: string;
  children?: ReactNode;
};

/**
 * Map chrome that belongs to the MAP, not to the frame.
 *
 * Rendered as a direct child of the element that owns the map rectangle —
 * `.composition-map-slot` inside a composition, or the full-bleed map stage —
 * so every card positions against the map block instead of floating over the
 * whole canvas and landing on top of chart blocks.
 */
export function MapOverlays({
  showLegend = true,
  legendTitle = 'Legend',
  legend,
  legendFootnote,
  scaleLabel,
  source,
  callout,
  annotations,
  annotationsEditable = false,
  onAnnotationsChange,
  editorChrome = true,
  className,
  children,
}: MapOverlaysProps) {
  const legendVisible = showLegend && !!legend?.length;
  const calloutVisible = editorChrome && !!callout;
  const scaleVisible = editorChrome && !!scaleLabel;

  return (
    <div className={`map-overlays ${editorChrome ? '' : 'chrome-off'} ${className ?? ''}`.trim()}>
      {scaleVisible && <div className="map-overlay-scale">{scaleLabel}</div>}

      {calloutVisible && (
        <div className="map-data-callout map-overlay-callout">
          <div className="callout-icon"><Database size={15} /></div>
          <div>
            <strong>{callout.title}</strong>
            <span>{callout.detail}</span>
          </div>
          {callout.onAction && (
            <button type="button" onClick={callout.onAction} aria-label={callout.actionLabel ?? callout.title}>
              <ArrowUpRight size={15} />
            </button>
          )}
        </div>
      )}

      {legendVisible && (
        <div className="map-legend map-overlay-legend" role="group" aria-label={legendTitle}>
          <div className="legend-title">{legendTitle}</div>
          {legend?.map((item, index) => (
            <div className="legend-row" key={`${item.color ?? 'selected'}-${item.label}-${index}`}>
              <span className={`legend-swatch ${item.selected ? 'selected' : ''}`} style={item.selected ? undefined : { background: item.color }} />
              {item.label}
            </div>
          ))}
          {legendFootnote && <div className="legend-source"><span className="status-dot" /> {legendFootnote}</div>}
        </div>
      )}

      {source && <div className="map-overlay-source">{source}</div>}

      {annotations && annotations.length > 0 && (
        <AnnotationLayer
          annotations={annotations}
          editable={editorChrome && annotationsEditable}
          onChange={onAnnotationsChange ?? (() => undefined)}
        />
      )}

      {children}
    </div>
  );
}
