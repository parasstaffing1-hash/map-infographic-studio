import { describe, expect, it } from 'vitest';
import { contentTypeFor, encoderArguments, evenNumber, probeFfmpeg } from './ffmpeg.js';
import {
  MAX_PIXEL_BUDGET,
  VIDEO_DIMENSIONS,
  VideoRenderRequestSchema,
  VideoSpecSchema,
  pixelBudget,
  videoFrameCount,
  withinPixelBudget,
} from './video-contracts.js';

const baseSpec = VideoSpecSchema.parse({});

const validRequest = {
  idempotencyKey: 'idem-key-123456',
  templateId: 'india-population',
  viewMode: 'india',
  compositionId: 'map-ranked',
  document: {
    schemaVersion: 2,
    name: 'Test story',
    geography: { viewMode: 'india', selectedIds: [] },
    presentation: { style: {}, hiddenLayers: {} },
    compositionId: 'map-ranked',
    chartOverrides: {},
    config: {},
    rows: [],
    annotations: [],
    datasetMeta: {},
    regionOverrides: {},
    filters: [],
    videoSpec: {},
  },
  spec: {},
};

describe('video contracts', () => {
  it('accepts a well-formed request and applies defaults', () => {
    const parsed = VideoRenderRequestSchema.parse(validRequest);
    expect(parsed.spec.format).toBe('mp4');
    expect(parsed.spec.fps).toBe(30);
    expect(parsed.outputPrefix).toBe('videos');
  });

  it('rejects unknown fields so a typo cannot be silently ignored', () => {
    expect(() => VideoRenderRequestSchema.parse({ ...validRequest, surprise: true })).toThrow();
  });

  it('rejects an out-of-range frame rate and duration', () => {
    expect(() => VideoSpecSchema.parse({ fps: 0 })).toThrow();
    expect(() => VideoSpecSchema.parse({ fps: 240 })).toThrow();
    expect(() => VideoSpecSchema.parse({ durationSeconds: 6_000 })).toThrow();
  });

  it('rejects a traversal attempt in the output prefix', () => {
    expect(() => VideoRenderRequestSchema.parse({ ...validRequest, outputPrefix: '../../etc' })).toThrow();
  });

  it('rejects a composition id that is not a plain slug', () => {
    expect(() => VideoRenderRequestSchema.parse({ ...validRequest, compositionId: '../x' })).toThrow();
  });

  it('derives the frame count from duration and frame rate', () => {
    expect(videoFrameCount({ ...baseSpec, durationSeconds: 12, fps: 30 })).toBe(360);
  });

  it('publishes the vertical and 4K dimensions the UI offers', () => {
    expect(VIDEO_DIMENSIONS['vertical-1080']).toEqual({ width: 1080, height: 1920 });
    expect(VIDEO_DIMENSIONS['landscape-4k']).toEqual({ width: 3840, height: 2160 });
  });

  it('refuses a job whose pixel budget would monopolise a worker', () => {
    const huge = { ...baseSpec, preset: 'landscape-4k' as const, durationSeconds: 180, fps: 60 };
    expect(pixelBudget(huge)).toBeGreaterThan(MAX_PIXEL_BUDGET);
    expect(withinPixelBudget(huge)).toBe(false);
    expect(withinPixelBudget({ ...baseSpec, preset: 'landscape-1080', durationSeconds: 12, fps: 30 })).toBe(true);
  });
});

