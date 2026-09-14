import type { Protocol } from 'pmtiles';

/**
 * Create the MapLibre protocol adapter for a PMTiles URL. The caller owns
 * registration on the MapLibre namespace so this remains compatible with the
 * existing map instance and with SSR/render workers.
 */
export async function createPmtilesProtocol(): Promise<Protocol> {
  const { Protocol } = await import('pmtiles');
  return new Protocol();
}

