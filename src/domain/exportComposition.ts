import type { Map as MapLibreMap } from 'maplibre-gl';
import type { ChartSpec } from './charts';
import { chartToSvg, escapeXml, svgToImage } from './chartSvg';
import { blockRect, blocksForAspect, compositionById, resolveChartSpec, type Composition } from './composition';
import { attributionLine, type DatasetMeta } from './dataSources';
import type { Annotation, DataRow, InfographicConfig, LegendItem } from './infographic';
import { buildPptx, buildXlsx, SLIDE_SIZES } from './officeExport';

export type CompositionExportFormat = 'png' | 'jpg' | 'svg' | 'pdf' | 'pptx' | 'xlsx' | 'csv';

export type ExportPreset = {
  id: string;
  label: string;
  detail: string;
  width: number;
  height: number;
  scale: number;
  /** Print presets need an opaque background and no transparency. */
  printSafe?: boolean;
};

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'social-landscape', label: 'Social landscape', detail: '1600×900 · X, LinkedIn', width: 1600, height: 900, scale: 1 },
  { id: 'social-square', label: 'Social square', detail: '1080×1080 · Instagram feed', width: 1080, height: 1080, scale: 1 },
  { id: 'social-portrait', label: 'Social portrait', detail: '1080×1350 · Instagram portrait', width: 1080, height: 1350, scale: 1 },
  { id: 'story', label: 'Story', detail: '1080×1920 · Stories, Reels, Shorts', width: 1080, height: 1920, scale: 1 },
  { id: 'presentation', label: 'Presentation', detail: '1920×1080 · slides', width: 1920, height: 1080, scale: 1 },
  { id: 'hi-res', label: 'High resolution', detail: '3840×2160 · 4K master', width: 3840, height: 2160, scale: 1 },
  { id: 'print-a4', label: 'Print A4', detail: '300 dpi portrait, print-safe', width: 2480, height: 3508, scale: 1, printSafe: true },
  { id: 'print-a4-landscape', label: 'Print A4 landscape', detail: '300 dpi landscape, print-safe', width: 3508, height: 2480, scale: 1, printSafe: true },
];

export type CompositionExportOptions = {
  compositionId: string;
  config: InfographicConfig;
  rows: DataRow[];
  chartOverrides: Record<string, Partial<ChartSpec>>;
  legend: LegendItem[];
  annotations: Annotation[];
  currentYear?: string;
  datasetMeta: DatasetMeta;
  map: MapLibreMap | null;
  preset: ExportPreset;
  transparent: boolean;
  fileBase: string;
  logoDataUrl?: string;
};

