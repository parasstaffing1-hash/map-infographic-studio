import { describe, expect, it } from 'vitest';
import {
  bodyFrameRange,
  DEFAULT_VIDEO_SPEC,
  estimatedFileSizeMb,
  frameState,
  raceBars,
  totalFrames,
  videoDimensions,
  type VideoSpec,
} from './videoTimeline';
import { DEFAULT_INFOGRAPHIC_CONFIG, type DataRow } from './infographic';

const config = { ...DEFAULT_INFOGRAPHIC_CONFIG, decimals: 0 };
const years = ['2020', '2021', '2022'];

function row(region: string, value: number, year: string): DataRow {
  return { id: `${region}-${year}`, region, value, year, raw: { Region: region, Value: value, Year: year } };
}

const rows: DataRow[] = [
  row('Delhi', 100, '2020'), row('Delhi', 200, '2021'), row('Delhi', 300, '2022'),
  row('Kerala', 150, '2020'), row('Kerala', 160, '2021'), row('Kerala', 170, '2022'),
  row('Goa', 20, '2020'), row('Goa', 30, '2021'), row('Goa', 40, '2022'),
];

const spec = (patch: Partial<VideoSpec> = {}): VideoSpec => ({ ...DEFAULT_VIDEO_SPEC, ...patch });

describe('timeline arithmetic', () => {
  it('derives the frame count from duration and frame rate', () => {
    expect(totalFrames(spec({ durationSeconds: 10, fps: 30 }))).toBe(300);
    expect(totalFrames(spec({ durationSeconds: 0, fps: 30 }))).toBe(1);
  });

  it('never lets intro and outro swallow the whole timeline', () => {
    const range = bodyFrameRange(spec({ durationSeconds: 2, fps: 30, introSeconds: 5, outroSeconds: 5 }));
    expect(range.bodyEnd).toBeGreaterThan(range.bodyStart);
  });

  it('exposes the documented pixel sizes including vertical and 4K', () => {
    expect(videoDimensions(spec({ preset: 'vertical-1080' }))).toMatchObject({ width: 1080, height: 1920 });
    expect(videoDimensions(spec({ preset: 'landscape-4k' }))).toMatchObject({ width: 3840, height: 2160 });
  });
});

describe('frameState', () => {
  const active = spec({ durationSeconds: 10, fps: 30, introSeconds: 1, outroSeconds: 1 });

  it('moves through intro, body and outro', () => {
    expect(frameState(active, 0, rows, config, years).phase).toBe('intro');
    expect(frameState(active, 150, rows, config, years).phase).toBe('body');
    expect(frameState(active, 299, rows, config, years).phase).toBe('outro');
  });

  it('clamps frames outside the timeline instead of producing NaN', () => {
    const before = frameState(active, -20, rows, config, years);
    const after = frameState(active, 9999, rows, config, years);
    expect(before.frame).toBe(0);
    expect(after.frame).toBe(totalFrames(active) - 1);
    expect(Number.isFinite(after.progress)).toBe(true);
  });

  it('walks the year axis from the first year to the last', () => {
    expect(frameState(active, 30, rows, config, years).year).toBe('2020');
    expect(frameState(active, totalFrames(active) - 1, rows, config, years).year).toBe('2022');
  });

  it('is deterministic for a given frame', () => {
    expect(frameState(active, 120, rows, config, years)).toEqual(frameState(active, 120, rows, config, years));
  });

  it('fades in at the start and out at the end when a transition is set', () => {
    expect(frameState(active, 0, rows, config, years).opacity).toBe(0);
    expect(frameState(active, 150, rows, config, years).opacity).toBe(1);
    expect(frameState(spec({ transition: 'none' }), 0, rows, config, years).opacity).toBe(1);
  });

  it('produces a monotonically rising counter', () => {
    const counterSpec = spec({ mode: 'counter', durationSeconds: 4, fps: 30, introSeconds: 0, outroSeconds: 0 });
    const early = frameState(counterSpec, 10, rows, config, years).counter?.value ?? 0;
    const late = frameState(counterSpec, 100, rows, config, years).counter?.value ?? 0;
    expect(late).toBeGreaterThan(early);
  });

  it('supplies camera keyframes only in camera-tour mode', () => {
    expect(frameState(spec({ mode: 'camera-tour' }), 60, rows, config, years).camera).toBeDefined();
    expect(frameState(spec({ mode: 'year-choropleth' }), 60, rows, config, years).camera).toBeUndefined();
  });

  it('copes with a dataset that has no year column', () => {
    const flat = [{ id: 'a', region: 'Delhi', value: 5, raw: {} }];
    const state = frameState(active, 100, flat, config, []);
    expect(state.year).toBeUndefined();
    expect(state.caption).toBe(config.title);
  });
});

describe('bar-chart race', () => {
  it('ranks bars and normalises widths against the leader', () => {
    const bars = raceBars(rows, config, years, { year: '2022', yearProgress: 0 }, 3);
    expect(bars.map((bar) => bar.label)).toEqual(['Delhi', 'Kerala', 'Goa']);
    expect(bars[0].width).toBe(1);
    expect(bars[2].width).toBeLessThan(1);
  });

  it('interpolates values between two years so bars glide', () => {
    const midway = raceBars(rows, config, years, { year: '2020', nextYear: '2021', yearProgress: 0.5 }, 3);
    const delhi = midway.find((bar) => bar.label === 'Delhi');
    expect(delhi?.value).toBeCloseTo(150, 5);
  });

  it('honours the race size limit', () => {
    expect(raceBars(rows, config, years, { year: '2021', yearProgress: 0 }, 2)).toHaveLength(2);
  });

  it('returns nothing when there is no data rather than throwing', () => {
    expect(raceBars([], config, years, { year: '2021', yearProgress: 0 }, 5)).toEqual([]);
  });
});

describe('estimatedFileSizeMb', () => {
  it('scales with resolution and length', () => {
    const small = estimatedFileSizeMb(spec({ preset: 'landscape-1080', durationSeconds: 5 }));
    const large = estimatedFileSizeMb(spec({ preset: 'landscape-4k', durationSeconds: 20 }));
    expect(large).toBeGreaterThan(small);
  });
});
