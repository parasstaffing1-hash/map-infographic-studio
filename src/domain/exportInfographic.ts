import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Annotation, InfographicConfig, LegendItem } from './infographic';

export type ExportFormat = 'png' | 'svg' | 'pdf';

type ExportOptions = {
  map: MapLibreMap;
  config: InfographicConfig;
  legend: LegendItem[];
  annotations: Annotation[];
  activeYear?: string;
  fileBase?: string;
};

export async function exportInfographic(format: ExportFormat, options: ExportOptions) {
  const dimensions = exportDimensions(options.config.aspect, options.config.resolution);
  const composition = renderComposition(options, dimensions.width, dimensions.height);
  const fileBase = sanitizeFilename(options.fileBase || options.config.title || 'map-infographic');
  if (format === 'png') {
    const blob = await canvasBlob(composition.canvas, 'image/png');
    downloadBlob(blob, `${fileBase}.png`);
    return;
  }
  if (format === 'svg') {
    const svg = compositionSvg(options, composition.mapDataUrl, dimensions.width, dimensions.height, composition.mapRect);
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${fileBase}.svg`);
    return;
  }
  const { jsPDF } = await import('jspdf');
  const orientation = dimensions.width >= dimensions.height ? 'landscape' : 'portrait';
  const document = new jsPDF({ orientation, unit: 'px', format: [dimensions.width, dimensions.height], hotfixes: ['px_scaling'] });
  document.addImage(composition.canvas.toDataURL('image/png'), 'PNG', 0, 0, dimensions.width, dimensions.height, undefined, 'FAST');
  document.save(`${fileBase}.pdf`);
}

export function downloadTextFile(content: string, filename: string, mimeType = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([content], { type: mimeType }), filename);
}

function renderComposition(options: ExportOptions, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the export canvas');
  context.fillStyle = options.config.background;
  context.fillRect(0, 0, width, height);
  const mapDataUrl = options.map.getCanvas().toDataURL('image/png');
  const sourceCanvas = options.map.getCanvas();
  const mapRect = compositionMapRect(width, height, options.config);
  drawContained(context, sourceCanvas, mapRect.x, mapRect.y, mapRect.width, mapRect.height);
  drawCompositionText(context, options, width, height);
  drawLegend(context, options.legend, options.config, width, height);
  drawAnnotations(context, options.annotations, width, height);
  return { canvas, mapDataUrl, mapRect };
}

function drawCompositionText(context: CanvasRenderingContext2D, options: ExportOptions, width: number, height: number) {
  const margin = Math.round(width * 0.045);
  const titleSize = Math.max(28, Math.round(width * 0.035));
  const subtitleSize = Math.max(16, Math.round(width * 0.016));
  context.textBaseline = 'top';
  context.fillStyle = readableTextColor(options.config.background);
  if (options.config.showTitle) {
    context.font = `700 ${titleSize}px Inter, Arial, sans-serif`;
    context.fillText(options.config.title || 'Map infographic', margin, margin, width - margin * 2);
    context.font = `400 ${subtitleSize}px Inter, Arial, sans-serif`;
    context.globalAlpha = 0.72;
    context.fillText(options.config.subtitle, margin, margin + titleSize * 1.25, width - margin * 2);
    context.globalAlpha = 1;
  }
  if (options.activeYear) {
    context.textAlign = 'right';
    context.font = `700 ${Math.max(30, Math.round(width * 0.045))}px Inter, Arial, sans-serif`;
    context.fillText(options.activeYear, width - margin, margin);
    context.textAlign = 'left';
  }
  if (options.config.showSource) {
    context.font = `400 ${Math.max(12, Math.round(width * 0.011))}px Inter, Arial, sans-serif`;
    context.globalAlpha = 0.72;
    context.fillText(options.config.source, margin, height - margin * 0.9, width - margin * 2);
    if (options.config.note) {
      context.textAlign = 'right';
      context.fillText(options.config.note, width - margin, height - margin * 0.9, width * 0.45);
      context.textAlign = 'left';
    }
    context.globalAlpha = 1;
  }
}

function drawLegend(context: CanvasRenderingContext2D, legend: LegendItem[], config: InfographicConfig, width: number, height: number) {
  if (!config.showLegend || !legend.length) return;
  const margin = Math.round(width * 0.045);
  const fontSize = Math.max(12, Math.round(width * 0.011));
  const swatch = Math.max(14, Math.round(fontSize * 1.05));
  const rowHeight = Math.round(swatch * 1.65);
  const legendWidth = Math.max(185, Math.round(width * 0.18));
  const legendHeight = legend.length * rowHeight + rowHeight;
  const x = width - margin - legendWidth;
  const y = height - margin * 1.8 - legendHeight;
  context.fillStyle = 'rgba(255,255,255,0.9)';
  context.fillRect(x - swatch, y - swatch, legendWidth + swatch * 2, legendHeight + swatch * 1.4);
  context.fillStyle = '#26364d';
  context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
  context.fillText('Legend', x, y);
  context.font = `400 ${fontSize}px Inter, Arial, sans-serif`;
  legend.slice(0, 12).forEach((item, index) => {
    const rowY = y + rowHeight * (index + 1);
    context.fillStyle = item.color;
    context.fillRect(x, rowY, swatch, swatch);
    context.fillStyle = '#26364d';
    context.fillText(item.label, x + swatch * 1.5, rowY - 1, legendWidth - swatch * 1.5);
  });
}

function drawAnnotations(context: CanvasRenderingContext2D, annotations: Annotation[], width: number, height: number) {
  for (const annotation of annotations) {
    const x = (annotation.x / 100) * width;
    const y = (annotation.y / 100) * height;
    context.fillStyle = annotation.color;
    context.strokeStyle = annotation.color;
    context.lineWidth = Math.max(2, width / 700);
    if (annotation.type === 'marker') {
      const radius = Math.max(7, (annotation.size / 100) * 16);
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.arc(x, y, radius * 0.4, 0, Math.PI * 2);
      context.fill();
    } else if (annotation.type === 'arrow') {
      const length = Math.max(50, width * 0.08 * (annotation.size / 100));
      context.beginPath();
      context.moveTo(x - length / 2, y + length / 4);
      context.lineTo(x + length / 2, y - length / 4);
      context.stroke();
      context.beginPath();
      context.moveTo(x + length / 2, y - length / 4);
      context.lineTo(x + length / 2 - 18, y - length / 4 - 2);
      context.lineTo(x + length / 2 - 6, y - length / 4 + 15);
      context.closePath();
      context.fill();
    } else {
      context.font = `700 ${Math.max(16, width * 0.018 * (annotation.size / 100))}px Inter, Arial, sans-serif`;
      context.fillText(annotation.text || 'Annotation', x, y, width * 0.35);
    }
  }
}

function compositionMapRect(width: number, height: number, config: InfographicConfig) {
  const margin = Math.round(width * 0.035);
  const top = config.showTitle ? Math.round(height * 0.15) : margin;
  const bottom = config.showSource ? Math.round(height * 0.07) : margin;
  return { x: margin, y: top, width: width - margin * 2, height: height - top - bottom };
}

function drawContained(context: CanvasRenderingContext2D, source: CanvasImageSource & { width: number; height: number }, x: number, y: number, width: number, height: number) {
  const sourceRatio = source.width / source.height;
  const targetRatio = width / height;
  const drawWidth = sourceRatio > targetRatio ? width : height * sourceRatio;
  const drawHeight = sourceRatio > targetRatio ? width / sourceRatio : height;
  context.drawImage(source, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function compositionSvg(options: ExportOptions, mapDataUrl: string, width: number, height: number, mapRect: { x: number; y: number; width: number; height: number }) {
  const margin = Math.round(width * 0.045);
  const titleSize = Math.max(28, Math.round(width * 0.035));
  const subtitleSize = Math.max(16, Math.round(width * 0.016));
  const textColor = readableTextColor(options.config.background);
  const legend = options.config.showLegend ? options.legend.slice(0, 12).map((item, index) => {
    const x = width - margin - Math.round(width * 0.18);
    const y = height - margin * 2 - options.legend.length * 28 + index * 28;
    return `<rect x="${x}" y="${y}" width="18" height="18" fill="${escapeXml(item.color)}"/><text x="${x + 28}" y="${y + 15}" font-size="14" fill="${textColor}">${escapeXml(item.label)}</text>`;
  }).join('') : '';
  const annotations = options.annotations.map((annotation) => `<text x="${(annotation.x / 100) * width}" y="${(annotation.y / 100) * height}" font-size="${Math.max(16, width * 0.018 * (annotation.size / 100))}" font-weight="700" fill="${escapeXml(annotation.color)}">${escapeXml(annotation.type === 'text' ? annotation.text : annotation.type === 'marker' ? '●' : '➜')}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="${escapeXml(options.config.background)}"/>
<image href="${mapDataUrl}" x="${mapRect.x}" y="${mapRect.y}" width="${mapRect.width}" height="${mapRect.height}" preserveAspectRatio="xMidYMid meet"/>
${options.config.showTitle ? `<text x="${margin}" y="${margin + titleSize}" font-family="Inter,Arial,sans-serif" font-size="${titleSize}" font-weight="700" fill="${textColor}">${escapeXml(options.config.title)}</text><text x="${margin}" y="${margin + titleSize * 1.8}" font-family="Inter,Arial,sans-serif" font-size="${subtitleSize}" fill="${textColor}" opacity=".72">${escapeXml(options.config.subtitle)}</text>` : ''}
${options.activeYear ? `<text x="${width - margin}" y="${margin + titleSize}" text-anchor="end" font-family="Inter,Arial,sans-serif" font-size="${titleSize * 1.2}" font-weight="700" fill="${textColor}">${escapeXml(options.activeYear)}</text>` : ''}
${legend}${annotations}
${options.config.showSource ? `<text x="${margin}" y="${height - margin * 0.55}" font-family="Inter,Arial,sans-serif" font-size="14" fill="${textColor}" opacity=".72">${escapeXml(options.config.source)}</text>` : ''}
</svg>`;
}

function exportDimensions(aspect: InfographicConfig['aspect'], resolution: InfographicConfig['resolution']) {
  const scale = resolution === '4k' ? 2 : 1;
  const dimensions = aspect === '1:1' ? [1600, 1600] : aspect === '4:5' ? [1600, 2000] : aspect === '9:16' ? [1080, 1920] : aspect === 'a4' ? [1654, 2339] : [1920, 1080];
  return { width: dimensions[0] * scale, height: dimensions[1] * scale };
}

function readableTextColor(background: string) {
  const normalized = background.replace('#', '').padEnd(6, '0').slice(0, 6);
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? '#24324a' : '#ffffff';
}

function canvasBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode the export image')), type));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map-infographic';
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character] ?? character);
}
