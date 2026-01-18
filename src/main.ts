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
          Nota: en iPhone el audio solo se habilita luego de tocar el botón.
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

function setStatus(s: string) {
  statusEl.textContent = s;
}

function resizeOverlayToVideo() {
  const rect = videoEl.getBoundingClientRect();
  overlayEl.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
  overlayEl.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
}

window.addEventListener("resize", () => resizeOverlayToVideo(), { passive: true });

// Cursor (debug/calibración) en coordenadas normalizadas 0..1
let cursorX = 0.5;
let cursorY = 0.5;
let lastZoneId: string | null = null;

// mover cursor con touch sobre el overlay
overlayEl.addEventListener(
  "touchstart",
  (e) => {
    const rect = overlayEl.getBoundingClientRect();
    const t = e.touches[0];
    cursorX = (t.clientX - rect.left) / rect.width;
    cursorY = (t.clientY - rect.top) / rect.height;
  },
  { passive: true }
);

overlayEl.addEventListener(
  "touchmove",
  (e) => {
    const rect = overlayEl.getBoundingClientRect();
    const t = e.touches[0];
    cursorX = (t.clientX - rect.left) / rect.width;
    cursorY = (t.clientY - rect.top) / rect.height;
  },
  { passive: true }
);

const btnStart = document.querySelector<HTMLButtonElement>("#btnStart")!;
btnStart.addEventListener("click", async () => {
  try {
    setStatus("Iniciando…");
    await audio.init(); // gesto del usuario
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

// Botones de test (para validar audio)
document.querySelector<HTMLButtonElement>("#btnA")!.addEventListener("click", () => {
  audio.playPad();
});
document.querySelector<HTMLButtonElement>("#btnB")!.addEventListener("click", () => {
  audio.playEPiano();
});
document.querySelector<HTMLButtonElement>("#btnC")!.addEventListener("click", () => {
  audio.playClick();
});

function drawLoop() {
  const ctx = overlayEl.getContext("2d")!;
  const rect = videoEl.getBoundingClientRect();

  // limpiar
  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);

  // debug: texto
  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.font = "12px system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.fillText("overlay activo", 12, 18);
  ctx.restore();

  // dibujar zonas + cursor en coordenadas de pantalla
  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);

  for (const z of OBRA_BOSS.zones) {
    const cx = z.x * rect.width;
    const cy = z.y * rect.height;
    const rr = z.r * rect.width;

    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // cursor
  ctx.beginPath();
  ctx.arc(cursorX * rect.width, cursorY * rect.height, 6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fill();

  ctx.restore();

  // resolver zona
  const zone = findZone(OBRA_BOSS.zones, cursorX, cursorY);

  if (zone && zone.id !== lastZoneId) {
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
        // por ahora: feedback suave (después será mutación/control)
        audio.playPad();
        break;
    }
  }

  if (!zone) {
    lastZoneId = null; // permite re-disparar al volver a entrar
  }

  requestAnimationFrame(drawLoop);
}
