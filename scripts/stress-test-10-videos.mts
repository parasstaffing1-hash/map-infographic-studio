import { chromium } from 'playwright-core';
import { access, mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { encodeFrames, probeFfmpeg } from '../services/render-platform/src/ffmpeg.js';
import { captureFrames } from '../services/render-platform/src/video-renderer.js';
import { configForInfographicTemplate, infographicTemplates, rowsForInfographicTemplate } from '../src/domain/infographicTemplates.js';
import { CURATED_DATASETS } from '../src/domain/curatedDatasets.js';
import { VIDEO_DIMENSIONS, videoFrameCount, type VideoRenderRequest, type VideoSpec } from '../services/render-platform/src/video-contracts.js';
import type { DataRow, InfographicConfig } from '../src/domain/infographic.js';
import type { ViewMode } from '../src/domain/types.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chromePath = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ffmpegPath = process.env.FFMPEG_PATH ?? 'C:\\Users\\HP\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.2-full_build\\bin\\ffmpeg.exe';
const webAppUrl = process.env.MAP_STUDIO_URL ?? 'http://127.0.0.1:4173';
const outputDir = resolve(root, 'outputs', 'stress-test');

await access(chromePath).catch(() => { throw new Error(`Chrome was not found at ${chromePath}`); });
const ffmpegProbe = await probeFfmpeg(ffmpegPath);
if (!ffmpegProbe.available) throw new Error(`FFmpeg is not available at ${ffmpegPath}`);

await mkdir(outputDir, { recursive: true });

type TestCase = {
  id: string;
  title: string;
  viewMode: ViewMode;
  compositionId: string;
  spec: VideoSpec;
  getRows: () => DataRow[];
  getConfig: () => InfographicConfig;
};

const testCases: TestCase[] = [
  // 1. World Top 15 GDP Bar Race
  {
    id: '01-world-gdp-race',
    title: 'Top 15 Economies by GDP (1960–2026)',
    viewMode: 'world',
    compositionId: 'world-gdp-race',
    spec: {
      mode: 'bar-race',
      preset: 'landscape-1080',
      format: 'mp4',
      durationSeconds: 3,
      fps: 24,
      introSeconds: 0.5,
      outroSeconds: 0.5,
      transition: 'fade',
      showTitle: true,
      showSource: true,
      showLogo: false,
      raceSize: 15,
      loop: false,
    },
    getRows: () => {
      const t = infographicTemplates.find((entry) => entry.id === 'world_gdp_top_15_1960_2026')!;
      return rowsForInfographicTemplate(t);
    },
    getConfig: () => {
      const t = infographicTemplates.find((entry) => entry.id === 'world_gdp_top_15_1960_2026')!;
      return configForInfographicTemplate(t);
    },
  },
  // 2. India Renewable Clean Energy
  {
    id: '02-india-clean-energy',
    title: 'India State-wise Clean Energy Installed Capacity (GW)',
    viewMode: 'india',
    compositionId: 'social-landscape',
    spec: {
      mode: 'year-choropleth',
      preset: 'vertical-1080',
      format: 'mp4',
      durationSeconds: 3,
      fps: 24,
      introSeconds: 0.5,
      outroSeconds: 0.5,
      transition: 'fade',
      showTitle: true,
      showSource: true,
      showLogo: false,
      loop: false,
    },
    getRows: () => CURATED_DATASETS.find((d) => d.id === 'india_clean_energy')!.rows,
    getConfig: () => ({
      title: 'India Renewable Energy Capacity (GW)',
      subtitle: 'Solar & Wind Installed Capacity by State',
      source: 'Source: Ministry of New and Renewable Energy (MNRE)',
      note: '2024 Report',
      paletteId: 'emerald',
      customColors: [],
      scaleMode: 'continuous',
      classes: 5,
      customBreaks: '',
      missingMode: 'grey',
      missingColor: '#d7dde5',
      zeroMode: 'normal',
      zeroColor: '#d7dde5',
      labelMode: 'both',
      prefix: '',
      suffix: ' GW',
      decimals: 1,
      numberFormat: 'standard',
      showLegend: true,
      showTitle: true,
      showSource: true,
      background: '#064e3b',
      aspect: '9:16',
      resolution: 'hd',
      aggregation: 'last',
      presentation: 'editorial',
    }),
  },
  // 3. India State GSDP Powerhouses
  {
    id: '03-india-gsdp-powerhouses',
    title: 'India State-wise GSDP Rankings (₹ Lakh Crore)',
    viewMode: 'india',
    compositionId: 'canvas-default',
    spec: {
      mode: 'bar-race',
      preset: 'landscape-1080',
      format: 'mp4',
      durationSeconds: 3,
      fps: 24,
      introSeconds: 0.5,
      outroSeconds: 0.5,
      transition: 'fade',
      showTitle: true,
      showSource: true,
      showLogo: false,
      raceSize: 12,
      loop: false,
    },
    getRows: () => CURATED_DATASETS.find((d) => d.id === 'india_state_gsdp')!.rows,
    getConfig: () => ({
      title: 'India State-wise GSDP (2023–24)',
      subtitle: 'Gross State Domestic Product in ₹ Lakh Crore',
      source: 'Source: Ministry of Statistics & Programme Implementation (MOSPI)',
      note: 'Advance Estimates',
      paletteId: 'ladakh',
      customColors: [],
      scaleMode: 'continuous',
      classes: 5,
      customBreaks: '',
      missingMode: 'grey',
      missingColor: '#d7dde5',
      zeroMode: 'normal',
      zeroColor: '#d7dde5',
      labelMode: 'both',
      prefix: '₹',
      suffix: ' L Cr',
      decimals: 1,
      numberFormat: 'indian',
      showLegend: true,
      showTitle: true,
      showSource: true,
      background: '#f7f9fc',
      aspect: '16:9',
      resolution: 'hd',
      aggregation: 'last',
      presentation: 'standard',
    }),
  },
  // 4. World CO2 Emissions per Capita
  {
    id: '04-world-co2-emissions',
    title: 'Global CO2 Emissions per Capita (Tons/Year)',
    viewMode: 'world',
    compositionId: 'social-square',
    spec: {
      mode: 'year-choropleth',
      preset: 'square-1080',
      format: 'mp4',
      durationSeconds: 3,
      fps: 24,
      introSeconds: 0.5,
      outroSeconds: 0.5,
      transition: 'fade',
      showTitle: true,
      showSource: true,
      showLogo: false,
      loop: false,
    },
    getRows: () => CURATED_DATASETS.find((d) => d.id === 'world_co2_per_capita')!.rows,
    getConfig: () => ({
      title: 'Global CO2 Emissions per Capita',
      subtitle: 'Annual metric tons of territorial CO2 emitted per person',
      source: 'Source: Global Carbon Project · OWID',
      note: '2024 Report',
      paletteId: 'magma',
      customColors: [],
      scaleMode: 'continuous',
      classes: 5,
      customBreaks: '',
      missingMode: 'grey',
      missingColor: '#d7dde5',
      zeroMode: 'normal',
      zeroColor: '#d7dde5',
      labelMode: 'name',
      prefix: '',
      suffix: ' t',
      decimals: 1,
      numberFormat: 'standard',
      showLegend: true,
      showTitle: true,
      showSource: true,
      background: '#18181b',
      aspect: '1:1',
      resolution: 'hd',
      aggregation: 'last',
      presentation: 'editorial',
    }),
  },
  // 5. USA State GDP Engine
  {
    id: '05-usa-state-gdp',
    title: 'USA State GDP ($ Billion)',
    viewMode: 'usa',
    compositionId: 'canvas-default',
    spec: {
      mode: 'bar-race',
      preset: 'landscape-1080',
      format: 'mp4',
      durationSeconds: 3,
      fps: 24,
      introSeconds: 0.5,
      outroSeconds: 0.5,
      transition: 'fade',
      showTitle: true,
      showSource: true,
      showLogo: false,
      raceSize: 12,
      loop: false,
    },
    getRows: () => CURATED_DATASETS.find((d) => d.id === 'usa_state_gdp')!.rows,
    getConfig: () => ({
      title: 'USA State Gross Domestic Product ($B)',
      subtitle: 'Annualized Real-Time Economic Output by State',
      source: 'Source: U.S. Bureau of Economic Analysis (BEA)',
      note: '2024 BEA',
      paletteId: 'bengaluru',
      customColors: [],
      scaleMode: 'continuous',
      classes: 5,
      customBreaks: '',
      missingMode: 'grey',
      missingColor: '#d7dde5',
      zeroMode: 'normal',
      zeroColor: '#d7dde5',
      labelMode: 'both',
      prefix: '$',
      suffix: 'B',
      decimals: 0,
      numberFormat: 'metric',
      showLegend: true,
      showTitle: true,
      showSource: true,
      background: '#f8fafc',
      aspect: '16:9',
      resolution: 'hd',
      aggregation: 'last',
      presentation: 'standard',
    }),
  },
  // 6. World Megacities Urbanization
  {
    id: '06-world-megacities',
    title: 'Rise of Global Megacities (10M+ Population)',
    viewMode: 'world',
    compositionId: 'canvas-default',
    spec: {
      mode: 'counter',
      preset: 'landscape-1080',
      format: 'mp4',
      durationSeconds: 3,
      fps: 24,
      introSeconds: 0.5,
      outroSeconds: 0.5,
      transition: 'fade',
      showTitle: true,
      showSource: true,
      showLogo: false,
      loop: false,
    },
    getRows: () => {
      const t = infographicTemplates.find((entry) => entry.id === 'world_megacities_urbanization')!;
      return rowsForInfographicTemplate(t);
    },
    getConfig: () => {
      const t = infographicTemplates.find((entry) => entry.id === 'world_megacities_urbanization')!;
      return configForInfographicTemplate(t);
    },
  },
  // 7. India State-wise Literacy Rates (%)
  {
    id: '07-india-literacy-rates',
    title: 'India State-wise Literacy Rates (%)',
    viewMode: 'india',
    compositionId: 'map-only',
    spec: {
      mode: 'year-choropleth',
      preset: 'vertical-1080',
      format: 'mp4',
      durationSeconds: 3,
      fps: 24,
      introSeconds: 0.5,
      outroSeconds: 0.5,
      transition: 'fade',
      showTitle: true,
      showSource: true,
      showLogo: false,
      loop: false,
    },
    getRows: () => CURATED_DATASETS.find((d) => d.id === 'india_literacy_rate')!.rows,
    getConfig: () => ({
      title: 'India State-wise Literacy Rates (%)',
      subtitle: 'National Statistical Office (NSO) Survey & Census Data',
      source: 'Source: National Statistical Office (NSO) · Government of India',
      note: 'Key Indicators',
      paletteId: 'kerala',
      customColors: [],
      scaleMode: 'continuous',
      classes: 5,
      customBreaks: '',
      missingMode: 'grey',
      missingColor: '#d7dde5',
      zeroMode: 'normal',
      zeroColor: '#d7dde5',
      labelMode: 'both',
      prefix: '',
      suffix: '%',
      decimals: 1,
      numberFormat: 'standard',
      showLegend: true,
      showTitle: true,
      showSource: true,
      background: '#f8fafc',
      aspect: '9:16',
      resolution: 'hd',
      aggregation: 'last',
      presentation: 'standard',
    }),
  },
  // 8. Global Electric Vehicle Sales Race (WebM format test)
  {
    id: '08-ev-sales-race',
    title: 'Global Electric Vehicle Deliveries (BYD, Tesla, VW)',
    viewMode: 'world',
    compositionId: 'social-square',
    spec: {
      mode: 'bar-race',
      preset: 'square-1080',
      format: 'webm',
      durationSeconds: 3,
      fps: 24,
      introSeconds: 0.5,
      outroSeconds: 0.5,
      transition: 'fade',
      showTitle: true,
      showSource: true,
      showLogo: false,
      raceSize: 8,
      loop: false,
    },
    getRows: () => {
      const t = infographicTemplates.find((entry) => entry.id === 'ev_global_sales_revolution')!;
      return rowsForInfographicTemplate(t);
    },
    getConfig: () => {
      const t = infographicTemplates.find((entry) => entry.id === 'ev_global_sales_revolution')!;
      return configForInfographicTemplate(t);
    },
  },
  // 9. Uttarakhand District Population & Geography (Camera Tour)
  {
    id: '09-uttarakhand-camera-tour',
    title: 'Uttarakhand District Population & Himalayan Topography',
    viewMode: 'district',
    compositionId: 'canvas-default',
    spec: {
      mode: 'camera-tour',
      preset: 'landscape-1080',
      format: 'mp4',
      durationSeconds: 3,
      fps: 24,
      introSeconds: 0.5,
      outroSeconds: 0.5,
      transition: 'fade',
      showTitle: true,
      showSource: true,
      showLogo: false,
      loop: false,
    },
    getRows: () => CURATED_DATASETS.find((d) => d.id === 'uttarakhand_district_pop')!.rows,
    getConfig: () => ({
      title: 'Uttarakhand District Population Distribution',
      subtitle: 'Census of India Demographic Profile',
      source: 'Source: Directorate of Census Operations, Uttarakhand',
      note: 'State Geography',
      paletteId: 'ladakh',
      customColors: [],
      scaleMode: 'continuous',
      classes: 5,
      customBreaks: '',
      missingMode: 'grey',
      missingColor: '#d7dde5',
      zeroMode: 'normal',
      zeroColor: '#d7dde5',
      labelMode: 'both',
      prefix: '',
      suffix: ' L',
      decimals: 2,
      numberFormat: 'indian',
      showLegend: true,
      showTitle: true,
      showSource: true,
      background: '#edf2f8',
      aspect: '16:9',
      resolution: 'hd',
      aggregation: 'last',
      presentation: 'standard',
    }),
  },
  // 10. Central Bank Sovereign Gold Reserves (Animated GIF format test)
  {
    id: '10-gold-reserves-gif',
    title: 'Central Bank Gold Reserves & De-Dollarization',
    viewMode: 'world',
    compositionId: 'social-landscape',
    spec: {
      mode: 'year-choropleth',
      preset: 'landscape-1080',
      format: 'gif',
      durationSeconds: 2,
      fps: 15,
      introSeconds: 0.25,
      outroSeconds: 0.25,
      transition: 'fade',
      showTitle: true,
      showSource: true,
      showLogo: false,
      loop: true,
    },
    getRows: () => {
      const t = infographicTemplates.find((entry) => entry.id === 'central_bank_gold_reserves')!;
      return rowsForInfographicTemplate(t);
    },
    getConfig: () => {
      const t = infographicTemplates.find((entry) => entry.id === 'central_bank_gold_reserves')!;
      return configForInfographicTemplate(t);
    },
  },
];

console.log('='.repeat(70));
console.log('🚀 MAP STUDIO 10-VIDEO REAL DATA STRESS TEST');
console.log(`Target: ${webAppUrl}`);
console.log(`Browser: ${chromePath}`);
console.log(`Encoder: ${ffmpegProbe.version ?? ffmpegPath}`);
console.log(`Output Directory: ${outputDir}`);
console.log('='.repeat(70));

type Result = {
  testId: string;
  title: string;
  format: string;
  resolution: string;
  frames: number;
  captureTimeSec: number;
  encodeTimeSec: number;
  totalTimeSec: number;
  fps: number;
  sizeKb: number;
  path: string;
  status: 'PASS' | 'FAIL';
  error?: string;
};

const results: Result[] = [];
const overallStart = performance.now();

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const args = process.argv.slice(2);
const skipExisting = args.includes('--skip-existing');

try {
  for (let i = 0; i < testCases.length; i++) {
    const test = testCases[i];
    const outputPath = resolve(outputDir, `${test.id}.${test.spec.format}`);
    const dimensions = VIDEO_DIMENSIONS[test.spec.preset];
    const totalFramesCount = videoFrameCount(test.spec);

    console.log(`\n[${i + 1}/10] 🎬 Running: ${test.title}`);
    console.log(`       Mode: ${test.spec.mode} | Format: ${test.spec.format} | Res: ${dimensions.width}×${dimensions.height} | Frames: ${totalFramesCount}`);

    const existing = await stat(outputPath).catch(() => undefined);
    if (skipExisting && existing && existing.size > 1000) {
      console.log(`       ⚡ Existing render detected (${(existing.size / 1024 / 1024).toFixed(2)} MB), skipping...`);
      results.push({
        testId: test.id,
        title: test.title,
        format: test.spec.format,
        resolution: `${dimensions.width}×${dimensions.height}`,
        frames: totalFramesCount,
        captureTimeSec: 0,
        encodeTimeSec: 0,
        totalTimeSec: 0,
        fps: 0,
        sizeKb: Math.round(existing.size / 1024),
        path: outputPath,
        status: 'PASS',
      });
      continue;
    }

    const t0 = performance.now();
    try {
      const rows = test.getRows();
      const config = test.getConfig();
      const request: VideoRenderRequest = {
        document: {
          schemaVersion: 2,
          name: test.title,
          geography: { viewMode: test.viewMode, selectedIds: [] },
          presentation: { style: { fill: '#2f83b5' }, hiddenLayers: {} },
          compositionId: test.compositionId,
          chartOverrides: {},
          config,
          rows,
          annotations: [],
          currentYear: rows.find((r) => r.year)?.year ?? '2024',
          datasetMeta: { publisher: '', releaseDate: '', notes: '', synthetic: false },
          regionOverrides: {},
          filters: [],
          videoSpec: test.spec,
        },
        project: { rows, config, annotations: [], currentYear: rows.find((r) => r.year)?.year },
        spec: test.spec,
        outputPrefix: 'stress-test',
      } as unknown as VideoRenderRequest;

      const captureStart = performance.now();
      const frames = await captureFrames(
        browser,
        { WEB_APP_URL: webAppUrl, RENDER_TIMEOUT_MS: 120_000 } as never,
        request,
        (rendered, total) => {
          if (rendered === 1 || rendered === total || rendered % 24 === 0) {
            process.stdout.write(`\r       Capture progress: ${rendered}/${total} (${Math.round((rendered / total) * 100)}%)`);
          }
        },
      );
      const captureEnd = performance.now();
      const captureSec = (captureEnd - captureStart) / 1000;

      process.stdout.write(`\n       Encoding frames with FFmpeg (${test.spec.format})...\n`);
      const encodeStart = performance.now();
      const encoded = await encodeFrames(frames, {
        format: test.spec.format,
        fps: test.spec.fps,
        width: dimensions.width,
        height: dimensions.height,
        quality: 21,
        loop: test.spec.loop,
        ffmpegPath,
        timeoutMs: 600_000,
      });
      const encodeEnd = performance.now();
      const encodeSec = (encodeEnd - encodeStart) / 1000;

      await writeFile(outputPath, encoded);
      const totalSec = (performance.now() - t0) / 1000;
      const sizeKb = Math.round(encoded.byteLength / 1024);
      const captureFps = totalFramesCount / Math.max(0.01, captureSec);

      console.log(`       ✅ Output: ${(encoded.byteLength / 1024 / 1024).toFixed(2)} MB | Capture: ${captureSec.toFixed(1)}s (${captureFps.toFixed(1)} fps) | Encode: ${encodeSec.toFixed(1)}s | Total: ${totalSec.toFixed(1)}s`);

      results.push({
        testId: test.id,
        title: test.title,
        format: test.spec.format,
        resolution: `${dimensions.width}×${dimensions.height}`,
        frames: totalFramesCount,
        captureTimeSec: Number(captureSec.toFixed(2)),
        encodeTimeSec: Number(encodeSec.toFixed(2)),
        totalTimeSec: Number(totalSec.toFixed(2)),
        fps: Number(captureFps.toFixed(1)),
        sizeKb,
        path: outputPath,
        status: 'PASS',
      });
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      console.error(`       ❌ FAILED: ${errMessage}`);
      results.push({
        testId: test.id,
        title: test.title,
        format: test.spec.format,
        resolution: `${dimensions.width}×${dimensions.height}`,
        frames: totalFramesCount,
        captureTimeSec: 0,
        encodeTimeSec: 0,
        totalTimeSec: Number(((performance.now() - t0) / 1000).toFixed(2)),
        fps: 0,
        sizeKb: 0,
        path: outputPath,
        status: 'FAIL',
        error: errMessage,
      });
    }
  }
} finally {
  await browser.close();
}

const overallSec = ((performance.now() - overallStart) / 1000).toFixed(1);
const passedCount = results.filter((r) => r.status === 'PASS').length;
const totalFramesRendered = results.reduce((acc, r) => acc + (r.status === 'PASS' ? r.frames : 0), 0);
const totalMbProduced = (results.reduce((acc, r) => acc + r.sizeKb, 0) / 1024).toFixed(2);

console.log('\n' + '='.repeat(70));
console.log('📊 STRESS TEST SUMMARY REPORT');
console.log('='.repeat(70));
console.log(`Passed: ${passedCount}/10 videos | Total Frames: ${totalFramesRendered} | Total Data: ${totalMbProduced} MB | Duration: ${overallSec}s`);
console.log('-'.repeat(70));
console.table(
  results.map((r) => ({
    ID: r.testId,
    Title: r.title.slice(0, 30),
    Format: r.format.toUpperCase(),
    Resolution: r.resolution,
    Frames: r.frames,
    'Capture (s)': r.captureTimeSec,
    'Encode (s)': r.encodeTimeSec,
    'Total (s)': r.totalTimeSec,
    'Size (KB)': r.sizeKb,
    Status: r.status,
  })),
);
console.log('='.repeat(70));
