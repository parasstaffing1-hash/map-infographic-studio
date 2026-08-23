import { describe, expect, it } from 'vitest';
import { manifestUrl, readManifest } from './ndjson.js';

const line = (id: string) => JSON.stringify({ id, project: { rows: [], config: {}, annotations: [] } });

describe('sharded manifests', () => {
  it('expands shard indexes deterministically', () => {
    expect(manifestUrl('https://data.example.com/{shard}.ndjson', 42)).toBe('https://data.example.com/000042.ndjson');
  });

  it('streams records across chunk boundaries', async () => {
    const payload = `${line('one')}\n${line('two')}\n`;
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload.slice(0, 37)));
        controller.enqueue(new TextEncoder().encode(payload.slice(37)));
        controller.close();
      },
    }));
    const records = [];
    for await (const record of readManifest(response, 10)) records.push(record);
    expect(records.map((record) => record.id)).toEqual(['one', 'two']);
  });

  it('enforces per-shard record limits', async () => {
    const response = new Response(`${line('one')}\n${line('two')}`);
    const consume = async () => { for await (const _record of readManifest(response, 1)) { /* consume */ } };
    await expect(consume()).rejects.toThrow('exceeds 1 records');
  });
});
