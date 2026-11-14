/**
 * 蝸牛上で等間隔になるように、周波数帯の境界を決める（ヒトの Greenwood 関数）。
 *   f = A * (10^(a*x) - k),  A = 165.4, a = 2.1, k = 0.88
 * 人工内耳の電極も蝸牛内に並ぶため、低域は細かく・高域は粗く分かれる。
 */
export function greenwoodEdges(nChannels: number, fLo = 200, fHi = 7000): number[] {
  const A = 165.4;
  const a = 2.1;
  const k = 0.88;
  const toX = (f: number) => Math.log10(f / A + k) / a;
  const toF = (x: number) => A * (10 ** (a * x) - k);

  const x0 = toX(fLo);
  const x1 = toX(fHi);
  const edges: number[] = [];
  for (let i = 0; i <= nChannels; i++) {
    edges.push(toF(x0 + ((x1 - x0) * i) / nChannels));
  }
  return edges;
}
