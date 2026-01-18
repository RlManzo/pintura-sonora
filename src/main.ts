// src/main.ts
import "./style.css";
import { CameraController } from "./vision/camera";
import { AudioEngine } from "./audio/engine";
import { OBRA_BOSS } from "./mapping/painting-pack";
import { findZone } from "./mapping/zones";
import { loadOpenCV } from "./vision/opencv-loader";
import { AutoLock } from "./vision/autolock";

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <div class="wrap">
    <header class="top">
      <div class="title">
        <div class="h1">Pintura Sonora</div>
        <div class="h2">Etapa 2: Auto-lock (OpenCV)</div>
      </div>
      <div class="status" id="status">Listo</div>
    </header>

    <main class="main">
      <div class="stage">
        <video id="video" playsinline muted></video>
        <canvas id="overlay"></canvas>
        <div class="reticle"></div>
      </div>

      <div class="controls">
        <button id="btnStart" class="primary">Tocar para iniciar</button>

        <div class="row">
          <button id="btnA">A (Pad)</button>
          <button id="btnB">B (E-Piano)</button>
          <button id="btnC">C (Click)</button>
        </div>

        <div class="hint">
          Apuntá la cámara a la obra: cuando “lockea”, el centro dispara zonas automáticamente.
        </div>
      </div>
    </main>
  </div>
`;

const statusEl = document.querySelector<HTMLDivElement>("#status")!;
const videoEl = document.querySelector<HTMLVideoElement>("#video")!;
const overlayEl = document.querySelector<HTMLCanvasElement>("#overlay")!;

const camera = new CameraController(videoEl, overlayEl);
const audio = new AudioEngine();

let audioUnlocked = false;
async function unlockAudioIfNeeded() {
  if (audioUnlocked) return;
  await audio.init();
  audioUnlocked = true;
}

function setStatus(s: string) {
  statusEl.textContent = s;
}

function resizeOverlayToVideo() {
  const rect = videoEl.getBoundingClientRect();
  overlayEl.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
  overlayEl.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
}
window.addEventListener("resize", () => resizeOverlayToVideo(), { passive: true });

async function checkVendorFiles() {
  const urls = ["/vendor/opencv.js", "/vendor/opencv_js.wasm"];
  const results: string[] = [];
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: "no-store" });
      const ct = r.headers.get("content-type") ?? "-";
      results.push(`${u}: ${r.status} (${ct})`);
    } catch {
      results.push(`${u}: FETCH_ERROR`);
    }
  }
  return results.join(" | ");
}

let cv: any | null = null;
let autolock: AutoLock | null = null;

// scanner = centro
const cursorX = 0.5;
const cursorY = 0.5;

let lastZoneId: string | null = null;
let lastTriggerMs = 0;
const COOLDOWN_MS = 150;
const REPEAT_MS = 650;

const btnStart = document.querySelector<HTMLButtonElement>("#btnStart")!;
btnStart.addEventListener("click", async () => {
  try {
    setStatus("Iniciando audio…");
    await unlockAudioIfNeeded();

    setStatus("Pidiendo permisos de cámara…");
    await camera.start({
      width: 1280,
      height: 720,
      facingMode: "environment",
    });

    resizeOverlayToVideo();
    setStatus("Cámara OK · chequeando vendor…");

    const chk = await checkVendorFiles();
    setStatus(chk);
    await new Promise((r) => setTimeout(r, 900));

    setStatus("Cargando OpenCV… (iPhone puede tardar 30–90s)");
    cv = await loadOpenCV(90000);
    setStatus("OpenCV OK");

    setStatus("Preparando referencia…");
    autolock = new AutoLock({ cv, referenceUrl: OBRA_BOSS.referenceImage });
    autolock.setAnalysisSize(320);
    autolock.setVisionRate(200);
    await autolock.init();

    setStatus("Listo · Buscando obra…");
    btnStart.disabled = true;
    btnStart.textContent = "Iniciado";

    drawLoop();
  } catch (e: any) {
    console.error("FALLO START:", e);

    const msg =
      e?.name === "NotAllowedError"
        ? "Permiso de cámara denegado"
        : e?.name === "NotFoundError"
        ? "No se encontró cámara"
        : e?.message
        ? e.message
        : String(e);

    setStatus(`Error: ${msg}`);
  }
});

// botones test
document.querySelector<HTMLButtonElement>("#btnA")!.addEventListener("click", async () => {
  await unlockAudioIfNeeded();
  audio.playPad();
});
document.querySelector<HTMLButtonElement>("#btnB")!.addEventListener("click", async () => {
  await unlockAudioIfNeeded();
  audio.playEPiano();
});
document.querySelector<HTMLButtonElement>("#btnC")!.addEventListener("click", async () => {
  await unlockAudioIfNeeded();
  audio.playClick();
});

function triggerZoneSound(role: string) {
  switch (role) {
    case "pad":
      audio.playPad();
      break;
    case "epiano":
    case "pattern-melody":
      audio.playEPiano();
      break;
    case "perc":
    case "pattern-rhythm":
      audio.playClick();
      break;
    case "accent":
      audio.playClick();
      audio.playEPiano();
      break;
    case "macro":
      audio.playPad();
      break;
  }
}

function drawLoop() {
  const ctx = overlayEl.getContext("2d")!;
  const rect = videoEl.getBoundingClientRect();

  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);

  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.font = "12px system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText("overlay activo", 12, 18);

  // centro
  ctx.beginPath();
  ctx.arc(cursorX * rect.width, cursorY * rect.height, 6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fill();

  let lockText = "LOCK: -";
  let zoneText = "zona: -";

  if (autolock) {
    const r = autolock.process(videoEl);

    if (r.locked) {
      lockText = `LOCK: OK (inl:${r.inliers} m:${r.goodMatches})`;
      const zone = findZone(OBRA_BOSS.zones, r.paintX, r.paintY);
      zoneText = zone ? `zona: ${zone.id} (${zone.role})` : "zona: -";

      if (zone) {
        const now = performance.now();
        const changed = zone.id !== lastZoneId;
        const canRepeat = now - lastTriggerMs > REPEAT_MS;

        if ((changed && now - lastTriggerMs > COOLDOWN_MS) || (!changed && canRepeat)) {
          lastTriggerMs = now;
          lastZoneId = zone.id;
          triggerZoneSound(zone.role);
        }
      } else {
        lastZoneId = null;
      }
    } else {
      lockText = `LOCK: buscando… (m:${r.goodMatches})`;
      lastZoneId = null;
    }

    ctx.fillText(`pintura: ${r.paintX.toFixed(2)},${r.paintY.toFixed(2)}`, 12, 36);
  }

  ctx.fillText(lockText, 12, 54);
  ctx.fillText(zoneText, 12, rect.height - 14);

  ctx.restore();

  requestAnimationFrame(drawLoop);
}
