import { describe, expect, it } from 'vitest';
import { buildChartModel, chartFields, layoutChart, DEFAULT_CHART_SPEC, type ChartSpec } from './charts';
import { DEFAULT_INFOGRAPHIC_CONFIG, type DataRow } from './infographic';

const config = { ...DEFAULT_INFOGRAPHIC_CONFIG, decimals: 0 };

function row(region: string, value: string | number, year?: string, raw: DataRow['raw'] = {}): DataRow {
  return { id: `${region}-${year ?? 'na'}`, region, value, year, raw: { Region: region, Value: value, ...(year ? { Year: year } : {}), ...raw } };
}

const flat: DataRow[] = [row('Maharashtra', 1000), row('Delhi', 400), row('Kerala', 600)];
const timeSeries: DataRow[] = [
  row('Delhi', 100, '2020'), row('Delhi', 150, '2021'), row('Delhi', 210, '2022'),
  row('Kerala', 80, '2020'), row('Kerala', 95, '2021'), row('Kerala', 120, '2022'),
];

const spec = (patch: Partial<ChartSpec> = {}): ChartSpec => ({ ...DEFAULT_CHART_SPEC, ...patch });

describe('buildChartModel', () => {
  it('ranks regions by value and shares the map number formatting', () => {
    const model = buildChartModel(spec({ kind: 'ranked-bar' }), flat, config);
    expect(model.data.map((datum) => datum.label)).toEqual(['Maharashtra', 'Kerala', 'Delhi']);
    expect(model.data[0].rank).toBe(1);
    expect(model.data[0].formatted).toBe('1,000');
    expect(model.total).toBe(2000);
    expect(model.data[0].share).toBeCloseTo(0.5, 5);
  });

  it('honours the shared active year filter', () => {
    const model = buildChartModel(spec({ kind: 'bar-horizontal' }), timeSeries, config, '2021');
    expect(model.data.map((datum) => datum.value).sort((a, b) => b - a)).toEqual([150, 95]);
  });

  it('reports rows that carry no usable number instead of dropping them silently', () => {
    const model = buildChartModel(spec(), [...flat, row('Nowhere', 'n/a')], config);
    expect(model.skippedRows).toBe(1);
    expect(model.warnings.join(' ')).toMatch(/skipped/);
  });

  it('builds one series per region for line charts', () => {
    const model = buildChartModel(spec({ kind: 'line' }), timeSeries, config);
    expect(model.series).toHaveLength(2);
    expect(model.years).toEqual(['2020', '2021', '2022']);
    expect(model.series[0].points.map((point) => point.value)).toEqual([100, 150, 210]);
  });

  it('warns rather than throwing when a trend chart has no year column', () => {
    const model = buildChartModel(spec({ kind: 'line' }), flat, config);
    expect(model.empty).toBe(true);
    expect(model.warnings.join(' ')).toMatch(/Year column/);
  });

  it('computes period-on-period change for KPI cards', () => {
    const model = buildChartModel(spec({ kind: 'kpi' }), timeSeries, config, '2022');
    const delhi = model.data.find((datum) => datum.label === 'Delhi');
    expect(delhi?.previous).toBe(150);
    expect(delhi?.change).toBeCloseTo(0.4, 5);
  });

  it('respects the top-N limit and the aggregation mode', () => {
    const summed = buildChartModel(spec({ limit: 2 }), [...timeSeries], { ...config, aggregation: 'sum' });
    expect(summed.data).toHaveLength(2);
    expect(summed.data[0].value).toBe(460);
  });

  it('reads an alternate value column when one is chosen', () => {
    const rows = [row('Delhi', 1, undefined, { Turnout: 62.5 }), row('Kerala', 2, undefined, { Turnout: 71.2 })];
    const model = buildChartModel(spec({ valueField: 'Turnout', kind: 'bar-vertical' }), rows, { ...config, decimals: 1 });
    expect(model.data.map((datum) => datum.value)).toEqual([71.2, 62.5]);
  });
});

describe('layoutChart', () => {
  it('emits a bar and a hotspot for every region', () => {
    const model = buildChartModel(spec({ kind: 'ranked-bar' }), flat, config);
    const layout = layoutChart(model, spec({ kind: 'ranked-bar' }), config, 640, 360);
    expect(layout.hotspots).toHaveLength(3);
    expect(layout.marks.filter((mark) => mark.id.startsWith('bar-'))).toHaveLength(3);
    expect(layout.description).toMatch(/Maharashtra leads/);
  });

  it('keeps every mark inside the canvas box', () => {
    for (const kind of ['bar-horizontal', 'bar-vertical', 'donut', 'kpi', 'table', 'pictogram', 'scatter', 'bubble'] as const) {
      const chartSpec = spec({ kind });
      const layout = layoutChart(buildChartModel(chartSpec, flat, config), chartSpec, config, 600, 340);
      for (const mark of layout.marks) {
        if (mark.kind === 'rect') {
          expect(mark.x, `${kind} ${mark.id}`).toBeGreaterThanOrEqual(-1);
          expect(mark.x + mark.width, `${kind} ${mark.id}`).toBeLessThanOrEqual(601);
          expect(mark.y + mark.height, `${kind} ${mark.id}`).toBeLessThanOrEqual(341);
        }
        if (mark.kind === 'circle') {
          expect(mark.cx + mark.r, `${kind} ${mark.id}`).toBeLessThanOrEqual(601);
          expect(mark.cy + mark.r, `${kind} ${mark.id}`).toBeLessThanOrEqual(341);
        }
      }
    }
  });

  it('draws one line path per series plus an area fill for area charts', () => {
    const areaSpec = spec({ kind: 'area' });
    const layout = layoutChart(buildChartModel(areaSpec, timeSeries, config), areaSpec, config, 640, 360);
    expect(layout.marks.filter((mark) => mark.id.startsWith('line-'))).toHaveLength(2);
    expect(layout.marks.filter((mark) => mark.id.startsWith('area-'))).toHaveLength(2);
  });

  it('shows an explanation instead of an empty frame when there is no data', () => {
    const layout = layoutChart(buildChartModel(spec(), [], config), spec(), config, 400, 300);
    expect(layout.marks).toHaveLength(1);
    expect(layout.marks[0].kind).toBe('text');
  });

  it('renders donut slices that sum to the full circle', () => {
    const donutSpec = spec({ kind: 'donut' });
    const layout = layoutChart(buildChartModel(donutSpec, flat, config), donutSpec, config, 600, 340);
    expect(layout.marks.filter((mark) => mark.id.startsWith('arc-'))).toHaveLength(3);
  });
});

describe('chartFields', () => {
  it('separates numeric columns from text columns', () => {
    const rows = [row('Delhi', 1, '2021', { Turnout: 62.5, Winner: 'Party A' }), row('Kerala', 2, '2021', { Turnout: 71.2, Winner: 'Party B' })];
    const fields = chartFields(rows);
    expect(fields.numeric).toContain('Turnout');
    expect(fields.text).toContain('Winner');
  });
});