describe('ffmpeg arguments', () => {
  const options = { format: 'mp4' as const, fps: 30, width: 1920, height: 1080, ffmpegPath: 'ffmpeg', timeoutMs: 60_000 };

  it('reads a PNG sequence from stdin at the requested frame rate', () => {
    const args = encoderArguments(options, '/tmp/out.mp4');
    expect(args).toContain('image2pipe');
    expect(args[args.indexOf('-framerate') + 1]).toBe('30');
    expect(args[args.indexOf('-i') + 1]).toBe('pipe:0');
    expect(args.at(-1)).toBe('/tmp/out.mp4');
  });

  it('uses H.264 with web-friendly flags for MP4', () => {
    const args = encoderArguments(options, '/tmp/out.mp4');
    expect(args).toContain('libx264');
    expect(args).toContain('yuv420p');
    expect(args).toContain('+faststart');
  });

  it('uses VP9 for WebM', () => {
    expect(encoderArguments({ ...options, format: 'webm' }, '/tmp/out.webm')).toContain('libvpx-vp9');
  });

  it('generates a palette for GIF and loops by default', () => {
    const args = encoderArguments({ ...options, format: 'gif' }, '/tmp/out.gif');
    expect(args.join(' ')).toMatch(/palettegen/);
    expect(args[args.indexOf('-loop') + 1]).toBe('0');
    expect(encoderArguments({ ...options, format: 'gif', loop: false }, '/tmp/out.gif')[args.indexOf('-loop') + 1]).toBe('-1');
  });

  it('rounds dimensions up to even numbers, as H.264 and VP9 require', () => {
    expect(evenNumber(1081)).toBe(1082);
    expect(evenNumber(1080)).toBe(1080);
    expect(encoderArguments({ ...options, width: 1081, height: 607 }, '/tmp/o.mp4').join(' ')).toMatch(/scale=1082:608/);
  });

  it('never builds a shell string, so filenames cannot inject arguments', () => {
    const args = encoderArguments(options, '/tmp/a b; rm -rf /.mp4');
    expect(args.at(-1)).toBe('/tmp/a b; rm -rf /.mp4');
    expect(args.filter((argument) => argument.includes('rm -rf'))).toHaveLength(1);
  });

  it('maps each format to its content type', () => {
    expect(contentTypeFor('mp4')).toBe('video/mp4');
    expect(contentTypeFor('webm')).toBe('video/webm');
    expect(contentTypeFor('gif')).toBe('image/gif');
  });
});

describe('probeFfmpeg', () => {
  it('reports unavailable rather than throwing when the binary is missing', async () => {
    const result = await probeFfmpeg('definitely-not-a-real-ffmpeg-binary');
    expect(result.available).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('the render contract carries the whole editor state', () => {
  const customised = {
    ...validRequest,
    document: {
      ...validRequest.document,
      geography: { viewMode: 'usa-counties', districtScope: '06', focusPlace: 'California', selectedIds: ['x'] },
      presentation: { style: { fill: '#aa3366' }, hiddenLayers: { roads: true } },
      chartOverrides: { ranked: { kind: 'bar-horizontal', limit: 4 } },
      config: { title: 'Custom title', source: 'Source: custom', customColors: ['#111111', '#222222'] },
      datasetMeta: { publisher: 'ACME Stats', synthetic: true },
      annotations: [{ id: 'a1', type: 'text', text: 'note', x: 10, y: 10, color: '#fff', size: 12 }],
      filters: [{ id: 'f1', label: 'Margin', field: 'margin', operator: '<', value: '5', active: true }],
      brandKit: { id: 'k', name: 'Verify', colors: ['#eef8ff'], fontFamily: 'Inter', sourcePrefix: 'Source:', logoDataUrl: 'data:image/png;base64,AAAA' },
      videoSpec: { showLogo: true, durationSeconds: 5, fps: 10 },
    },
  };

  it('accepts chart overrides, brand kit, annotations, filters and attribution', () => {
    const parsed = VideoRenderRequestSchema.parse(customised);
    expect(parsed.document.chartOverrides.ranked).toMatchObject({ kind: 'bar-horizontal', limit: 4 });
    expect(parsed.document.brandKit?.logoDataUrl).toBe('data:image/png;base64,AAAA');
    expect(parsed.document.annotations).toHaveLength(1);
    expect(parsed.document.filters).toHaveLength(1);
    expect(parsed.document.datasetMeta).toMatchObject({ publisher: 'ACME Stats', synthetic: true });
  });

  it('carries the geography a renderer must restore, not just a country', () => {
    const parsed = VideoRenderRequestSchema.parse(customised);
    expect(parsed.document.geography).toMatchObject({ viewMode: 'usa-counties', districtScope: '06', focusPlace: 'California' });
  });

  it('carries the map style and hidden layers', () => {
    const parsed = VideoRenderRequestSchema.parse(customised);
    expect(parsed.document.presentation.style).toMatchObject({ fill: '#aa3366' });
    expect(parsed.document.presentation.hiddenLayers).toEqual({ roads: true });
  });

  it('keeps showLogo in the spec so the logo is opt-in', () => {
    expect(VideoSpecSchema.parse({}).showLogo).toBe(false);
    expect(VideoSpecSchema.parse({ showLogo: true }).showLogo).toBe(true);
  });

  it('refuses a request that still sends the old project field', () => {
    const { document: _document, ...withoutDocument } = customised;
    expect(() => VideoRenderRequestSchema.parse({ ...withoutDocument, project: { rows: [], config: {}, annotations: [] } })).toThrow();
  });
});
