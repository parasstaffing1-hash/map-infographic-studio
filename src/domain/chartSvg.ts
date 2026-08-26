import { buildChartModel, layoutChart, type ChartMark, type ChartSpec } from './charts';
import type { DataRow, InfographicConfig } from './infographic';

/**
 * Renders a chart to a standalone SVG string. Used by the exporter and by any
 * server-side renderer, so exported charts are identical to the on-screen ones.
 */
export function chartToSvg(spec: ChartSpec, rows: DataRow[], config: InfographicConfig, currentYear: string | undefined, width: number, height: number, background = 'transparent') {
  const model = buildChartModel(spec, rows, config, currentYear);
  const layout = layoutChart(model, spec, config, width, height);
  const body = layout.marks.map(markToSvg).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(layout.description)}">`
    + `<title>${escapeXml(layout.description)}</title>`
    + (background === 'transparent' ? '' : `<rect width="100%" height="100%" fill="${escapeXml(background)}"/>`)
    + `<g font-family="Inter, system-ui, Arial, sans-serif">${body}</g>`
    + '</svg>';
}

function markToSvg(mark: ChartMark): string {
  switch (mark.kind) {
    case 'rect':
      return `<rect x="${round(mark.x)}" y="${round(mark.y)}" width="${round(Math.max(0, mark.width))}" height="${round(Math.max(0, mark.height))}" fill="${escapeXml(mark.fill)}"${mark.opacity !== undefined ? ` opacity="${mark.opacity}"` : ''}${mark.radius ? ` rx="${mark.radius}"` : ''}/>`;
    case 'text':
      return `<text x="${round(mark.x)}" y="${round(mark.y)}" font-size="${round(mark.size)}" font-weight="${mark.weight}" fill="${escapeXml(mark.fill)}" text-anchor="${mark.anchor}"${mark.opacity !== undefined ? ` opacity="${mark.opacity}"` : ''}>${escapeXml(mark.text)}</text>`;
    case 'path':
      return `<path d="${mark.d}" fill="${escapeXml(mark.fill ?? 'none')}"${mark.stroke ? ` stroke="${escapeXml(mark.stroke)}"` : ''}${mark.width ? ` stroke-width="${mark.width}"` : ''}${mark.opacity !== undefined ? ` opacity="${mark.opacity}"` : ''}${mark.dashed ? ' stroke-dasharray="4 3"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
    case 'circle':
      return `<circle cx="${round(mark.cx)}" cy="${round(mark.cy)}" r="${round(mark.r)}" fill="${escapeXml(mark.fill)}"${mark.stroke ? ` stroke="${escapeXml(mark.stroke)}" stroke-width="1.5"` : ''}${mark.opacity !== undefined ? ` opacity="${mark.opacity}"` : ''}/>`;
    case 'line':
      return `<line x1="${round(mark.x1)}" y1="${round(mark.y1)}" x2="${round(mark.x2)}" y2="${round(mark.y2)}" stroke="${escapeXml(mark.stroke)}" stroke-width="${mark.width ?? 1}"${mark.opacity !== undefined ? ` opacity="${mark.opacity}"` : ''}${mark.dashed ? ' stroke-dasharray="5 4"' : ''}/>`;
    default:
      return '';
  }
}

function round(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

export function escapeXml(value: string) {
  return String(value).replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character] ?? character);
}

/** Loads an SVG string into an Image so it can be drawn onto an export canvas. */
export function svgToImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not rasterise the chart for export'));
    };
    image.src = url;
  });
}
