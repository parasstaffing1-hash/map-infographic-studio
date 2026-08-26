import type { Browser, Page } from 'playwright-core';
import type { PlatformConfig } from './config.js';
import { VIDEO_DIMENSIONS, videoFrameCount, type VideoRenderRequest } from './video-contracts.js';

/**
 * The contract the browser app exposes in render mode. Kept in one place so the
 * app and the renderer cannot drift apart silently.
 */
export type FrameBridge = {
  ready: boolean;
  totalFrames: number;
  setFrame: (frame: number) => void;
  settled: boolean;
};

declare global {
  interface Window {
    __mapStudioVideo?: FrameBridge;
  }
}

export type FrameProgress = (framesRendered: number, totalFrames: number) => void | Promise<void>;

export function videoPageUrl(config: PlatformConfig, request: VideoRenderRequest) {
  const url = new URL(config.WEB_APP_URL);
  url.searchParams.set('render', '1');
  url.searchParams.set('mode', 'video');
  // The document is authoritative; these only prime the page before it loads.
  const geography = request.document.geography;
  url.searchParams.set('viewMode', String(geography?.viewMode ?? request.viewMode));
  url.searchParams.set('composition', request.document.compositionId ?? request.compositionId);
  if (geography?.districtScope) url.searchParams.set('districtScope', geography.districtScope);
  return url.toString();
}

/**
 * Opens the composed infographic and captures one screenshot per frame.
 *
 * The screenshot targets `.map-frame`, which contains the whole composition —
 * map, charts, titles, legend and source — not just the MapLibre canvas.
 */
export async function captureFrames(
  browser: Browser,
  config: PlatformConfig,
  request: VideoRenderRequest,
  onProgress?: FrameProgress,
  signal?: AbortSignal,
): Promise<AsyncGenerator<Buffer>> {
  const { width, height } = VIDEO_DIMENSIONS[request.spec.preset];
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });

  const page = await context.newPage();
  const doc = request.document ?? {
    schemaVersion: 2,
    name: request.templateId,
    geography: { viewMode: request.viewMode, selectedIds: [] },
    presentation: { style: { fill: '#2f83b5' }, hiddenLayers: {} },
    compositionId: request.compositionId,
    chartOverrides: {},
    config: (request as unknown as { project?: { config?: unknown } })?.project?.config ?? {},
    rows: (request as unknown as { project?: { rows?: unknown[] } })?.project?.rows ?? [],
    annotations: (request as unknown as { project?: { annotations?: unknown[] } })?.project?.annotations ?? [],
    currentYear: (request as unknown as { project?: { currentYear?: string } })?.project?.currentYear,
    datasetMeta: { publisher: '', releaseDate: '', notes: '', synthetic: false },
    regionOverrides: {},
    filters: [],
    videoSpec: request.spec,
  };

  await page.addInitScript(
    ([document, spec]) => {
      localStorage.setItem('map-studio-render-document', JSON.stringify(document));
      localStorage.setItem('map-studio-video-spec', JSON.stringify(spec));
      localStorage.setItem('map-studio-infographic-v1', JSON.stringify({
        rows: (document as { rows?: unknown[] })?.rows ?? [],
        config: (document as { config?: unknown })?.config ?? {},
        annotations: (document as { annotations?: unknown[] })?.annotations ?? [],
        currentYear: (document as { currentYear?: string })?.currentYear,
      }));
    },
    [doc, request.spec] as const,
  );

  await page.goto(videoPageUrl(config, request), { waitUntil: 'domcontentloaded', timeout: config.RENDER_TIMEOUT_MS });
  await page.locator('.map-frame').waitFor({ state: 'visible', timeout: config.RENDER_TIMEOUT_MS });
  await page.waitForFunction(() => window.__mapStudioVideo?.ready === true, undefined, { timeout: config.RENDER_TIMEOUT_MS });
  await waitForMapPaint(page, config.RENDER_TIMEOUT_MS);

  const total = videoFrameCount(request.spec);
  const frame = page.locator('.map-frame');

  async function* generate() {
    try {
      for (let index = 0; index < total; index += 1) {
        if (signal?.aborted) throw new Error('Render canceled');
        await page.evaluate((value) => window.__mapStudioVideo?.setFrame(value), index);
        await page.waitForFunction(() => window.__mapStudioVideo?.settled === true, undefined, { timeout: config.RENDER_TIMEOUT_MS });
        yield await frame.screenshot({ type: 'png', animations: 'disabled', timeout: config.RENDER_TIMEOUT_MS });
        if (onProgress && (index % 10 === 0 || index === total - 1)) await onProgress(index + 1, total);
      }
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  return generate();
}

async function waitForMapPaint(page: Page, timeout: number) {
  const canvas = page.locator('.maplibregl-canvas');
  if ((await canvas.count()) === 0) return;
  await canvas.waitFor({ state: 'visible', timeout }).catch(() => undefined);
  await page.waitForFunction(
    () => {
      const element = document.querySelector<HTMLCanvasElement>('.maplibregl-canvas');
      return Boolean(element && element.width > 0 && element.height > 0);
    },
    undefined,
    { timeout },
  ).catch(() => undefined);
}
