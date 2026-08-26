import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

export type EncodeFormat = 'mp4' | 'webm' | 'gif';

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
};

/**
 * Builds the argument list for a PNG-sequence encode.
 * Arguments are always passed as a list, never interpolated into a shell string.
 */
export function encoderArguments(options: EncodeOptions, outputPath: string): string[] {
  const scale = `scale=${evenNumber(options.width)}:${evenNumber(options.height)}:flags=lanczos`;
  const input = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(options.fps), '-i', 'pipe:0'];

  if (options.format === 'gif') {
    return [
      ...input,
      '-filter_complex', `${scale},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`,
      '-loop', options.loop === false ? '-1' : '0',
      outputPath,
    ];
  }

  if (options.format === 'webm') {
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
    const args = encoderArguments(options, outputPath);
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
