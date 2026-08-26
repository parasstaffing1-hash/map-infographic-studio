import { chromium } from 'playwright-core';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, resolve } from 'node:path';
import { encodeFrames, probeFfmpeg } from '../services/render-platform/src/ffmpeg.js';
import { captureFrames } from '../services/render-platform/src/video-renderer.js';
import { configForInfographicTemplate, infographicTemplates, rowsForInfographicTemplate } from '../src/domain/infographicTemplates.js';
import { VIDEO_DIMENSIONS, videoFrameCount, type VideoRenderRequest } from '../services/render-platform/src/video-contracts.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const smoke = args.includes('--smoke');
const outputArg = args.find((arg) => !arg.startsWith('--')) ?? 'outputs/local/world-gdp-race.mp4';
const outputPath = isAbsolute(outputArg) ? outputArg : resolve(root, outputArg);

const chromePath = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ffmpegPath = process.env.FFMPEG_PATH ?? 'C:\\Users\\HP\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.2-full_build\\bin\\ffmpeg.exe';
const webAppUrl = process.env.MAP_STUDIO_URL ?? 'http://127.0.0.1:4174';
const template = infographicTemplates.find((entry) => entry.id === 'world_gdp_top_15_1960_2026');

if (!template) throw new Error('GDP template world_gdp_top_15_1960_2026 is not available');
await access(chromePath).catch(() => { throw new Error(`Chrome was not found at ${chromePath}. Set CHROME_PATH to a local Chrome/Chromium executable.`); });
const ffmpegProbe = await probeFfmpeg(ffmpegPath);
if (!ffmpegProbe.available) throw new Error(`FFmpeg is not available at ${ffmpegPath}: ${ffmpegProbe.error ?? 'unknown error'}`);

const spec = {
  mode: 'bar-race' as const,
  preset: 'landscape-1080' as const,
  format: 'mp4' as const,
  durationSeconds: smoke ? 1 : 300,
  fps: 30,
  introSeconds: 1.5,
  outroSeconds: 1.5,
  transition: 'fade' as const,
  showTitle: true,
  showSource: true,
  showLogo: false,
  raceSize: 15,
  loop: false,
};
const config = configForInfographicTemplate(template);
const rows = rowsForInfographicTemplate(template);
const request = {
  idempotencyKey: `local-${Date.now()}`,
  templateId: template.id,
  viewMode: 'world' as const,
  compositionId: template.compositionId ?? 'world-gdp-race',
  project: { rows, config, annotations: [], currentYear: '2026' },
  spec,
  outputPrefix: 'videos',
} satisfies VideoRenderRequest;
const dimensions = VIDEO_DIMENSIONS[spec.preset];
const totalFrames = videoFrameCount(spec);

console.log(`Local render: ${template.title}`);
console.log(`Source: ${webAppUrl} · ${rows.length} rows · ${totalFrames} frames · ${dimensions.width}×${dimensions.height}`);
console.log(`Encoder: ${ffmpegProbe.version ?? ffmpegPath}`);
if (smoke) console.log('Smoke mode: rendering 1 second for a quick local verification.');

await mkdir(dirname(outputPath), { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const frames = await captureFrames(
    browser,
    { WEB_APP_URL: webAppUrl, RENDER_TIMEOUT_MS: 120_000 } as never,
    request,
    (rendered, total) => {
      if (rendered === 1 || rendered === total || rendered % 300 === 0) {
        console.log(`Frames: ${rendered}/${total} (${Math.round((rendered / total) * 100)}%)`);
      }
    },
  );
  const encoded = await encodeFrames(frames, {
    format: spec.format,
    fps: spec.fps,
    width: dimensions.width,
    height: dimensions.height,
    quality: 21,
    loop: spec.loop,
    ffmpegPath,
    timeoutMs: smoke ? 120_000 : 1_800_000,
  });
  await writeFile(outputPath, encoded);
  console.log(`Completed: ${outputPath}`);
  console.log(`Size: ${(encoded.byteLength / 1024 / 1024).toFixed(1)} MB`);
} finally {
  await browser.close();
}
