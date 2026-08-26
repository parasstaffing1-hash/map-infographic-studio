import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { encodeFrames } from '../services/render-platform/src/ffmpeg.js';
import { captureFrames } from '../services/render-platform/src/video-renderer.js';
import { infographicTemplates, rowsForInfographicTemplate, configForInfographicTemplate } from '../src/domain/infographicTemplates.js';
import { VIDEO_DIMENSIONS } from '../services/render-platform/src/video-contracts.js';
import { getPresetTrackDataUri, COPYRIGHT_FREE_LIBRARY } from '../src/domain/audioLibrary.js';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ffmpegPath = 'C:\\Users\\HP\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.2-full_build\\bin\\ffmpeg.exe';
const webAppUrl = 'http://127.0.0.1:4173';

console.log('='.repeat(70));
console.log('🎵 RENDERING CINEMATIC VIDEO WITH COPYRIGHT-FREE MUSIC');
console.log('='.repeat(70));

const template = infographicTemplates.find((t) => t.id === 'world_gdp_top_15_1960_2026')!;
const rows = rowsForInfographicTemplate(template);
const config = configForInfographicTemplate(template);

const trackMeta = COPYRIGHT_FREE_LIBRARY[0];
console.log(`Audio Track: ${trackMeta.name} (${trackMeta.categoryLabel})`);
console.log(`Audio Mood: ${trackMeta.mood}`);

const audioDataUri = getPresetTrackDataUri(trackMeta.id, 60);

const spec = {
  mode: 'bar-race' as const,
  preset: 'landscape-1080' as const,
  format: 'mp4' as const,
  durationSeconds: 4,
  fps: 24,
  introSeconds: 0.5,
  outroSeconds: 0.5,
  transition: 'fade' as const,
  showTitle: true,
  showSource: true,
  showLogo: false,
  raceSize: 15,
  loop: false,
  audioTrack: {
    id: trackMeta.id,
    name: trackMeta.name,
    source: 'preset' as const,
    category: trackMeta.category,
    audioData: audioDataUri,
    volume: 0.8,
    fadeInSeconds: 1.0,
    fadeOutSeconds: 1.5,
    loop: true,
  },
};

const dimensions = VIDEO_DIMENSIONS[spec.preset];
const request = {
  idempotencyKey: `audio-test-${Date.now()}`,
  templateId: 'world-gdp-audio-demo',
  viewMode: 'world' as const,
  compositionId: 'world-gdp-race',
  document: {
    schemaVersion: 2,
    name: 'Top 15 Economies with Cinematic Soundtrack',
    geography: { viewMode: 'world' as const, selectedIds: [] },
    presentation: { style: { fill: '#2f83b5' }, hiddenLayers: {} },
    compositionId: 'world-gdp-race',
    chartOverrides: {},
    config,
    rows,
    annotations: [],
    currentYear: rows.find((r) => r.year)?.year ?? '2024',
    datasetMeta: { publisher: '', releaseDate: '', notes: '', synthetic: false },
    regionOverrides: {},
    filters: [],
    videoSpec: spec,
  },
  project: { rows, config, annotations: [], currentYear: rows.find((r) => r.year)?.year },
  spec,
  outputPrefix: 'stress-test',
};

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
try {
  console.log('Capturing video frames...');
  const frames = await captureFrames(browser, { WEB_APP_URL: webAppUrl, RENDER_TIMEOUT_MS: 120000 } as never, request, (r, t) => {
    if (r === 1 || r === t || r % 24 === 0) console.log(`Frame ${r}/${t}`);
  });

  console.log('Multiplexing video and audio with FFmpeg (AAC 192k)...');
  const encoded = await encodeFrames(frames, {
    format: spec.format,
    fps: spec.fps,
    width: dimensions.width,
    height: dimensions.height,
    ffmpegPath,
    timeoutMs: 600000,
    audio: {
      audioData: audioDataUri,
      volume: spec.audioTrack.volume,
      fadeInSeconds: spec.audioTrack.fadeInSeconds,
      fadeOutSeconds: spec.audioTrack.fadeOutSeconds,
      durationSeconds: spec.durationSeconds,
    },
  });

  const outputPath = 'outputs/stress-test/01-world-gdp-with-soundtrack.mp4';
  await writeFile(outputPath, encoded);
  console.log(`✅ Success! Rendered with soundtrack: ${outputPath} (${(encoded.byteLength / 1024 / 1024).toFixed(2)} MB)`);

  // Probe with FFmpeg to confirm audio stream is present
  const probe = spawn(ffmpegPath, ['-hide_banner', '-i', outputPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderrChunks: Buffer[] = [];
  probe.stderr.on('data', (c: Buffer) => stderrChunks.push(c));
  probe.on('close', () => {
    const info = Buffer.concat(stderrChunks).toString('utf8');
    const hasAudioStream = info.includes('Audio: aac');
    const hasVideoStream = info.includes('Video: h264');
    console.log(`Audio Stream (AAC): ${hasAudioStream ? '✅ PRESENT' : '❌ MISSING'}`);
    console.log(`Video Stream (H.264): ${hasVideoStream ? '✅ PRESENT' : '❌ MISSING'}`);
  });
} finally {
  await browser.close();
}
