// PCM helpers for Gemini Live audio (16-bit little-endian, base64). Pure, so they run in tests.

export const OUTPUT_SAMPLE_RATE = 24_000;
export const INPUT_SAMPLE_RATE = 16_000;

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 16-bit PCM → Float32 samples in [-1, 1) for Web Audio. */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Downmix a mic buffer to 16 kHz 16-bit PCM and return base64, the format Gemini Live expects. */
export function downsamplePcm16Base64(input: Float32Array, fromRate: number, toRate = INPUT_SAMPLE_RATE): string {
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const bytes = new Uint8Array(length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, input[Math.min(input.length - 1, Math.floor(i * ratio))] ?? 0));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** "audio/pcm;rate=24000" → 24000 */
export function sampleRateOf(mimeType: string | undefined): number {
  const m = mimeType?.match(/rate=(\d+)/);
  return m ? Number(m[1]) : OUTPUT_SAMPLE_RATE;
}