export async function exportComposition(format: CompositionExportFormat, options: CompositionExportOptions) {
  const fileBase = sanitizeFilename(options.fileBase || options.config.title);

  if (format === 'csv') {
    downloadBlob(new Blob([rowsToCsv(options.rows)], { type: 'text/csv;charset=utf-8' }), `${fileBase}-data.csv`);
    return;
  }
  if (format === 'xlsx') {
    downloadBlob(new Blob([toArrayBuffer(buildXlsx(options.rows, options.config.title || 'Data'))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileBase}-data.xlsx`);
    return;
  }
  if (format === 'svg') {
    downloadBlob(new Blob([await compositionSvg(options)], { type: 'image/svg+xml;charset=utf-8' }), `${fileBase}.svg`);
    return;
  }

  const canvas = await renderCompositionCanvas(options, format === 'jpg' || options.preset.printSafe ? false : options.transparent);

  if (format === 'png' || format === 'jpg') {
    const type = format === 'png' ? 'image/png' : 'image/jpeg';
    downloadBlob(await canvasBlob(canvas, type, 0.94), `${fileBase}.${format}`);
    return;
  }
  if (format === 'pptx') {
    const png = new Uint8Array(await (await canvasBlob(canvas, 'image/png')).arrayBuffer());
    const slide = options.preset.width >= options.preset.height ? SLIDE_SIZES['16:9'] : SLIDE_SIZES['4:3'];
    const pptx = buildPptx({ imagePng: png, title: options.config.title, source: attributionLine(options.datasetMeta, options.config.source), size: slide });
    downloadBlob(new Blob([toArrayBuffer(pptx)], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), `${fileBase}.pptx`);
    return;
  }

  const { jsPDF } = await import('jspdf');
  const orientation = canvas.width >= canvas.height ? 'landscape' : 'portrait';
  const document_ = new jsPDF({ orientation, unit: 'px', format: [canvas.width, canvas.height], hotfixes: ['px_scaling'] });
  document_.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height, undefined, 'FAST');
  document_.save(`${fileBase}.pdf`);
}

/**
 * Paints every block of the composition — map, charts, headline, source and
 * annotations — onto one canvas, so exports match what the editor shows.
 */
export async function renderCompositionCanvas(options: CompositionExportOptions, transparent: boolean): Promise<HTMLCanvasElement> {
  const composition = compositionById(options.compositionId);
  const width = Math.round(options.preset.width * options.preset.scale);
  const height = Math.round(options.preset.height * options.preset.scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the export canvas');

  if (!transparent) {
    context.fillStyle = options.config.background;
    context.fillRect(0, 0, width, height);
  }

  for (const block of blocksForAspect(composition, options.config.aspect)) {
    const rect = blockRect(block, width, height);
    if (rect.width <= 0 || rect.height <= 0) continue;

    if (block.type === 'map') {
      if (!options.map) continue;
      const source = options.map.getCanvas();
      drawContained(context, source, rect.x, rect.y, rect.width, rect.height);
      continue;
    }

    if (block.type === 'chart' || block.type === 'kpi') {
      const spec = resolveChartSpec(block, options.chartOverrides);
      const svg = chartToSvg(spec, options.rows, options.config, options.currentYear, rect.width, rect.height);
      const image = await svgToImage(svg);
      context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
      continue;
    }

    if (block.type === 'headline') drawHeadline(context, options, rect, width);
    if (block.type === 'source') drawSource(context, options, rect, width);
    if (block.type === 'note') drawNote(context, options.config.note || block.text || '', rect, width);
  }

  // A full-bleed map composition still needs its title, legend and source drawn.
  if (composition.id === 'map-only') {
    drawHeadline(context, options, { x: Math.round(width * 0.045), y: Math.round(height * 0.04), width: Math.round(width * 0.7), height: Math.round(height * 0.16) }, width);
    drawLegend(context, options.legend, options.config, width, height);
    drawSource(context, options, { x: Math.round(width * 0.045), y: Math.round(height * 0.93), width: Math.round(width * 0.9), height: Math.round(height * 0.05) }, width);
  }

  drawAnnotations(context, options.annotations, width, height);
  if (options.logoDataUrl) await drawLogo(context, options.logoDataUrl, width, height);
  return canvas;
}

function drawHeadline(context: CanvasRenderingContext2D, options: CompositionExportOptions, rect: { x: number; y: number; width: number; height: number }, width: number) {
  if (!options.config.showTitle) return;
  const titleSize = Math.max(20, Math.round(width * 0.030));
  const subtitleSize = Math.max(13, Math.round(width * 0.014));
  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.fillStyle = readableTextColor(options.config.background);
  context.font = `700 ${titleSize}px Inter, Arial, sans-serif`;
  const afterTitle = wrapText(context, options.config.title || 'Map infographic', rect.x, rect.y + Math.round(titleSize * 0.2), rect.width, titleSize * 1.16, 2);
  if (options.config.subtitle) {
    context.font = `400 ${subtitleSize}px Inter, Arial, sans-serif`;
    context.globalAlpha = 0.74;
    wrapText(context, options.config.subtitle, rect.x, afterTitle + Math.round(subtitleSize * 0.4), rect.width, subtitleSize * 1.3, 2);
    context.globalAlpha = 1;
  }
  if (options.currentYear) {
    context.textAlign = 'right';
    context.font = `700 ${Math.max(22, Math.round(width * 0.032))}px Inter, Arial, sans-serif`;
    context.fillText(options.currentYear, rect.x + rect.width, rect.y);
    context.textAlign = 'left';
  }
}

function drawSource(context: CanvasRenderingContext2D, options: CompositionExportOptions, rect: { x: number; y: number; width: number; height: number }, width: number) {
  if (!options.config.showSource) return;
  const size = Math.max(10, Math.round(width * 0.0095));
  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.font = `400 ${size}px Inter, Arial, sans-serif`;
  context.fillStyle = readableTextColor(options.config.background);
  context.globalAlpha = 0.76;
  wrapText(context, attributionLine(options.datasetMeta, options.config.source), rect.x, rect.y, rect.width, size * 1.3, 2);
  context.globalAlpha = 1;
}

function drawNote(context: CanvasRenderingContext2D, text: string, rect: { x: number; y: number; width: number; height: number }, width: number) {
  if (!text) return;
  const size = Math.max(10, Math.round(width * 0.0095));
  context.font = `400 ${size}px Inter, Arial, sans-serif`;
  context.globalAlpha = 0.7;
  wrapText(context, text, rect.x, rect.y, rect.width, size * 1.3, 3);
  context.globalAlpha = 1;
}

function drawLegend(context: CanvasRenderingContext2D, legend: LegendItem[], config: InfographicConfig, width: number, height: number) {
  if (!config.showLegend || !legend.length) return;
  const margin = Math.round(width * 0.045);
  const fontSize = Math.max(11, Math.round(width * 0.010));
  const swatch = Math.max(13, Math.round(fontSize * 1.05));
  const rowHeight = Math.round(swatch * 1.6);
  const legendWidth = Math.max(170, Math.round(width * 0.17));
  const items = legend.slice(0, 10);
  const legendHeight = items.length * rowHeight + rowHeight;
  const x = width - margin - legendWidth;
  const y = height - margin * 1.9 - legendHeight;
  context.fillStyle = 'rgba(255,255,255,0.92)';
  context.fillRect(x - swatch, y - swatch, legendWidth + swatch * 2, legendHeight + swatch * 1.3);
  context.fillStyle = '#26364d';
  context.textBaseline = 'top';
  context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
  context.fillText('Legend', x, y);
  context.font = `400 ${fontSize}px Inter, Arial, sans-serif`;
  items.forEach((item, index) => {
    const rowY = y + rowHeight * (index + 1);
    context.fillStyle = item.color;
    context.fillRect(x, rowY, swatch, swatch);
    context.fillStyle = '#26364d';
    context.fillText(truncateToWidth(context, item.label, legendWidth - swatch * 1.6), x + swatch * 1.5, rowY);
  });
}

function drawAnnotations(context: CanvasRenderingContext2D, annotations: Annotation[], width: number, height: number) {
  context.textBaseline = 'alphabetic';
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
      context.font = `700 ${Math.max(14, width * 0.016 * (annotation.size / 100))}px Inter, Arial, sans-serif`;
      context.fillText(annotation.text || 'Annotation', x, y, width * 0.35);
    }
  }
  context.textBaseline = 'top';
}

async function drawLogo(context: CanvasRenderingContext2D, dataUrl: string, width: number, height: number) {
  const image = await loadImage(dataUrl).catch(() => null);
  if (!image) return;
  const logoWidth = Math.round(width * 0.09);
  const logoHeight = Math.round((image.height / image.width) * logoWidth);
  context.drawImage(image, width - logoWidth - Math.round(width * 0.03), Math.round(height * 0.03), logoWidth, logoHeight);
}

async function compositionSvg(options: CompositionExportOptions) {
  const composition = compositionById(options.compositionId);
  const width = options.preset.width;
  const height = options.preset.height;
  const parts: string[] = [];
  if (!options.transparent) parts.push(`<rect width="100%" height="100%" fill="${escapeXml(options.config.background)}"/>`);

  for (const block of blocksForAspect(composition, options.config.aspect)) {
    const rect = blockRect(block, width, height);
    if (block.type === 'map' && options.map) {
      parts.push(`<image href="${options.map.getCanvas().toDataURL('image/png')}" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" preserveAspectRatio="xMidYMid meet"/>`);
    } else if (block.type === 'chart' || block.type === 'kpi') {
      const spec = resolveChartSpec(block, options.chartOverrides);
      const inner = chartToSvg(spec, options.rows, options.config, options.currentYear, rect.width, rect.height);
      parts.push(`<g transform="translate(${rect.x},${rect.y})">${stripSvgWrapper(inner)}</g>`);
    } else if (block.type === 'headline' && options.config.showTitle) {
      const titleSize = Math.max(20, Math.round(width * 0.03));
      parts.push(`<text x="${rect.x}" y="${rect.y + titleSize}" font-size="${titleSize}" font-weight="700" fill="${readableTextColor(options.config.background)}">${escapeXml(options.config.title)}</text>`);
      if (options.config.subtitle) parts.push(`<text x="${rect.x}" y="${rect.y + titleSize * 1.9}" font-size="${Math.max(13, Math.round(width * 0.014))}" fill="${readableTextColor(options.config.background)}" opacity=".74">${escapeXml(options.config.subtitle)}</text>`);
    } else if (block.type === 'source' && options.config.showSource) {
      parts.push(`<text x="${rect.x}" y="${rect.y + 14}" font-size="${Math.max(10, Math.round(width * 0.0095))}" fill="${readableTextColor(options.config.background)}" opacity=".76">${escapeXml(attributionLine(options.datasetMeta, options.config.source))}</text>`);
    }
  }

  for (const annotation of options.annotations) {
    parts.push(`<text x="${(annotation.x / 100) * width}" y="${(annotation.y / 100) * height}" font-size="${Math.max(14, width * 0.016 * (annotation.size / 100))}" font-weight="700" fill="${escapeXml(annotation.color)}">${escapeXml(annotation.type === 'text' ? annotation.text : annotation.type === 'marker' ? '●' : '➜')}</text>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, system-ui, Arial, sans-serif">${parts.join('')}</svg>`;
}

function stripSvgWrapper(svg: string) {
  const start = svg.indexOf('>', svg.indexOf('<svg')) + 1;
  const end = svg.lastIndexOf('</svg>');
  return start > 0 && end > start ? svg.slice(start, end) : svg;
}

/** Wraps text within a box and returns the y position just below the last line. */
export function wrapText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
  const words = String(text).split(/\s+/).filter(Boolean);
  let line = '';
  let cursor = y;
  let lines = 0;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      lines += 1;
      if (lines >= maxLines) {
        context.fillText(`${line.trimEnd()}…`, x, cursor);
        return cursor + lineHeight;
      }
      context.fillText(line, x, cursor);
      cursor += lineHeight;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    context.fillText(line, x, cursor);
    cursor += lineHeight;
  }
  return cursor;
}

function truncateToWidth(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && context.measureText(`${clipped}…`).width > maxWidth) clipped = clipped.slice(0, -1);
  return `${clipped}…`;
}

