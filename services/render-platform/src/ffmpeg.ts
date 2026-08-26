import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

export type EncodeFormat = 'mp4' | 'webm' | 'gif';

export type AudioEncodeOptions = {
  audioPath?: string;
  audioData?: string; // base64 / data:audio/... URL
  volume?: number; // 0.0 - 1.0 (default 0.75)
  fadeInSeconds?: number; // default 1.0
  fadeOutSeconds?: number; // default 2.0
  durationSeconds?: number; // default 12
};

export type EncodeOptions = {
  format: EncodeFormat;
  fps: number;
  width: number;
  height: number;
  /** Passed to the encoder's quality control. Lower is better quality. */
  quality?: number;
  loop?: boolean;
  ffmpegPath: string;
  timeoutMs: number;
  signal?: AbortSignal;
  audio?: AudioEncodeOptions;
};

/**
 * Builds the argument list for a PNG-sequence encode.
 * Arguments are always passed as a list, never interpolated into a shell string.
 */
export function encoderArguments(options: EncodeOptions, outputPath: string): string[] {
  const scale = `scale=${evenNumber(options.width)}:${evenNumber(options.height)}:flags=lanczos`;
  const input = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(options.fps), '-i', 'pipe:0'];

  const hasAudio = options.audio?.audioPath && options.format !== 'gif';
  if (hasAudio) {
    input.push('-stream_loop', '-1', '-i', options.audio!.audioPath!);
  }

  if (options.format === 'gif') {
    return [
      ...input,
      '-filter_complex', `${scale},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`,
      '-loop', options.loop === false ? '-1' : '0',
      outputPath,
    ];
  }

  const volume = options.audio?.volume ?? 0.75;
  const fadeIn = Math.max(0, options.audio?.fadeInSeconds ?? 1.0);
  const duration = options.audio?.durationSeconds ?? 12;
  const fadeOut = Math.max(0, options.audio?.fadeOutSeconds ?? 2.0);
  const fadeOutStart = Math.max(0, duration - fadeOut);
  const audioFilter = `volume=${volume.toFixed(2)},afade=t=in:st=0:d=${fadeIn.toFixed(1)},afade=t=out:st=${fadeOutStart.toFixed(1)}:d=${fadeOut.toFixed(1)}`;

  if (options.format === 'webm') {
    if (hasAudio) {
      return [
        ...input,
        '-c:v', 'libvpx-vp9',
        '-b:v', '0',
        '-crf', String(options.quality ?? 32),
        '-row-mt', '1',
        '-pix_fmt', 'yuv420p',
        '-vf', scale,
        '-c:a', 'libopus',
        '-b:a', '128k',
        '-af', audioFilter,
        '-shortest',
        outputPath,
      ];
    }
    return [
      ...input,
      '-c:v', 'libvpx-vp9',
      '-b:v', '0',
      '-crf', String(options.quality ?? 32),
      '-row-mt', '1',
      '-pix_fmt', 'yuv420p',
      '-vf', scale,
      outputPath,
    ];
  }

  if (hasAudio) {
    return [
      ...input,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', String(options.quality ?? 21),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-vf', scale,
      '-c:a', 'aac',
      '-b:a', '192k',
      '-af', audioFilter,
      '-shortest',
      outputPath,
    ];
  }

  return [
    ...input,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', String(options.quality ?? 21),
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-vf', scale,
    outputPath,
  ];
}

export function contentTypeFor(format: EncodeFormat) {
  return format === 'mp4' ? 'video/mp4' : format === 'webm' ? 'video/webm' : 'image/gif';
}

/** H.264 and VP9 both require even pixel dimensions. */
export function evenNumber(value: number) {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

export type FrameSource = AsyncIterable<Buffer>;

/**
 * Streams PNG frames into FFmpeg and returns the encoded file.
 * The process is killed on timeout or cancellation so a stuck encode cannot leak.
 */
export async function encodeFrames(frames: FrameSource, options: EncodeOptions): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'map-studio-video-'));
  const outputPath = join(directory, `render.${options.format}`);
  try {
    let resolvedOptions = { ...options };

    // If audio data URI or base64 is provided without an explicit audio path, write to temp file
    if (options.audio?.audioData && !options.audio.audioPath && options.format !== 'gif') {
      const match = options.audio.audioData.match(/^data:audio\/([a-zA-Z0-9]+);base64,(.+)$/);
      const ext = match?.[1] ?? 'wav';
      const base64Content = match?.[2] ?? options.audio.audioData.replace(/^data:[^;]+;base64,/, '');
      const audioBuffer = Buffer.from(base64Content, 'base64');
      const tempAudioPath = join(directory, `audio_track.${ext === 'mpeg' ? 'mp3' : ext}`);
      await writeFile(tempAudioPath, audioBuffer);
      resolvedOptions = {
        ...options,
        audio: {
          ...options.audio,
          audioPath: tempAudioPath,
        },
      };
    }

    const args = encoderArguments(resolvedOptions, outputPath);
    const child = spawn(options.ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'], shell: false });
    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      if (stderrChunks.length > 200) stderrChunks.shift();
    });

    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs);
    const onAbort = () => child.kill('SIGKILL');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    let writeError: Error | undefined;
    try {
      for await (const frame of frames) {
        if (options.signal?.aborted) break;
        if (!child.stdin.write(frame)) await once(child.stdin, 'drain');
      }
    } catch (error) {
      writeError = error instanceof Error ? error : new Error(String(error));
    } finally {
      child.stdin.end();
    }

    const [code] = (await once(child, 'close')) as [number | null];
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);

    if (writeError) throw writeError;
    if (options.signal?.aborted) throw new Error('Render canceled');
    if (code !== 0) throw new Error(`FFmpeg exited with ${code}: ${Buffer.concat(stderrChunks).toString('utf8').slice(-600)}`);
    return await readFile(outputPath);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Verifies the configured FFmpeg binary exists and can report its version. */
export async function probeFfmpeg(ffmpegPath: string, timeoutMs = 10_000) {
  return new Promise<{ available: boolean; version?: string; error?: string }>((resolve) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-version'], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ available: false, error: 'FFmpeg version probe timed out' });
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ available: false, error: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString('utf8');
      resolve(code === 0
        ? { available: true, version: output.split('\n')[0]?.trim() }
        : { available: false, error: `FFmpeg probe exited with ${code}` });
    });
  });
}

/** Test seam: writes frames to a file without invoking FFmpeg. */
export async function collectFrames(frames: FrameSource, destination: string) {
  const stream = createWriteStream(destination);
  const pass = new PassThrough();
  pass.pipe(stream);
  let count = 0;
  for await (const frame of frames) {
    count += 1;
    pass.write(frame);
  }
  pass.end();
  await once(stream, 'finish');
  return count;
}
