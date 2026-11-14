/**
 * 横に流れるスペクトログラム（縦軸は対数周波数）＋ チャネル境界のガイド線。
 */
export class Spectrogram {
  private ctx: CanvasRenderingContext2D;
  private overlay: CanvasRenderingContext2D;
  private data: Uint8Array<ArrayBuffer>;
  private rowBins: Int32Array = new Int32Array(0);
  private palette: [number, number, number][] = makePalette();

  readonly fMin = 100;
  readonly fMax = 10000;

  constructor(
    private canvas: HTMLCanvasElement,
    private overlayCanvas: HTMLCanvasElement,
    private analyser: AnalyserNode,
  ) {
    this.ctx = canvas.getContext("2d", { willReadFrequently: false })!;
    this.overlay = overlayCanvas.getContext("2d")!;
    this.data = new Uint8Array(analyser.frequencyBinCount);
    this.analyser.minDecibels = -100;
    this.analyser.maxDecibels = -20;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.canvas, this.overlayCanvas]) {
      const r = c.getBoundingClientRect();
      c.width = Math.max(1, Math.floor(r.width * dpr));
      c.height = Math.max(1, Math.floor(r.height * dpr));
    }
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 各行（y）がどの FFT ビンに対応するかを先に計算しておく
    const h = this.canvas.height;
    const nyq = this.analyser.context.sampleRate / 2;
    const bins = this.analyser.frequencyBinCount;
    this.rowBins = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      const f = this.yToFreq(y, h);
      this.rowBins[y] = Math.min(bins - 1, Math.round((f / nyq) * bins));
    }
  }

  /** 1 フレーム分の列を右端に描き足す */
  draw(): void {
    const { width: w, height: h } = this.canvas;
    const step = Math.max(1, Math.round((window.devicePixelRatio || 1) * 2));
    this.analyser.getByteFrequencyData(this.data);

    this.ctx.drawImage(this.canvas, step, 0, w - step, h, 0, 0, w - step, h);
    const col = this.ctx.createImageData(step, h);
    for (let y = 0; y < h; y++) {
      const [r, g, b] = this.palette[this.data[this.rowBins[y]]];
      for (let x = 0; x < step; x++) {
        const o = (y * step + x) * 4;
        col.data[o] = r;
        col.data[o + 1] = g;
        col.data[o + 2] = b;
        col.data[o + 3] = 255;
      }
    }
    this.ctx.putImageData(col, w - step, 0);
  }

  /** チャネルの境界線と周波数の目盛りを描く */
  drawGuides(edges: number[], showEdges: boolean): void {
    const c = this.overlay;
    const { width: w, height: h } = this.overlayCanvas;
    const dpr = window.devicePixelRatio || 1;
    c.clearRect(0, 0, w, h);

    c.font = `${11 * dpr}px system-ui, sans-serif`;
    c.fillStyle = "rgba(255,255,255,0.75)";
    c.strokeStyle = "rgba(255,255,255,0.15)";
    c.lineWidth = 1;
    for (const f of [125, 250, 500, 1000, 2000, 4000, 8000]) {
      const y = this.freqToY(f, h);
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
      c.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, 4 * dpr, y - 3 * dpr);
    }

    if (!showEdges) return;
    c.strokeStyle = "rgba(94, 234, 212, 0.55)";
    c.setLineDash([4 * dpr, 4 * dpr]);
    for (const f of edges) {
      const y = this.freqToY(f, h);
      c.beginPath();
      c.moveTo(w - 60 * dpr, y);
      c.lineTo(w, y);
      c.stroke();
    }
    c.setLineDash([]);
  }

  private yToFreq(y: number, h: number): number {
    const r = 1 - y / (h - 1);
    return this.fMin * (this.fMax / this.fMin) ** r;
  }

  private freqToY(f: number, h: number): number {
    const r = Math.log(f / this.fMin) / Math.log(this.fMax / this.fMin);
    return (1 - r) * (h - 1);
  }
}

/** 黒 → 紫 → 橙 → 薄黄 のカラーマップ（magma 風） */
function makePalette(): [number, number, number][] {
  const stops: [number, [number, number, number]][] = [
    [0, [0, 0, 4]],
    [0.25, [59, 15, 112]],
    [0.5, [140, 41, 129]],
    [0.75, [241, 96, 93]],
    [1, [252, 253, 191]],
  ];
  const p: [number, number, number][] = [];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let j = 0;
    while (j < stops.length - 2 && t > stops[j + 1][0]) j++;
    const [t0, c0] = stops[j];
    const [t1, c1] = stops[j + 1];
    const u = (t - t0) / (t1 - t0);
    p.push([0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * u)) as [number, number, number]);
  }
  return p;
}
