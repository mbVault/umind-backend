/** Tiny procedural WAV helpers for local Listen playback (not real music). */

export type MelodySpec = {
  /** Note frequencies in Hz (0 = rest) */
  notes: number[];
  noteMs: number;
  sampleRate?: number;
};

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

/** Build a mono 16-bit PCM WAV buffer from a simple melody. */
export function buildMelodyWav(spec: MelodySpec): Buffer {
  const sampleRate = spec.sampleRate ?? 22050;
  const samplesPerNote = Math.floor((spec.noteMs / 1000) * sampleRate);
  const totalSamples = samplesPerNote * spec.notes.length;
  const dataSize = totalSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const freq of spec.notes) {
    for (let i = 0; i < samplesPerNote; i++) {
      const t = i / sampleRate;
      const env = Math.min(1, i / 400) * Math.min(1, (samplesPerNote - i) / 800);
      const sample = freq === 0 ? 0 : Math.sin(2 * Math.PI * freq * t) * 0.28 * env;
      const int16 = Math.max(-32767, Math.min(32767, Math.floor(sample * 32767)));
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return buffer;
}

/** Five distinct short “weekend vibe” loops for local testing. */
export const MOCK_WEEKEND_LOOPS: { slug: string; label: string; melody: MelodySpec }[] = [
  {
    slug: "soft-sunrise",
    label: "Soft sunrise loop",
    melody: {
      noteMs: 280,
      notes: [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 261.63, 0, 293.66, 349.23, 440.0, 349.23],
    },
  },
  {
    slug: "easy-drive",
    label: "Easy drive loop",
    melody: {
      noteMs: 220,
      notes: [196.0, 246.94, 293.66, 246.94, 220.0, 277.18, 329.63, 277.18, 196.0, 246.94, 0, 196.0],
    },
  },
  {
    slug: "night-walk",
    label: "Night walk loop",
    melody: {
      noteMs: 320,
      notes: [174.61, 220.0, 261.63, 220.0, 174.61, 207.65, 246.94, 207.65, 174.61, 0, 220.0, 261.63],
    },
  },
  {
    slug: "balcony-breeze",
    label: "Balcony breeze loop",
    melody: {
      noteMs: 250,
      notes: [329.63, 392.0, 493.88, 392.0, 349.23, 440.0, 523.25, 440.0, 329.63, 392.0, 349.23, 0],
    },
  },
  {
    slug: "late-coffee",
    label: "Late coffee loop",
    melody: {
      noteMs: 300,
      notes: [146.83, 174.61, 220.0, 174.61, 164.81, 196.0, 246.94, 196.0, 146.83, 174.61, 0, 146.83],
    },
  },
];
