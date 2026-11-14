/**
 * デモ用の音源をブラウザ内で合成する。
 * 曲は「きらきら星」（18世紀フランス民謡、パブリックドメイン）。
 * メロディ（倍音のある音）＋和音の伴奏＋キック/ハイハット。
 */
export function createDemoBuffer(ctx: BaseAudioContext): AudioBuffer {
  const fs = ctx.sampleRate;
  const beat = 60 / 100; // 100 BPM

  const C = 72, D = 74, E = 76, F = 77, G = 79, A = 81;
  const melody: [number, number][] = [
    [C, 1], [C, 1], [G, 1], [G, 1], [A, 1], [A, 1], [G, 2],
    [F, 1], [F, 1], [E, 1], [E, 1], [D, 1], [D, 1], [C, 2],
  ];
  const chords = [
    [48, 52, 55], [48, 52, 55], [53, 57, 60], [48, 52, 55],
    [53, 57, 60], [48, 52, 55], [55, 59, 62], [48, 52, 55],
  ];

  const totalBeats = melody.reduce((s, [, b]) => s + b, 0);
  const len = Math.floor((totalBeats * beat + 0.6) * fs);
  const out = new Float32Array(len);

  const place = (sig: Float32Array, startS: number, gain: number) => {
    const i0 = Math.floor(startS * fs);
    for (let i = 0; i < sig.length && i0 + i < len; i++) out[i0 + i] += gain * sig[i];
  };

  const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

  const tone = (freq: number, dur: number, nHarm: number, decay: number) => {
    const n = Math.floor(dur * fs);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      let v = 0;
      for (let k = 1; k <= nHarm; k++) {
        if (freq * k < fs / 2) v += 0.6 ** (k - 1) * Math.sin(2 * Math.PI * freq * k * t);
      }
      const env = Math.exp(-decay * t) * Math.min(1, t / 0.005) * Math.min(1, (n - i) / 200);
      y[i] = v * env;
    }
    return y;
  };

  const kick = () => {
    const n = Math.floor(0.25 * fs);
    const y = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      phase += (2 * Math.PI * (120 * Math.exp(-25 * t) + 45)) / fs;
      y[i] = Math.sin(phase) * Math.exp(-12 * t);
    }
    return y;
  };

  const hihat = () => {
    const n = Math.floor(0.05 * fs);
    const y = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.random() * 2 - 1;
      y[i] = (r - prev) * Math.exp((-60 * i) / fs) * 0.3; // 差分で高域を強調
      prev = r;
    }
    return y;
  };

  let t = 0;
  for (const [note, beats] of melody) {
    place(tone(hz(note), beats * beat * 1.1, 8, 3), t, 0.5);
    t += beats * beat;
  }
  chords.forEach((ch, i) => {
    for (const n of ch) place(tone(hz(n), 2 * beat, 5, 1.5), i * 2 * beat, 0.12);
  });
  const k = kick();
  const h = hihat();
  for (let b = 0; b < totalBeats; b++) {
    place(k, b * beat, b % 2 === 0 ? 0.8 : 0.5);
    place(h, (b + 0.5) * beat, 1);
  }

  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = 0.7 / (peak || 1);
  for (let i = 0; i < len; i++) out[i] *= g;

  const buf = ctx.createBuffer(1, len, fs);
  buf.copyToChannel(out, 0);
  return buf;
}
