import { buildChartModel, DEFAULT_CHART_SPEC, type ChartDatum } from './charts';
import { formatDataValue, parseNumericValue, type DataRow, type InfographicConfig } from './infographic';
import { DEFAULT_AUDIO_TRACK, type AudioTrackSpec } from './audioLibrary';

export type VideoFormat = 'mp4' | 'webm' | 'gif';
export type VideoPreset = 'landscape-1080' | 'vertical-1080' | 'square-1080' | 'landscape-4k';
export type VideoMode = 'year-choropleth' | 'bar-race' | 'camera-tour' | 'counter';
export type TransitionKind = 'none' | 'fade' | 'wipe';

export type VideoSpec = {
  mode: VideoMode;
  preset: VideoPreset;
  format: VideoFormat;
  durationSeconds: number;
  fps: number;
  /** Seconds of still title card before the animation starts. */
  introSeconds: number;
  outroSeconds: number;
  transition: TransitionKind;
  showTitle: boolean;
  showSource: boolean;
  showLogo: boolean;
  /** Top N tracked in a bar-chart race. */
  raceSize: number;
  loop: boolean;
  audioTrack?: AudioTrackSpec;
};

export const DEFAULT_VIDEO_SPEC: VideoSpec = {
  mode: 'year-choropleth',
  preset: 'landscape-1080',
  format: 'mp4',
  durationSeconds: 12,
  fps: 30,
  introSeconds: 1.5,
  outroSeconds: 1.5,
  transition: 'fade',
  showTitle: true,
  showSource: true,
  showLogo: false,
  raceSize: 10,
  loop: false,
  audioTrack: { ...DEFAULT_AUDIO_TRACK },
};

export const VIDEO_PRESETS: Record<VideoPreset, { label: string; width: number; height: number }> = {
  'landscape-1080': { label: '1080p landscape · 1920×1080', width: 1920, height: 1080 },
  'vertical-1080': { label: 'Vertical · 1080×1920', width: 1080, height: 1920 },
  'square-1080': { label: 'Square · 1080×1080', width: 1080, height: 1080 },
  'landscape-4k': { label: '4K landscape · 3840×2160', width: 3840, height: 2160 },
};

export const VIDEO_FORMATS: Record<VideoFormat, { label: string; mimeType: string; extension: string }> = {
  mp4: { label: 'MP4 · H.264', mimeType: 'video/mp4', extension: 'mp4' },
  webm: { label: 'WebM · VP9', mimeType: 'video/webm', extension: 'webm' },
  gif: { label: 'GIF · looping', mimeType: 'image/gif', extension: 'gif' },
};

export type RaceBar = {
  key: string;
  label: string;
  value: number;
  formatted: string;
  color: string;
  /** 0–1 share of the widest bar in this frame. */
  width: number;
  /** Fractional rank, so bars slide rather than jump between ranks. */
  position: number;
};

export type FrameState = {
  frame: number;
  totalFrames: number;
  time: number;
  /** 0–1 across the animated body, excluding intro and outro. */
  progress: number;
  phase: 'intro' | 'body' | 'outro';
  /** Opacity for title-card and transition fades. */
  opacity: number;
  year?: string;
  /** Interpolation position between `year` and the next year, 0–1. */
  yearProgress: number;
  nextYear?: string;
  camera?: { center: [number, number]; zoom: number; bearing: number };
  bars: RaceBar[];
  counter?: { label: string; value: number; formatted: string };
  caption: string;
};

export function videoDimensions(spec: VideoSpec) {
  return VIDEO_PRESETS[spec.preset];
}

export function totalFrames(spec: VideoSpec) {
  return Math.max(1, Math.round(spec.durationSeconds * spec.fps));
}

export function bodyFrameRange(spec: VideoSpec) {
  const total = totalFrames(spec);
  const intro = Math.min(Math.round(spec.introSeconds * spec.fps), Math.floor(total / 3));
  const outro = Math.min(Math.round(spec.outroSeconds * spec.fps), Math.floor(total / 3));
  return { intro, outro, bodyStart: intro, bodyEnd: Math.max(intro + 1, total - outro), total };
}

const CAMERA_TOUR: Array<{ center: [number, number]; zoom: number; bearing: number }> = [
  { center: [78.96, 22.6], zoom: 4.4, bearing: 0 },
  { center: [77.21, 28.61], zoom: 5.6, bearing: -1.5 },
  { center: [72.88, 19.08], zoom: 5.8, bearing: 1.5 },
  { center: [80.27, 13.08], zoom: 5.7, bearing: 0 },
  { center: [78.96, 22.6], zoom: 4.4, bearing: 0 },
];

/**
 * Computes everything a single frame needs. Deterministic: the same inputs always
 * produce the same frame, so the browser preview and the server render match.
 */
