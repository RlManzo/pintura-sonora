import "./style.css";
import { CameraController } from "./vision/camera";
import { AudioEngine } from "./audio/engine";
import { OBRA_BOSS } from "./mapping/painting-pack";
import { findZone } from "./mapping/zones";

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

        <!-- Imagen de referencia semitransparente -->
        <img id="refImg" class="refimg" alt="Referencia" />

        <!-- Canvas para dibujar zonas + texto debug -->
        <canvas id="overlay"></canvas>

        <!-- retículo fijo al centro -->
        <div class="reticle"></div>
      </div>

      <div class="controls">
        <button id="btnStart" class="primary">Tocar para iniciar</button>

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
          Alineá la obra real con la referencia. El sonido se dispara en el centro (sin tocar pantalla).
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

// iOS: desbloquear con el primer gesto del usuario (extra seguro)
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

// Cursor fijo al centro (coordenadas normalizadas 0..1)
const cursorX = 0.5;
const cursorY = 0.5;

let lastZoneId: string | null = null;
let lastTriggerMs = 0;
const TRIGGER_COOLDOWN_MS = 280;

// Config referencia
let refVisible = true;
let refOpacity = 0.35;

// Cargar imagen de referencia
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

// Botones de test (aseguran unlock + reproducen)
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

// Start
const btnStart = document.querySelector<HTMLButtonElement>("#btnStart")!;
btnStart.addEventListener("click", async () => {
  try {
    setStatus("Iniciando…");
    await unlockAudioIfNeeded(); // 👈 usar unlock centralizado

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

function drawLoop() {
  const ctx = overlayEl.getContext("2d")!;
  const rect = videoEl.getBoundingClientRect();

  // limpiar
  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);

  // texto debug
  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.font = "12px system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.fillText("overlay activo", 12, 18);
  ctx.restore();

  // dibujar zonas (en coords de pantalla)
  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);

  for (const z of OBRA_BOSS.zones) {
    const cx = z.x * rect.width;
    const cy = z.y * rect.height;
    const rr = z.r * rect.width;

    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // resolvemos zona usando cursor centro
  const zone = findZone(OBRA_BOSS.zones, cursorX, cursorY);

  // feedback: resaltar zona activa (si hay)
  if (zone) {
    const cx = zone.x * rect.width;
    const cy = zone.y * rect.height;
    const rr = zone.r * rect.width;

    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // etiqueta de zona
  ctx.font = "12px system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText(
    zone ? `zona: ${zone.id} (${zone.role})` : "zona: -",
    12,
    rect.height - 14
  );

  ctx.restore();

  // disparo de audio con cooldown
  if (zone && zone.id !== lastZoneId) {
    const nowMs = performance.now();
    if (nowMs - lastTriggerMs > TRIGGER_COOLDOWN_MS) {
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
          // por ahora: feedback suave
          audio.playPad();
          break;
      }
    }
  }

  // si no hay zona, permitimos re-disparar al volver a entrar
  if (!zone) lastZoneId = null;

  requestAnimationFrame(drawLoop);
}
