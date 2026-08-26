import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { EXPORT_PRESETS, rowsToCsv, sanitizeFilename } from './exportComposition';
import { buildPptx, buildXlsx, columnName, SLIDE_SIZES } from './officeExport';
import { chartToSvg, escapeXml } from './chartSvg';
import { DEFAULT_CHART_SPEC } from './charts';
import { blockRect, compositionById, compositionHasMap, COMPOSITIONS, resolveChartSpec } from './composition';
import { DEFAULT_INFOGRAPHIC_CONFIG, type DataRow } from './infographic';

const rows: DataRow[] = [
  { id: 'r1', region: 'Delhi', value: 20, year: '2024', raw: { Region: 'Delhi', Value: 20, Turnout: 61 } },
  { id: 'r2', region: 'Kerala, South', value: 35, year: '2024', raw: { Region: 'Kerala, South', Value: 35, Turnout: 74 } },
];

describe('export presets', () => {
  it('offers social, presentation and print-safe sizes', () => {
    const ids = EXPORT_PRESETS.map((preset) => preset.id);
    expect(ids).toContain('story');
    expect(ids).toContain('print-a4');
    expect(EXPORT_PRESETS.find((preset) => preset.id === 'story')).toMatchObject({ width: 1080, height: 1920 });
    expect(EXPORT_PRESETS.find((preset) => preset.id === 'print-a4')?.printSafe).toBe(true);
  });

  it('makes safe file names', () => {
    expect(sanitizeFilename('India: GDP / State 2024!')).toBe('india-gdp-state-2024');
    expect(sanitizeFilename('!!!')).toBe('map-infographic');
  });
});

describe('CSV export', () => {
  it('quotes values that contain the delimiter', () => {
    const csv = rowsToCsv(rows);
    expect(csv.split('\n')[0]).toBe('Region,Value,Year,Parent,Turnout');
    expect(csv).toContain('"Kerala, South"');
  });

  it('carries the extra columns through', () => {
    expect(rowsToCsv(rows)).toContain('61');
  });
});

describe('compositions', () => {
  it('falls back to a known composition for an unknown id', () => {
    expect(compositionById('nope').id).toBe(COMPOSITIONS[0].id);
  });

  it('keeps every block inside the canvas', () => {
    for (const composition of COMPOSITIONS) {
      for (const block of composition.blocks) {
        expect(block.x + block.width, `${composition.id}/${block.id}`).toBeLessThanOrEqual(100.01);
        expect(block.y + block.height, `${composition.id}/${block.id}`).toBeLessThanOrEqual(100.01);
      }
    }
  });

  it('offers both map and chart-only layouts', () => {
    expect(COMPOSITIONS.some((composition) => compositionHasMap(composition))).toBe(true);
    expect(COMPOSITIONS.some((composition) => !compositionHasMap(composition))).toBe(true);
  });

  it('converts percentage blocks to pixel rectangles', () => {
    expect(blockRect({ id: 'a', type: 'chart', x: 50, y: 25, width: 50, height: 50 }, 1000, 400))
      .toEqual({ x: 500, y: 100, width: 500, height: 200 });
  });

  it('lets a per-block override win over the layout default', () => {
    const block = COMPOSITIONS.find((composition) => composition.id === 'map-ranked')!.blocks.find((entry) => entry.id === 'ranked')!;
    expect(resolveChartSpec(block).limit).toBe(10);
    expect(resolveChartSpec(block, { ranked: { limit: 3 } }).limit).toBe(3);
  });
});

describe('chartToSvg', () => {
  const spec = { ...DEFAULT_CHART_SPEC, kind: 'ranked-bar' as const };

  it('produces a standalone SVG with an accessible label', () => {
    const svg = chartToSvg(spec, rows, DEFAULT_INFOGRAPHIC_CONFIG, '2024', 600, 300);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 600 300"');
    expect(svg).toContain('aria-label=');
    expect(svg).toContain('<rect');
  });

  it('escapes region names so a stray character cannot break the document', () => {
    const hostile: DataRow[] = [{ id: 'x', region: 'A & B <script>', value: 1, raw: {} }];
    const svg = chartToSvg(spec, hostile, DEFAULT_INFOGRAPHIC_CONFIG, undefined, 400, 200);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&amp;');
  });

  it('escapes the five XML-significant characters', () => {
    expect(escapeXml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&apos;');
  });
});

describe('PPTX export', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it('writes a package with the parts PowerPoint requires', () => {
    const entries = unzipSync(buildPptx({ imagePng: png, title: 'India GDP', source: 'Source: MoSPI' }));
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/slides/slide1.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'ppt/media/image1.png']) {
      expect(Object.keys(entries), part).toContain(part);
    }
  });

  it('embeds the image bytes unchanged', () => {
    const entries = unzipSync(buildPptx({ imagePng: png, title: 'T', source: 'S' }));
    expect(Array.from(entries['ppt/media/image1.png'])).toEqual(Array.from(png));
  });

  it('writes the slide size in EMU and carries the source text', () => {
    const entries = unzipSync(buildPptx({ imagePng: png, title: 'T', source: 'Source: MoSPI 2024', size: SLIDE_SIZES['16:9'] }));
    expect(strFromU8(entries['ppt/presentation.xml'])).toContain('cx="12192000"');
    expect(strFromU8(entries['ppt/slides/slide1.xml'])).toContain('Source: MoSPI 2024');
  });

  it('escapes a title containing XML characters', () => {
    const entries = unzipSync(buildPptx({ imagePng: png, title: 'R&D <2024>', source: 'S' }));
    const slide = strFromU8(entries['ppt/slides/slide1.xml']);
    expect(slide).toContain('R&amp;D');
    expect(slide).not.toContain('<2024>');
  });
});

describe('XLSX export', () => {
  it('writes a readable workbook with a header row', () => {
    const entries = unzipSync(buildXlsx(rows, 'India data'));
    expect(Object.keys(entries)).toContain('xl/worksheets/sheet1.xml');
    const sheet = strFromU8(entries['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('<t xml:space="preserve">Region</t>');
    expect(sheet).toContain('<v>20</v>');
    expect(strFromU8(entries['xl/workbook.xml'])).toContain('India data');
  });

  it('truncates a sheet name to the 31-character limit Excel enforces', () => {
    const entries = unzipSync(buildXlsx(rows, 'x'.repeat(60)));
    const name = strFromU8(entries['xl/workbook.xml']).match(/name="([^"]*)"/)?.[1] ?? '';
    expect(name.length).toBeLessThanOrEqual(31);
  });

  it('numbers spreadsheet columns the way Excel does', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(27)).toBe('AB');
  });
});
