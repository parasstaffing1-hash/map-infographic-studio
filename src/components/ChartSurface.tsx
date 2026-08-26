import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildChartModel, layoutChart, type ChartHotspot, type ChartSpec } from '../domain/charts';
import type { DataRow, InfographicConfig } from '../domain/infographic';

type Props = {
  spec: ChartSpec;
  rows: DataRow[];
  config: InfographicConfig;
  currentYear?: string;
  /** Design-space size. The SVG scales responsively inside its container. */
  width?: number;
  height?: number;
  title?: string;
  source?: string;
  className?: string;
};

/**
 * Renders any chart kind from the shared dataset. Geometry comes from the pure
 * `layoutChart` so the browser, the exporter and the server renderer agree.
 */
export function ChartSurface({ spec, rows, config, currentYear, width = 720, height = 420, title, source, className }: Props) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const surfaceRef = useRef<SVGSVGElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  // Lay the chart out at the container's real aspect ratio. A fixed design size
  // would be letterboxed, shrinking a wide, short block to a fraction of its space.
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const element = plotRef.current;
    if (!element) return undefined;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const next = { width: Math.round(box.width), height: Math.round(box.height) };
      if (next.width <= 20 || next.height <= 20) return;
      setMeasured((current) => (current && current.width === next.width && current.height === next.height ? current : next));
    };
    // Measure straight away: ResizeObserver does not fire in every environment
    // (a hidden or non-compositing page, for one), and the first paint needs a size.
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const plotWidth = measured?.width ?? width;
  const plotHeight = measured?.height ?? height;
  const model = useMemo(() => buildChartModel(spec, rows, config, currentYear), [config, currentYear, rows, spec]);
  const layout = useMemo(() => layoutChart(model, spec, config, plotWidth, plotHeight), [config, model, plotHeight, plotWidth, spec]);
  const active: ChartHotspot | undefined = layout.hotspots[activeIndex];

  useEffect(() => setActiveIndex(-1), [spec.kind, rows, currentYear]);

  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (!layout.hotspots.length) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % layout.hotspots.length);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? layout.hotspots.length - 1 : index - 1));
    } else if (event.key === 'Escape') {
      setActiveIndex(-1);
    }
  };

  return (
    <figure className={`chart-surface ${className ?? ''}`.trim()}>
      {(title || spec.title) && <figcaption className="chart-caption"><strong>{spec.title || title}</strong>{spec.subtitle && <span>{spec.subtitle}</span>}</figcaption>}
      <div className="chart-plot" ref={plotRef}>
        <svg
          ref={surfaceRef}
          viewBox={`0 0 ${plotWidth} ${plotHeight}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          tabIndex={0}
          aria-label={layout.description}
          onKeyDown={onKeyDown}
          onBlur={() => setActiveIndex(-1)}
        >
          <title>{layout.description}</title>
          {layout.marks.map((mark) => renderMark(mark))}
          {layout.hotspots.map((hotspot, index) => (
            <rect
              key={`hotspot-${hotspot.id}`}
              x={hotspot.x}
              y={hotspot.y}
              width={Math.max(1, hotspot.width)}
              height={Math.max(1, hotspot.height)}
              fill="transparent"
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex((current) => (current === index ? -1 : current))}
            >
              <title>{`${hotspot.label}: ${hotspot.value}`}</title>
            </rect>
          ))}
          {active && <rect x={active.x - 2} y={active.y - 2} width={Math.max(1, active.width) + 4} height={Math.max(1, active.height) + 4} fill="none" stroke="#1d2b40" strokeWidth={1.5} strokeDasharray="3 3" pointerEvents="none" rx={4} />}
        </svg>
        {active && (
          <div className="chart-tooltip" role="status" style={tooltipPosition(active, plotWidth, plotHeight)}>
            <strong>{active.label}</strong>
            <span>{active.value}</span>
            {active.detail && <small>{active.detail}</small>}
          </div>
        )}
      </div>
      {spec.showLegend && layout.legend.length > 1 && (
        <ul className="chart-legend">
          {layout.legend.slice(0, 10).map((item) => (
            <li key={`${item.color}-${item.label}`}><span className="chart-legend-swatch" style={{ background: item.color }} />{item.label}</li>
          ))}
        </ul>
      )}
      {model.warnings.length > 0 && <p className="chart-warning">{model.warnings.join(' · ')}</p>}
      {source && <p className="chart-source">{source}</p>}
      <p className="sr-only">{tableFallback(layout.hotspots)}</p>
    </figure>
  );
}

function renderMark(mark: ReturnType<typeof layoutChart>['marks'][number]) {
  switch (mark.kind) {
    case 'rect':
      return <rect key={mark.id} x={mark.x} y={mark.y} width={Math.max(0, mark.width)} height={Math.max(0, mark.height)} fill={mark.fill} opacity={mark.opacity} rx={mark.radius ?? 0} />;
    case 'text':
      return <text key={mark.id} x={mark.x} y={mark.y} fontSize={mark.size} fontWeight={mark.weight} fill={mark.fill} textAnchor={mark.anchor} opacity={mark.opacity}>{mark.text}</text>;
    case 'path':
      return <path key={mark.id} d={mark.d} stroke={mark.stroke} fill={mark.fill ?? 'none'} strokeWidth={mark.width} opacity={mark.opacity} strokeDasharray={mark.dashed ? '4 3' : undefined} strokeLinejoin="round" strokeLinecap="round" />;
    case 'circle':
      return <circle key={mark.id} cx={mark.cx} cy={mark.cy} r={mark.r} fill={mark.fill} stroke={mark.stroke} strokeWidth={mark.stroke ? 1.5 : undefined} opacity={mark.opacity} />;
    case 'line':
      return <line key={mark.id} x1={mark.x1} y1={mark.y1} x2={mark.x2} y2={mark.y2} stroke={mark.stroke} strokeWidth={mark.width ?? 1} opacity={mark.opacity} strokeDasharray={mark.dashed ? '5 4' : undefined} />;
    default:
      return null;
  }
}

function tooltipPosition(hotspot: ChartHotspot, width: number, height: number) {
  const left = ((hotspot.x + hotspot.width / 2) / width) * 100;
  const top = (hotspot.y / height) * 100;
  return { left: `${Math.min(88, Math.max(6, left))}%`, top: `${Math.min(86, Math.max(2, top))}%` };
}

function tableFallback(hotspots: ChartHotspot[]) {
  return hotspots.slice(0, 40).map((hotspot) => `${hotspot.label}: ${hotspot.value}`).join('. ');
}
