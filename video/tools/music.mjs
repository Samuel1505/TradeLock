// node tools/music.mjs <seconds> public/music.wav — soft pad + pluck bed, synthesized, deterministic.
import { writeFileSync } from 'node:fs';
const DUR = Number(process.argv[2] ?? 92), OUT = process.argv[3] ?? 'public/music.wav';
const SR = 48000, N = Math.ceil(DUR * SR), BPM = 96, BEAT = 60 / BPM, BAR = BEAT * 4;
const L = new Float32Array(N), R = new Float32Array(N);
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
// Am – F – C – G, two bars each
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 55, 60], [55, 59, 62]];
const add = (i, l, r) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };
// Pad: detuned saws softened by averaging, slow swell per chord
for (let c = 0; c * BAR * 2 < DUR; c++) {
  const notes = CHORDS[c % 4], t0 = c * BAR * 2, len = BAR * 2 + 0.6;
  for (const m of notes) for (const det of [-0.08, 0.08]) {
    const f = hz(m - 12) * 2 ** (det / 12);
    for (let k = 0; k < len * SR; k++) {
      const t = k / SR, env = Math.min(1, t / 1.2) * Math.min(1, (len - t) / 0.8);
      const ph = (f * t) % 1, v = (Math.sin(2 * Math.PI * ph) * 0.7 + Math.sin(4 * Math.PI * ph) * 0.15) * env * 0.045;
      add(Math.floor((t0 + t) * SR), det < 0 ? v : v * 0.8, det < 0 ? v * 0.8 : v);
    }
  }
}
// Pluck: chord tones in 8ths, quiet, panned
const arp = [0, 1, 2, 1, 2, 0, 1, 2];
for (let s = 0; s * BEAT / 2 < DUR; s++) {
  const t0 = s * BEAT / 2, chord = CHORDS[Math.floor(t0 / (BAR * 2)) % 4], m = chord[arp[s % 8]] + 12;
  const f = hz(m), pan = (s % 2 ? 0.35 : -0.35);
  for (let k = 0; k < 0.5 * SR; k++) {
    const t = k / SR, v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 9) * 0.05;
    add(Math.floor((t0 + t) * SR), v * (1 - pan), v * (1 + pan));
  }
}
// Soft kick on beats 1 and 3 from bar 3
for (let b = 8; b * BEAT < DUR - 3; b += 2) {
  const t0 = b * BEAT;
  for (let k = 0; k < 0.3 * SR; k++) {
    const t = k / SR, v = Math.sin(2 * Math.PI * (55 + 50 * Math.exp(-t * 30)) * t) * Math.exp(-t * 12) * 0.12;
    add(Math.floor((t0 + t) * SR), v, v);
  }
}
// Master fade in/out
for (let i = 0; i < N; i++) { const t = i / SR, g = Math.min(1, t / 2) * Math.min(1, (DUR - t) / 3); L[i] *= g; R[i] *= g; }
const b = Buffer.alloc(44 + N * 4);
b.write('RIFF', 0); b.writeUInt32LE(36 + N * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
b.writeUInt16LE(2, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
b.write('data', 36); b.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4); b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4); }
writeFileSync(OUT, b);
console.log(`wrote ${OUT} (${DUR}s)`);
