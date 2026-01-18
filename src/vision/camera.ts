export type CameraStartOptions = {
  width?: number;
  height?: number;
  facingMode?: "user" | "environment";
};

export class CameraController {
  private stream: MediaStream | null = null;

  constructor(
    private videoEl: HTMLVideoElement,
    private overlayEl: HTMLCanvasElement
  ) {}

  async start(opts: CameraStartOptions = {}) {
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: opts.facingMode ?? "environment",
        width: opts.width ? { ideal: opts.width } : undefined,
        height: opts.height ? { ideal: opts.height } : undefined,
      },
    };

    // Pedir permisos
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.videoEl.srcObject = this.stream;

    // iOS/Safari: playsinline + gesture ya hecho en main
    await this.videoEl.play();

    // Asegurar que el overlay siga el tamaño visible
    this.syncOverlayToVideo();
  }

  stop() {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
  }

  syncOverlayToVideo() {
    const rect = this.videoEl.getBoundingClientRect();
    this.overlayEl.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
    this.overlayEl.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
  }
}