function drawContained(context: CanvasRenderingContext2D, source: HTMLCanvasElement, x: number, y: number, width: number, height: number) {
  if (!source.width || !source.height) return;
  const sourceRatio = source.width / source.height;
  const targetRatio = width / height;
  const drawWidth = sourceRatio > targetRatio ? width : height * sourceRatio;
  const drawHeight = sourceRatio > targetRatio ? width / sourceRatio : height;
  context.drawImage(source, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

export function rowsToCsv(rows: DataRow[]) {
  const extra = [...new Set(rows.flatMap((row) => Object.keys(row.raw)))].filter((header) => !['Region', 'Value', 'Year', 'Parent'].includes(header)).slice(0, 24);
  const headers = ['Region', 'Value', 'Year', 'Parent', ...extra];
  const body = rows.map((row) => [row.region, row.value, row.year ?? '', row.parent ?? '', ...extra.map((header) => row.raw[header] ?? '')]);
  return [headers, ...body].map((cells) => cells.map((cell) => quoteCsv(String(cell ?? ''))).join(',')).join('\n');
}

function quoteCsv(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function readableTextColor(background: string) {
  const normalized = background.replace('#', '').padEnd(6, '0').slice(0, 6);
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? '#24324a' : '#ffffff';
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the export image'))), type, quality));
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the image'));
    image.src = source;
  });
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function sanitizeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map-infographic';
}
