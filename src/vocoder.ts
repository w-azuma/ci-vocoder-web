import { greenwoodEdges } from "./greenwood";

export type Carrier = "noise" | "sine";

export interface VocoderOptions {
  channels: number;
  carrier: Carrier;
  /** 包絡線を取り出す低域通過フィルタの遮断周波数 [Hz] */
  envCutoff: number;
  fLo: number;
  fHi: number;
}

/**
 * Web Audio のノードで組んだリアルタイム・チャネルボコーダ。
 *
 * チャネルごとに:
 *   入力 → 帯域通過(2段) → 全波整流(WaveShaper) → 低域通過(2段) = 包絡線
 *   キャリア(帯域雑音 or 正弦波) → GainNode … その gain を包絡線で動かす（＝変調）
 *   → 帯域通過 → 出力
 */
export class VocoderGraph {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly edges: number[];

  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];

  constructor(ctx: BaseAudioContext, opts: VocoderOptions) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.edges = greenwoodEdges(opts.channels, opts.fLo, opts.fHi);

    const fs = ctx.sampleRate;
    const rectifier = makeRectifierCurve();

    // 雑音キャリアの元になる白色雑音（分散 1）。全チャネルで共有し、帯域ごとに絞って使う
    let noise: AudioBufferSourceNode | null = null;
    if (opts.carrier === "noise") {
      noise = ctx.createBufferSource();
      noise.buffer = makeWhiteNoise(ctx, 4);
      noise.loop = true;
      noise.start();
      this.sources.push(noise);
    }

    for (let i = 0; i < opts.channels; i++) {
      const lo = this.edges[i];
      const hi = this.edges[i + 1];
      const fc = Math.sqrt(lo * hi);
      const bw = hi - lo;
      const q = fc / bw;

      // --- 分析側：帯域を取り出して包絡線にする ---
      const bp1 = this.biquad(ctx, "bandpass", fc, q);
      const bp2 = this.biquad(ctx, "bandpass", fc, q);
      const rect = ctx.createWaveShaper();
      rect.curve = rectifier;
      const lp1 = this.biquad(ctx, "lowpass", opts.envCutoff, Math.SQRT1_2);
      const lp2 = this.biquad(ctx, "lowpass", opts.envCutoff, Math.SQRT1_2);
      // 全波整流した正弦波の平均は振幅の 2/π。RMS(振幅/√2) に合わせるための補正
      const envScale = ctx.createGain();
      envScale.gain.value = Math.PI / (2 * Math.SQRT2);
      this.track(rect, envScale);

      this.input.connect(bp1).connect(bp2).connect(rect).connect(lp1).connect(lp2).connect(envScale);

      // --- 合成側：キャリアを包絡線で変調する ---
      const mod = ctx.createGain();
      mod.gain.value = 0; // gain = 0 + 包絡線
      this.track(mod);
      envScale.connect(mod.gain);

      if (noise) {
        const cbp1 = this.biquad(ctx, "bandpass", fc, q);
        const cbp2 = this.biquad(ctx, "bandpass", fc, q);
        // 2段の帯域通過を通った白色雑音の分散 ≈ (π/4)·bw / (fs/2) を 1 に戻す
        const norm = ctx.createGain();
        norm.gain.value = Math.sqrt(fs / 2 / ((Math.PI / 4) * bw));
        this.track(norm);
        noise.connect(cbp1).connect(cbp2).connect(norm).connect(mod);

        const post = this.biquad(ctx, "bandpass", fc, q);
        mod.connect(post).connect(this.output);
      } else {
        const osc = ctx.createOscillator();
        osc.frequency.value = fc;
        osc.start();
        this.sources.push(osc);
        const norm = ctx.createGain();
        norm.gain.value = Math.SQRT2; // 正弦波の RMS を 1 に
        this.track(norm);
        osc.connect(norm).connect(mod);
        mod.connect(this.output);
      }
    }
  }

  /** 音を止めてノードを切り離す（作り直すときに呼ぶ） */
  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* すでに止まっている */
      }
      s.disconnect();
    }
    for (const n of this.nodes) n.disconnect();
    this.input.disconnect();
    this.output.disconnect();
  }

  private biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = Math.min(freq, ctx.sampleRate / 2 - 1);
    f.Q.value = q;
    this.nodes.push(f);
    return f;
  }

  private track(...nodes: AudioNode[]): void {
    this.nodes.push(...nodes);
  }
}

/** |x| を返す WaveShaper 用カーブ（全波整流） */
function makeRectifierCurve(): Float32Array<ArrayBuffer> {
  const n = 2049;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    curve[i] = Math.abs((i / (n - 1)) * 2 - 1);
  }
  return curve;
}

function makeWhiteNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const s = Math.sqrt(3); // 一様乱数(-1〜1)の分散 1/3 を 1 にする
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * s;
  return buf;
}
