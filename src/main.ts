import { createDemoBuffer } from "./demo";
import { Engine } from "./engine";
import { Spectrogram } from "./spectrogram";
import type { Carrier, VocoderOptions } from "./vocoder";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const btnDemo = $<HTMLButtonElement>("btn-demo");
const fileInput = $<HTMLInputElement>("file");
const sourceName = $<HTMLSpanElement>("source-name");
const btnPlay = $<HTMLButtonElement>("btn-play");
const btnAB = $<HTMLButtonElement>("btn-ab");
const modeLabel = $<HTMLSpanElement>("mode-label");
const chSlider = $<HTMLInputElement>("ch");
const chValue = $<HTMLOutputElement>("ch-value");
const volSlider = $<HTMLInputElement>("vol");
const carrierSel = $<HTMLSelectElement>("carrier");
const envSlider = $<HTMLInputElement>("env");
const envValue = $<HTMLOutputElement>("env-value");
const showEdges = $<HTMLInputElement>("show-edges");
const presetButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".presets button"));

let engine: Engine | null = null;
let spec: Spectrogram | null = null;

function currentOptions(): VocoderOptions {
  return {
    channels: Number(chSlider.value),
    carrier: carrierSel.value as Carrier,
    envCutoff: Number(envSlider.value),
    fLo: 200,
    fHi: 7000,
  };
}

/** AudioContext はユーザー操作の後でないと音が出せないので、最初の操作で作る */
function ensureEngine(): Engine {
  if (engine) return engine;
  engine = new Engine();
  engine.setVolume(Number(volSlider.value));
  engine.rebuild(currentOptions());
  spec = new Spectrogram($("spec"), $("spec-overlay"), engine.analyser);
  updateGuides();
  requestAnimationFrame(loop);
  return engine;
}

function loop() {
  if (engine && spec) {
    engine.tick();
    if (engine.isPlaying) spec.draw();
  }
  requestAnimationFrame(loop);
}

function setSource(buf: AudioBuffer, name: string) {
  const e = ensureEngine();
  e.setBuffer(buf);
  sourceName.textContent = `${name}（${buf.duration.toFixed(1)} 秒）`;
  btnPlay.disabled = false;
  btnAB.disabled = false;
  if (!e.isPlaying) togglePlay();
}

function togglePlay() {
  const e = ensureEngine();
  if (!e.hasBuffer) return;
  if (e.isPlaying) e.stop();
  else e.play();
  btnPlay.textContent = e.isPlaying ? "■ 停止" : "▶ 再生";
}

function toggleAB() {
  const e = ensureEngine();
  e.setBypass(!e.bypass);
  btnAB.setAttribute("aria-pressed", String(e.bypass));
  btnAB.textContent = e.bypass ? "ボコーダに戻す" : "原音に切り替え";
  modeLabel.textContent = e.bypass ? "原音" : `ボコーダ ${chSlider.value}ch`;
  modeLabel.classList.toggle("original", e.bypass);
  updateGuides();
}

function applyOptions() {
  chValue.textContent = chSlider.value;
  envValue.textContent = `${envSlider.value} Hz`;
  for (const b of presetButtons) b.classList.toggle("active", b.dataset.ch === chSlider.value);
  if (engine && !engine.bypass) modeLabel.textContent = `ボコーダ ${chSlider.value}ch`;
  if (!engine) return;
  engine.rebuild(currentOptions());
  updateGuides();
}

function updateGuides() {
  if (!engine || !spec) return;
  spec.drawGuides(engine.edges, showEdges.checked && !engine.bypass);
}

function setChannels(n: number) {
  const v = Math.min(22, Math.max(1, n));
  if (String(v) === chSlider.value) return;
  chSlider.value = String(v);
  applyOptions();
}

// --- イベント ---------------------------------------------------------------

btnDemo.addEventListener("click", () => {
  const e = ensureEngine();
  setSource(createDemoBuffer(e.ctx), "デモ：きらきら星");
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const e = ensureEngine();
  sourceName.textContent = "読み込み中…";
  try {
    const buf = await e.ctx.decodeAudioData(await file.arrayBuffer());
    setSource(buf, file.name);
  } catch {
    sourceName.textContent = "このファイルは読み込めませんでした（wav / mp3 / m4a などを試してください）";
  }
  fileInput.value = "";
});

btnPlay.addEventListener("click", togglePlay);
btnAB.addEventListener("click", toggleAB);
chSlider.addEventListener("input", applyOptions);
carrierSel.addEventListener("change", applyOptions);
envSlider.addEventListener("input", applyOptions);
showEdges.addEventListener("change", updateGuides);
volSlider.addEventListener("input", () => engine?.setVolume(Number(volSlider.value)));
for (const b of presetButtons) b.addEventListener("click", () => setChannels(Number(b.dataset.ch)));
window.addEventListener("resize", updateGuides);

window.addEventListener("keydown", (ev) => {
  const tag = (ev.target as HTMLElement).tagName;
  if (tag === "SELECT" || (tag === "INPUT" && (ev.target as HTMLInputElement).type !== "range")) return;
  if (!engine?.hasBuffer) return;
  if (ev.code === "Space") {
    ev.preventDefault();
    togglePlay();
  } else if (ev.key === "a" || ev.key === "A") {
    toggleAB();
  } else if (ev.key === "ArrowRight" && tag !== "INPUT") {
    setChannels(Number(chSlider.value) + 1);
  } else if (ev.key === "ArrowLeft" && tag !== "INPUT") {
    setChannels(Number(chSlider.value) - 1);
  }
});

applyOptions();
