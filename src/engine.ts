import { VocoderGraph, type VocoderOptions } from "./vocoder";

/**
 * 再生・原音との切り替え・音量合わせ（AGC）・リミッターをまとめたもの。
 *
 *   source → mono ─┬→ dry ───────────────────────┐
 *                  ├→ vocoder → agc → wet ───────┼→ limiter → master → スピーカー
 *                  └→ inMeter                    │            └→ analyser（表示用）
 *                       vocoder.output → outMeter
 */
export class Engine {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;

  private mono: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private agc: GainNode;
  private limiter: DynamicsCompressorNode;
  private master: GainNode;
  private inMeter: AnalyserNode;
  private outMeter: AnalyserNode;

  private graph: VocoderGraph | null = null;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;

  private pIn = 0;
  private pOut = 0;
  private meterBuf = new Float32Array(2048);

  bypass = false;

  constructor() {
    this.ctx = new AudioContext();
    const c = this.ctx;

    // ステレオを 1ch にまとめる（左右で処理を変えないため）
    this.mono = c.createGain();
    this.mono.channelCount = 1;
    this.mono.channelCountMode = "explicit";
    this.mono.channelInterpretation = "speakers";

    this.dry = c.createGain();
    this.wet = c.createGain();
    this.agc = c.createGain();
    this.dry.gain.value = 0;

    // 過大音量を防ぐリミッター
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.1;

    this.master = c.createGain();
    this.master.gain.value = 0.4;

    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;

    this.inMeter = c.createAnalyser();
    this.outMeter = c.createAnalyser();
    this.inMeter.fftSize = this.outMeter.fftSize = 2048;

    this.mono.connect(this.dry).connect(this.limiter);
    this.mono.connect(this.inMeter);
    this.agc.connect(this.wet).connect(this.limiter);
    this.limiter.connect(this.master).connect(c.destination);
    this.limiter.connect(this.analyser);
  }

  get isPlaying(): boolean {
    return this.source !== null;
  }

  get hasBuffer(): boolean {
    return this.buffer !== null;
  }

  get edges(): number[] {
    return this.graph?.edges ?? [];
  }

  setBuffer(buf: AudioBuffer): void {
    const wasPlaying = this.isPlaying;
    this.stop();
    this.buffer = buf;
    if (wasPlaying) this.play();
  }

  play(): void {
    if (!this.buffer || this.source) return;
    void this.ctx.resume();
    const s = this.ctx.createBufferSource();
    s.buffer = this.buffer;
    s.loop = true;
    s.connect(this.mono);
    s.start();
    this.source = s;
  }

  stop(): void {
    if (!this.source) return;
    this.source.stop();
    this.source.disconnect();
    this.source = null;
  }

  /** ボコーダを作り直す（チャネル数などを変えたとき）。短いクロスフェードでつなぐ */
  rebuild(opts: VocoderOptions): void {
    const now = this.ctx.currentTime;
    const old = this.graph;
    if (old) {
      old.output.gain.setValueAtTime(old.output.gain.value, now);
      old.output.gain.linearRampToValueAtTime(0, now + 0.04);
      setTimeout(() => old.dispose(), 120);
    }
    const g = new VocoderGraph(this.ctx, opts);
    g.output.gain.setValueAtTime(0, now);
    g.output.gain.linearRampToValueAtTime(1, now + 0.04);
    this.mono.connect(g.input);
    g.output.connect(this.agc);
    g.output.connect(this.outMeter);
    this.graph = g;
  }

  setBypass(on: boolean): void {
    this.bypass = on;
    const t = this.ctx.currentTime;
    this.dry.gain.setTargetAtTime(on ? 1 : 0, t, 0.015);
    this.wet.gain.setTargetAtTime(on ? 0 : 1, t, 0.015);
  }

  setVolume(v: number): void {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /**
   * 毎フレーム呼ぶ。原音とボコーダ出力の RMS を比べ、同じ大きさになるよう agc を調整する。
   * （チャネル数を変えても音量が変わらないようにするため）
   */
  tick(): void {
    if (!this.source) return;
    const pin = meanSquare(this.inMeter, this.meterBuf);
    const pout = meanSquare(this.outMeter, this.meterBuf);
    this.pIn = 0.95 * this.pIn + 0.05 * pin;
    this.pOut = 0.95 * this.pOut + 0.05 * pout;
    if (this.pIn > 1e-7 && this.pOut > 1e-9) {
      const target = Math.min(20, Math.max(0.05, Math.sqrt(this.pIn / this.pOut)));
      this.agc.gain.setTargetAtTime(target, this.ctx.currentTime, 0.2);
    }
  }
}

function meanSquare(a: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  a.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return s / buf.length;
}
