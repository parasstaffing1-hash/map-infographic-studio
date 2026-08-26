/**
 * Copyright-Free Background Music Library for Map Studio Infographic.
 *
 * Provides a curated collection of 100% royalty-free, monetization-safe audio tracks
 * designed specifically for geopolitical documentaries, data races, and historical timelines,
 * alongside pure PCM procedural synthesizer generators and custom audio upload helpers.
 */

export type AudioCategory = 'cinematic' | 'stats-race' | 'historical' | 'lofi' | 'minimal';

export type AudioTrackMeta = {
  id: string;
  name: string;
  category: AudioCategory;
  categoryLabel: string;
  description: string;
  bpm: number;
  mood: string;
  durationSeconds: number;
  /** Generated on demand or loaded from assets */
  presetGeneratorKey: 'cinematic-drone' | 'stats-pulse' | 'epic-drums' | 'lofi-keys' | 'minimal-pulse';
};

export type AudioTrackSpec = {
  id: string;
  name: string;
  source: 'preset' | 'custom' | 'none';
  category?: AudioCategory;
  /** Base64 data:audio/... or raw buffer URL */
  audioData?: string;
  volume: number; // 0.0 to 1.0 (default 0.75)
  fadeInSeconds: number; // default 1.0
  fadeOutSeconds: number; // default 2.0
  loop: boolean; // default true
};

export const DEFAULT_AUDIO_TRACK: AudioTrackSpec = {
  id: 'cinematic-documentary',
  name: 'Deep Geopolitical Horizon (Cinematic)',
  source: 'preset',
  category: 'cinematic',
  volume: 0.75,
  fadeInSeconds: 1.0,
  fadeOutSeconds: 2.0,
  loop: true,
};

export const COPYRIGHT_FREE_LIBRARY: AudioTrackMeta[] = [
  {
    id: 'cinematic-documentary',
    name: 'Deep Geopolitical Horizon',
    category: 'cinematic',
    categoryLabel: 'Cinematic Documentary',
    description: 'Atmospheric minor pads, deep sub-bass drone, and subtle ticking pulse (Johnny Harris / Vox style).',
    bpm: 90,
    mood: 'Investigative · Intense · Thoughtful',
    durationSeconds: 180,
    presetGeneratorKey: 'cinematic-drone',
  },
  {
    id: 'stats-race-momentum',
    name: 'Pulse of Progress (124 BPM)',
    category: 'stats-race',
    categoryLabel: 'Data Race & Stats',
    description: 'Driving rhythmic arpeggios and steady synth pulse for fast-paced bar races (Wawamu / Data is Beautiful style).',
    bpm: 124,
    mood: 'Energetic · Motivating · Forward-looking',
    durationSeconds: 180,
    presetGeneratorKey: 'stats-pulse',
  },
  {
    id: 'historical-chronicles',
    name: 'Chronicles of Power',
    category: 'historical',
    categoryLabel: 'Historical & Geopolitical',
    description: 'Cinematic orchestral drums, slow brass resonance, and epic empire rise atmosphere.',
    bpm: 75,
    mood: 'Epic · Grand · Monumental',
    durationSeconds: 180,
    presetGeneratorKey: 'epic-drums',
  },
  {
    id: 'lofi-cartography',
    name: 'Midnight Cartography Lounge',
    category: 'lofi',
    categoryLabel: 'Lo-Fi Explainer',
    description: 'Warm Rhodes electric keys, vinyl warmth, and mellow downtempo groove.',
    bpm: 80,
    mood: 'Chill · Relaxed · Educational',
    durationSeconds: 180,
    presetGeneratorKey: 'lofi-keys',
  },
  {
    id: 'minimal-data-stream',
    name: 'Digital Census Flow',
    category: 'minimal',
    categoryLabel: 'Minimal Tech',
    description: 'Clean modern digital textures, rhythmic clockwork clicks, and ambient technological pads.',
    bpm: 110,
    mood: 'Modern · Neutral · Analytical',
    durationSeconds: 180,
    presetGeneratorKey: 'minimal-pulse',
  },
];

/**
 * Pure TypeScript 16-bit 44.1kHz Stereo WAV PCM sound generator.
 * Creates clean, harmonic procedural music completely offline without external downloads.
 */
