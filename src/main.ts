import "./style.css";
import { CameraController } from "./vision/camera";
import { AudioEngine } from "./audio/engine";

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
  // Ajusta el canvas overlay al tamaño real del video en pantalla
  const rect = videoEl.getBoundingClientRect();
  overlayEl.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
  overlayEl.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
}

window.addEventListener("resize", () => resizeOverlayToVideo(), { passive: true });

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

// Botones de test (para validar audio antes de visión)
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

  // debug: pinta un texto sutil
  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.font = "12px system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.fillText("overlay activo", 12, 18);
  ctx.restore();

  // seguimos
  requestAnimationFrame(drawLoop);
}
