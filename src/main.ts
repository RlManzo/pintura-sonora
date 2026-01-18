import "./style.css";
import { CameraController } from "./vision/camera";
import { AudioEngine } from "./audio/engine";
import { OBRA_BOSS } from "./mapping/painting-pack";
import { findZone } from "./mapping/zones";
import {
  computeHomography4,
  invertHomography,
  applyHomography,
  type Pt,
  type H,
} from "./vision/homography";

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <div class="wrap">
    <header class="top">
      <div class="title">
        <div class="h1">Pintura Sonora</div>
        <div class="h2">Etapa 1: Cámara + Audio</div>
      </div>
      <div class="status" id="status">Listo</div>
    </header>

    <main class="main">
      <div class="stage">
        <video id="video" playsinline muted></video>

        <img id="refImg" class="refimg" alt="Referencia" />
        <canvas id="overlay"></canvas>
        <div class="reticle"></div>
      </div>

      <div class="controls">
        <button id="btnStart" class="primary">Tocar para iniciar</button>

        <div class="row">
          <button id="btnCalib">Calibrar (4 puntos)</button>
          <button id="btnResetCalib">Reset Calib</button>
        </div>

        <div class="row">
          <button id="btnA">A (Pad)</button>
          <button id="btnB">B (E-Piano)</button>
          <button id="btnC">C (Click)</button>
        </div>

        <div class="row">
          <button id="btnRefMinus">Ref -</button>
          <button id="btnRefToggle">Ref On/Off</button>
          <button id="btnRefPlus">Ref +</button>
        </div>

        <div class="hint">
          1) Iniciar  2) Calibrar tocando 4 esquinas (sup-izq, sup-der, inf-der, inf-izq).
          Luego mové el celu: el sonido se dispara en el centro.
        </div>
      </div>
    </main>
  </div>