export function frameState(spec: VideoSpec, frame: number, rows: DataRow[], config: InfographicConfig, years: string[]): FrameState {
  const { intro, bodyStart, bodyEnd, total } = bodyFrameRange(spec);
  const clamped = Math.max(0, Math.min(frame, total - 1));
  const phase: FrameState['phase'] = clamped < bodyStart ? 'intro' : clamped >= bodyEnd ? 'outro' : 'body';
  const bodyFrames = Math.max(1, bodyEnd - bodyStart);
  const progress = phase === 'intro' ? 0 : phase === 'outro' ? 1 : (clamped - bodyStart) / bodyFrames;

  const fadeFrames = spec.transition === 'none' ? 0 : Math.max(1, Math.round(spec.fps * 0.4));
  const opacity = spec.transition === 'none'
    ? 1
    : clamped < fadeFrames
      ? clamped / fadeFrames
      : clamped > total - 1 - fadeFrames
        ? Math.max(0, (total - 1 - clamped) / fadeFrames)
        : 1;

  const timeline = yearAtProgress(years, progress);
  const year = timeline.year;
  const activeRows = year ? rows.filter((row) => !row.year || row.year === year) : rows;

  const bars = spec.mode === 'bar-race'
    ? raceBars(rows, config, years, timeline, spec.raceSize)
    : [];

  const counter = spec.mode === 'counter' ? counterValue(activeRows, config, progress) : undefined;

  const camera = spec.mode === 'camera-tour' ? cameraAt(progress) : undefined;

  return {
    frame: clamped,
    totalFrames: total,
    time: clamped / spec.fps,
    progress,
    phase,
    opacity,
    year,
    yearProgress: timeline.yearProgress,
    nextYear: timeline.nextYear,
    camera,
    bars,
    counter,
    caption: phase === 'intro' ? config.title : year ? `${config.title} · ${year}` : config.title,
  };
}

function yearAtProgress(years: string[], progress: number) {
  if (!years.length) return { year: undefined, nextYear: undefined, yearProgress: 0 };
  if (years.length === 1) return { year: years[0], nextYear: undefined, yearProgress: 0 };
  const scaled = Math.max(0, Math.min(1, progress)) * (years.length - 1);
  // Clamping to the last index (not the second-to-last) makes the final frame
  // land on the final year instead of holding the previous one.
  const index = Math.min(Math.floor(scaled), years.length - 1);
  return { year: years[index], nextYear: years[index + 1], yearProgress: scaled - index };
}

/**
 * Builds the bars for a chart race, interpolating both value and rank between the
 * current and the next year so bars glide instead of snapping.
 */
export function raceBars(rows: DataRow[], config: InfographicConfig, years: string[], timeline: { year?: string; nextYear?: string; yearProgress: number }, size: number): RaceBar[] {
  const spec = { ...DEFAULT_CHART_SPEC, kind: 'ranked-bar' as const, limit: Math.max(1, size) };
  const current = buildChartModel(spec, rows, config, timeline.year);
  const next = timeline.nextYear ? buildChartModel(spec, rows, config, timeline.nextYear) : current;
  const blend = timeline.nextYear ? timeline.yearProgress : 0;

  const byKey = new Map<string, { current?: ChartDatum; next?: ChartDatum }>();
  for (const datum of current.data) byKey.set(datum.key, { ...byKey.get(datum.key), current: datum });
  for (const datum of next.data) byKey.set(datum.key, { ...byKey.get(datum.key), next: datum });

  const merged = [...byKey.entries()].map(([key, pair]) => {
    const from = pair.current ?? pair.next!;
    const to = pair.next ?? pair.current!;
    const value = from.value + (to.value - from.value) * blend;
    const rank = (pair.current?.rank ?? size + 1) + ((pair.next?.rank ?? size + 1) - (pair.current?.rank ?? size + 1)) * blend;
    return { key, label: from.label, value, rank, color: from.color };
  });

  const visible = merged.sort((first, second) => first.rank - second.rank).slice(0, Math.max(1, size));
  const widest = Math.max(...visible.map((entry) => entry.value), 1);
  return visible.map((entry, index) => ({
    key: entry.key,
    label: entry.label,
    value: entry.value,
    formatted: formatDataValue(entry.value, config),
    color: entry.color,
    width: Math.max(0, entry.value) / widest,
    position: index,
  }));
}

function counterValue(rows: DataRow[], config: InfographicConfig, progress: number) {
  const values = rows.map((row) => parseNumericValue(row.value)).filter((value): value is number => value !== null);
  if (!values.length) return undefined;
  const total = values.reduce((sum, value) => sum + value, 0);
  const eased = easeOutCubic(Math.max(0, Math.min(1, progress)));
  const value = total * eased;
  return { label: 'Total', value, formatted: formatDataValue(value, config) };
}

function cameraAt(progress: number) {
  const scaled = Math.max(0, Math.min(1, progress)) * (CAMERA_TOUR.length - 1);
  const index = Math.min(Math.floor(scaled), CAMERA_TOUR.length - 2);
  const local = scaled - index;
  const start = CAMERA_TOUR[index];
  const end = CAMERA_TOUR[index + 1];
  return {
    center: [lerp(start.center[0], end.center[0], local), lerp(start.center[1], end.center[1], local)] as [number, number],
    zoom: lerp(start.zoom, end.zoom, local),
    bearing: lerp(start.bearing, end.bearing, local),
  };
}

function easeOutCubic(value: number) {
  return 1 - (1 - value) ** 3;
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

/** Rough guide for the UI. Real size depends on the encoder and the content. */
export function estimatedFileSizeMb(spec: VideoSpec) {
  const { width, height } = videoDimensions(spec);
  const pixels = width * height;
  const perFrameKb = spec.format === 'gif' ? pixels / 5_000 : pixels / 24_000;
  return Math.max(0.1, Math.round(((perFrameKb * totalFrames(spec)) / 1024) * 10) / 10);
}