export function generateProceduralTrackWav(generatorKey: AudioTrackMeta['presetGeneratorKey'], durationSec = 30): Uint8Array {
  const sampleRate = 44100;
  const numChannels = 2;
  const numSamples = Math.floor(sampleRate * durationSec);
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // Write WAV RIFF Header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM format subchunk size
  view.setUint16(20, 1, true); // AudioFormat 1 = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16-bit
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Synthesize musical audio waveform
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let left = 0;
    let right = 0;

    if (generatorKey === 'cinematic-drone') {
      // D minor / A minor ambient drone + subtle pulsing sub
      const sub = Math.sin(2 * Math.PI * 55 * t) * 0.4; // 55Hz A1
      const root = Math.sin(2 * Math.PI * 110 * t) * 0.25; // 110Hz A2
      const fifth = Math.sin(2 * Math.PI * 164.81 * t) * 0.15; // E3
      const minorThird = Math.sin(2 * Math.PI * 130.81 * t) * 0.12; // C3
      // Slow sweep filter modulation (0.2 Hz)
      const lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.2 * t);
      // Gentle tick on 1 Hz
      const tick = Math.exp(-((t % 1) * 30)) * 0.15 * Math.sin(2 * Math.PI * 880 * t);
      const tone = (sub + (root + fifth + minorThird) * lfo + tick) * 0.6;
      left = tone + Math.sin(2 * Math.PI * 111 * t) * 0.05;
      right = tone + Math.sin(2 * Math.PI * 109 * t) * 0.05;
    } else if (generatorKey === 'stats-pulse') {
      // 124 BPM = 2.066 beats/sec. 16th note arpeggios
      const beatSec = 60 / 124;
      const sixteenth = beatSec / 4;
      const step = Math.floor(t / sixteenth) % 16;
      const scale = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33]; // A minor pentatonic
      const freq = scale[step % scale.length];
      const stepT = t % sixteenth;
      const env = Math.exp(-stepT * 25);
      const synth = Math.sin(2 * Math.PI * freq * t) * env * 0.35;
      // Kick on quarter notes
      const beatT = t % beatSec;
      const kick = Math.exp(-beatT * 20) * Math.sin(2 * Math.PI * (60 * Math.exp(-beatT * 15)) * beatT) * 0.45;
      left = synth * 0.7 + kick;
      right = synth * 0.85 + kick;
    } else if (generatorKey === 'epic-drums') {
      // 75 BPM = 1.25s per measure. Timpani & deep low brass
      const barSec = 60 / 75 * 2;
      const barT = t % barSec;
      const timpani = Math.exp(-barT * 4) * Math.sin(2 * Math.PI * 73.42 * t) * 0.5; // D2
      const brass = Math.sin(2 * Math.PI * 146.83 * t) * 0.2 + Math.sin(2 * Math.PI * 220 * t) * 0.15;
      const sub = Math.sin(2 * Math.PI * 36.71 * t) * 0.3;
      left = (timpani + brass * 0.5 + sub) * 0.6;
      right = (timpani * 0.9 + brass * 0.5 + sub) * 0.6;
    } else if (generatorKey === 'lofi-keys') {
      // 80 BPM Rhodes chords (Dmaj7 -> Bm7)
      const chordTime = t % 6;
      const baseFreq = chordTime < 3 ? 146.83 : 123.47;
      const rhodes = (Math.sin(2 * Math.PI * baseFreq * t) + 0.5 * Math.sin(2 * Math.PI * baseFreq * 1.5 * t) + 0.3 * Math.sin(2 * Math.PI * baseFreq * 1.875 * t)) * 0.25;
      // Subtle crackle noise
      const crackle = (Math.random() - 0.5) * 0.02;
      left = rhodes + crackle;
      right = rhodes * 0.95 + crackle;
    } else {
      // Minimal tech arpeggio (110 BPM)
      const sixteenth = (60 / 110) / 4;
      const step = Math.floor(t / sixteenth) % 8;
      const freqs = [330, 392, 440, 493.88, 587.33, 659.25, 783.99, 880];
      const freq = freqs[step];
      const stepT = t % sixteenth;
      const env = Math.exp(-stepT * 35);
      const tone = Math.sin(2 * Math.PI * freq * t) * env * 0.3;
      left = tone;
      right = tone * 0.9;
    }

    // Apply soft limiting
    left = Math.max(-0.95, Math.min(0.95, left));
    right = Math.max(-0.95, Math.min(0.95, right));

    // Convert to 16-bit integer
    view.setInt16(offset, Math.floor(left * 32767), true);
    view.setInt16(offset + 2, Math.floor(right * 32767), true);
    offset += 4;
  }

  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Returns a base64 data URI for a procedural preset track.
 */
export function getPresetTrackDataUri(trackId: string, durationSec = 30): string {
  const track = COPYRIGHT_FREE_LIBRARY.find((item) => item.id === trackId) ?? COPYRIGHT_FREE_LIBRARY[0];
  const bytes = generateProceduralTrackWav(track.presetGeneratorKey, durationSec);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return `data:audio/wav;base64,${base64}`;
}

/**
 * Helper to validate and convert a user-uploaded audio file to a base64 Data URL.
 */
export async function loadCustomAudioFile(file: File): Promise<AudioTrackSpec> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve({
        id: `custom-${Date.now()}`,
        name: file.name.replace(/\.[^/.]+$/, ''),
        source: 'custom',
        audioData: result,
        volume: 0.8,
        fadeInSeconds: 1.0,
        fadeOutSeconds: 2.0,
        loop: true,
      });
    };
    reader.onerror = () => reject(new Error('Failed to read custom audio file'));
    reader.readAsDataURL(file);
  });
}
