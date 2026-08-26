import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodeFrames, probeFfmpeg, type EncodeFormat } from './ffmpeg.js';

const probe = await probeFfmpeg(process.env.FFMPEG_PATH ?? 'ffmpeg');
const ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg';

/** Builds a minimal solid-colour RGB PNG so the encoder gets real image bytes. */
function solidPng(width: number, height: number, rgb: [number, number, number]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < width; x += 1) {
      const at = rowStart + 1 + x * 3;
      raw[at] = rgb[0];
      raw[at + 1] = rgb[1];
      raw[at + 2] = rgb[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, body: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function* frames(count: number, width = 64, height = 64) {
  for (let index = 0; index < count; index += 1) {
    // Vary the colour so the encoder sees genuine motion between frames.
    yield solidPng(width, height, [(index * 24) % 256, 90, 200 - ((index * 12) % 180)]);
  }
}

const SIGNATURES: Record<EncodeFormat, (output: Buffer) => boolean> = {
  mp4: (output) => output.subarray(4, 8).toString('ascii') === 'ftyp',
  webm: (output) => output.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  gif: (output) => output.subarray(0, 6).toString('ascii').startsWith('GIF8'),
};

describe.skipIf(!probe.available)('encodeFrames with the real FFmpeg binary', () => {
  it('encodes a PNG sequence into a playable MP4', async () => {
    const output = await encodeFrames(frames(12), { format: 'mp4', fps: 12, width: 64, height: 64, ffmpegPath, timeoutMs: 120_000 });
    expect(output.length).toBeGreaterThan(500);
    expect(SIGNATURES.mp4(output), 'MP4 files begin with an ftyp box').toBe(true);
  }, 180_000);

  it('encodes WebM and GIF from the same frame source', async () => {
    const webm = await encodeFrames(frames(10), { format: 'webm', fps: 10, width: 64, height: 64, ffmpegPath, timeoutMs: 180_000 });
    expect(SIGNATURES.webm(webm), 'WebM files begin with the EBML header').toBe(true);
    const gif = await encodeFrames(frames(10), { format: 'gif', fps: 10, width: 64, height: 64, ffmpegPath, timeoutMs: 120_000 });
    expect(SIGNATURES.gif(gif), 'GIF files begin with GIF87a or GIF89a').toBe(true);
  }, 300_000);

  it('pads an odd frame size to even dimensions instead of failing', async () => {
    const output = await encodeFrames(frames(6, 65, 33), { format: 'mp4', fps: 6, width: 65, height: 33, ffmpegPath, timeoutMs: 120_000 });
    expect(SIGNATURES.mp4(output)).toBe(true);
  }, 180_000);

  it('stops the encode when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(encodeFrames(frames(30), { format: 'mp4', fps: 30, width: 64, height: 64, ffmpegPath, timeoutMs: 60_000, signal: controller.signal }))
      .rejects.toThrow();
  }, 60_000);

  it('surfaces the FFmpeg error when the input is not decodable', async () => {
    async function* junk() { yield Buffer.from('this is not a png'); }
    await expect(encodeFrames(junk(), { format: 'mp4', fps: 10, width: 64, height: 64, ffmpegPath, timeoutMs: 60_000 }))
      .rejects.toThrow(/FFmpeg/);
  }, 60_000);
});