`;

const statusEl = document.querySelector<HTMLDivElement>("#status")!;
const videoEl = document.querySelector<HTMLVideoElement>("#video")!;
const overlayEl = document.querySelector<HTMLCanvasElement>("#overlay")!;
const refImgEl = document.querySelector<HTMLImageElement>("#refImg")!;

const camera = new CameraController(videoEl, overlayEl);
const audio = new AudioEngine();

let audioUnlocked = false;

async function unlockAudioIfNeeded() {
  if (audioUnlocked) return;
  try {
    await audio.init();
    audioUnlocked = true;
  } catch (e) {
    console.warn("No se pudo desbloquear audio", e);
  }
}

// iOS: desbloquear con el primer gesto del usuario
window.addEventListener("touchstart", () => void unlockAudioIfNeeded(), { passive: true });
window.addEventListener("pointerdown", () => void unlockAudioIfNeeded(), { passive: true });

function setStatus(s: string) {
  statusEl.textContent = s;
}

function resizeOverlayToVideo() {
  const rect = videoEl.getBoundingClientRect();
  overlayEl.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
  overlayEl.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
}
window.addEventListener("resize", () => resizeOverlayToVideo(), { passive: true });

// Cursor fijo al centro (scanner)
const cursorX = 0.5;
const cursorY = 0.5;

// Trigger “scanner”
let lastZoneId: string | null = null;
let lastTriggerMs = 0;
const TRIGGER_COOLDOWN_MS = 180; // más reactivo
const REPEAT_MS = 650; // si quedás en la misma zona, vuelve a sonar cada tanto

// Referencia
let refVisible = true;
let refOpacity = 0.35;
refImgEl.src = OBRA_BOSS.referenceImage;
refImgEl.style.opacity = String(refOpacity);
refImgEl.style.display = refVisible ? "block" : "none";

// Controles referencia
const btnRefMinus = document.querySelector<HTMLButtonElement>("#btnRefMinus")!;
const btnRefPlus = document.querySelector<HTMLButtonElement>("#btnRefPlus")!;
const btnRefToggle = document.querySelector<HTMLButtonElement>("#btnRefToggle")!;

btnRefMinus.addEventListener("click", () => {
  refOpacity = Math.max(0, refOpacity - 0.05);
  refImgEl.style.opacity = String(refOpacity);
});
btnRefPlus.addEventListener("click", () => {
  refOpacity = Math.min(1, refOpacity + 0.05);
  refImgEl.style.opacity = String(refOpacity);
});
btnRefToggle.addEventListener("click", () => {
  refVisible = !refVisible;
  refImgEl.style.display = refVisible ? "block" : "none";
});

// ------------------------
// Calibración 4 puntos
// ------------------------
let calibActive = false;
let calibPointsVideo: Pt[] = [];

// Guardamos ambas matrices:
let H_paint_to_video: H | null = null; // para dibujar zonas sobre el video
let H_video_to_paint: H | null = null; // para mapear el centro del video a coords de pintura

const paintCorners: Pt[] = [
  { x: 0, y: 0 }, // sup-izq
  { x: 1, y: 0 }, // sup-der
  { x: 1, y: 1 }, // inf-der
  { x: 0, y: 1 }, // inf-izq
];

const btnCalib = document.querySelector<HTMLButtonElement>("#btnCalib")!;
const btnResetCalib = document.querySelector<HTMLButtonElement>("#btnResetCalib")!;

btnCalib.addEventListener("click", async () => {
  await unlockAudioIfNeeded();
  calibActive = true;
  calibPointsVideo = [];
  H_paint_to_video = null;
  H_video_to_paint = null;
  setStatus("Calibración: tocá 4 esquinas (sup-izq, sup-der, inf-der, inf-izq)");
});

btnResetCalib.addEventListener("click", () => {
  calibActive = false;
  calibPointsVideo = [];
  H_paint_to_video = null;
  H_video_to_paint = null;
  lastZoneId = null;
  setStatus("Calibración reseteada");
});

const stageEl = document.querySelector<HTMLDivElement>(".stage")!;

stageEl.addEventListener("pointerdown", (e) => {
  if (!calibActive) return;

  const rect = videoEl.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;

  calibPointsVideo.push({ x, y });

  if (calibPointsVideo.length === 4) {
    try {
      H_paint_to_video = computeHomography4(paintCorners, calibPointsVideo);
      H_video_to_paint = invertHomography(H_paint_to_video);

      calibActive = false;
      setStatus("Calibración OK");
    } catch (err) {
      console.error(err);
      calibActive = false;
      calibPointsVideo = [];
      H_paint_to_video = null;
      H_video_to_paint = null;
      setStatus("Error calibrando (probá de nuevo)");
    }
  } else {
    setStatus(`Calibrando... punto ${calibPointsVideo.length}/4`);
  }
});

// ------------------------
// Botones de test (audio)
// ------------------------
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

// ------------------------
// Start cámara + loop
// ------------------------
const btnStart = document.querySelector<HTMLButtonElement>("#btnStart")!;
btnStart.addEventListener("click", async () => {
  try {
    setStatus("Iniciando…");
    await unlockAudioIfNeeded();

    await camera.start({
      width: 640,
      height: 480,
      facingMode: "environment",
    });

    resizeOverlayToVideo();
    setStatus("Cámara OK · Audio OK");
    btnStart.disabled = true;
    btnStart.textContent = "Iniciado";

    drawLoop();
  } catch (e) {
    console.error(e);
    setStatus("Error: permisos o dispositivo");
  }
});

// Helpers dibujo: pintar zona “en video” usando homografía
function drawZoneProjected(ctx: CanvasRenderingContext2D, rect: DOMRect, z: { x: number; y: number; r: number }, stroke: string, lw: number) {
  if (!H_paint_to_video) return;

  // Centro zona (pintura) -> video
  const c = applyHomography(H_paint_to_video, { x: z.x, y: z.y });
  // Punto a la derecha (para estimar radio proyectado)
  const p = applyHomography(H_paint_to_video, { x: z.x + z.r, y: z.y });

  const cx = c.x * rect.width;
  const cy = c.y * rect.height;
  const rr = Math.hypot((p.x - c.x) * rect.width, (p.y - c.y) * rect.height);

  ctx.beginPath();
  ctx.arc(cx, cy, rr, 0, Math.PI * 2);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}

function drawLoop() {
  const ctx = overlayEl.getContext("2d")!;
  const rect = videoEl.getBoundingClientRect();

  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);

  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.font = "12px system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.fillText("overlay activo", 12, 18);
  ctx.restore();

  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);

  // Mostrar taps de calibración
  for (let i = 0; i < calibPointsVideo.length; i++) {
    const p = calibPointsVideo[i];
    const px = p.x * rect.width;
    const py = p.y * rect.height;

    ctx.beginPath();
    ctx.arc(px, py, 10, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fill();

    ctx.font = "12px system-ui";
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.fillText(String(i + 1), px - 3, py + 4);
  }

  // Centro scanner (punto visual)
  ctx.beginPath();
  ctx.arc(cursorX * rect.width, cursorY * rect.height, 6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fill();

  // Dibujar zonas PROYECTADAS (ahora sí coincide con detección)
  if (H_paint_to_video) {
    for (const z of OBRA_BOSS.zones) {
      drawZoneProjected(ctx, rect, z, "rgba(255,255,255,0.20)", 2);
    }
  }

  // Mapear centro(video) -> coords pintura
  let px = cursorX;
  let py = cursorY;
  let insidePaint = false;

  if (H_video_to_paint) {
    const pPaint = applyHomography(H_video_to_paint, { x: cursorX, y: cursorY });
    px = pPaint.x;
    py = pPaint.y;
    insidePaint = px >= 0 && px <= 1 && py >= 0 && py <= 1;
  }

  // Resolver zona SOLO si estamos dentro de la pintura
  const zone = insidePaint ? findZone(OBRA_BOSS.zones, px, py) : null;

  // Debug texto
  ctx.font = "12px system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.85)";

  if (!H_video_to_paint) {
    ctx.fillText("pintura: (sin calibrar)", 12, 36);
  } else {
    ctx.fillText(
      `pintura: ${px.toFixed(2)},${py.toFixed(2)} ${insidePaint ? "" : "(FUERA)"}`,
      12,
      36
    );
  }

  ctx.fillText(zone ? `zona: ${zone.id} (${zone.role})` : "zona: -", 12, rect.height - 14);

  // Resaltar zona activa proyectada
  if (zone && H_paint_to_video) {
    drawZoneProjected(ctx, rect, zone, "rgba(255,255,255,0.55)", 3);
  }

  ctx.restore();

  // ---- Trigger de audio (modo scanner) ----
  const nowMs = performance.now();
  const canTrigger = audioUnlocked && !!H_video_to_paint && insidePaint;

  if (canTrigger && zone) {
    const changed = zone.id !== lastZoneId;
    const canRepeat = nowMs - lastTriggerMs > REPEAT_MS;

    if ((changed && nowMs - lastTriggerMs > TRIGGER_COOLDOWN_MS) || (!changed && canRepeat)) {
      lastTriggerMs = nowMs;
      lastZoneId = zone.id;

      switch (zone.role) {
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
  } else {
    // si salís de la pintura o no calibraste, reseteamos
    lastZoneId = null;
  }

  requestAnimationFrame(drawLoop);
}
